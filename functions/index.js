/**
 * Allerta Botteghe — backend (Cloud Functions per Firebase, 2ª generazione)
 *
 * - joinGroup      verifica il codice del gruppo e crea il profilo del negozio
 * - adminLogin     controlla la password Superadmin (segreta, sul server) e dà i permessi
 * - adminLogout    toglie i permessi Superadmin
 * - sendTestPush   manda una notifica di prova dopo qualche secondo
 * - onPostCreated  controllo privacy + notifica push a tutti i negozi
 * - onPostUpdated  notifica quando un metodo diventa una "serie"
 * - onMessage      notifica push al destinatario di un messaggio
 */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { setGlobalOptions, logger } = require('firebase-functions/v2');
const { defineSecret, defineString } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { getMessaging } = require('firebase-admin/messaging');

initializeApp();
const db = getFirestore();

// Deve coincidere con la regione del database Firestore (europe-west1) e con REGION in src/firebase-config.js
setGlobalOptions({ region: 'europe-west1', maxInstances: 5 });

const ADMIN_PASSWORD = defineSecret('ADMIN_PASSWORD');
const GROUP_CODE = defineString('GROUP_CODE', { default: 'BOTTEGHE-2026', description: 'Codice iniziale del gruppo' });

const SERIES_AT = 3;
const CATS = {
  banconote: 'Banconote false', pagamento: 'Pagamento mai arrivato', resto: 'Truffa del resto',
  furto: 'Furto o taccheggio', incaricati: 'Finti incaricati', credito: 'Credito non saldato', altro: 'Altro'
};
const TYPES = ['Alimentari', 'Panetteria', 'Bar', 'Tabaccheria', 'Edicola', 'Ferramenta', 'Abbigliamento', 'Farmacia', 'Parrucchiere', 'Altro'];
const ACCENT = '#FF6A3D';

/* ---------- utilità ---------- */
function privacyIssue(txt) {
  const t = ' ' + txt + ' ';
  if (/\b[A-Z]\.\s?[A-Z]\.?(?=\W)/.test(t)) return 'iniziali';
  if (/\b(sig\.?|sig\.ra|signor[ae]?|signora)\s+[A-Z]/i.test(t)) return 'nome';
  if (/\b(nome|cognome|si chiama)\b/i.test(t)) return 'nome';
  if (/(\+?\d[\s-]?){9,}/.test(t)) return 'telefono';
  if (/\b[A-Z]{2}\s?\d{3}\s?[A-Z]{2}\b/.test(t)) return 'targa';
  if (/\b(abita|vive|residente)\b/i.test(t)) return 'indirizzo';
  return '';
}

function romeMinutes() {
  const parts = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const h = +parts.find(p => p.type === 'hour').value, m = +parts.find(p => p.type === 'minute').value;
  return h * 60 + m;
}
function isClosed(open, close) {
  const toMin = s => { const [h, m] = String(s || '00:00').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  const t = romeMinutes(), o = toMin(open || '08:00'), c = toMin(close || '19:30');
  return c > o ? (t < o || t > c) : (t > c && t < o);
}

function cleanProfile(p = {}) {
  const name = String(p.name || '').trim().slice(0, 40);
  if (name.length < 2) throw new HttpsError('invalid-argument', 'Il nome del negozio deve avere almeno 2 lettere.');
  return {
    name,
    type: TYPES.includes(p.type) ? p.type : 'Altro',
    color: /^#[0-9a-f]{6}$/i.test(p.color || '') ? p.color : '#11695f',
    open: '08:00', close: '19:30', bio: ''
  };
}

// Limita i tentativi (codice gruppo, password) a `max` all'ora per utente
async function guard(uid, kind, max = 8) {
  const ref = db.doc(`attempts/${uid}_${kind}`);
  await db.runTransaction(async tx => {
    const s = await tx.get(ref);
    const fresh = !s.exists || Date.now() - s.data().since.toMillis() > 3600e3;
    if (!fresh && s.data().n >= max) throw new HttpsError('resource-exhausted', 'Troppi tentativi sbagliati. Riprova tra un’ora.');
    tx.set(ref, fresh ? { n: 1, since: Timestamp.now() } : { n: s.data().n + 1, since: s.data().since });
  });
}

async function requireMember(req) {
  const uid = req.auth && req.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Accesso richiesto.');
  const m = await db.doc(`members/${uid}`).get();
  if (!m.exists || m.data().suspended) throw new HttpsError('permission-denied', 'Non fai parte del gruppo.');
  return { uid, member: m.data() };
}

/**
 * Invia una notifica push ai negozi.
 * kind: post | series | join | chat | test
 * Rispetta le preferenze di ciascuno (categorie, solo urgenti, silenzio a negozio chiuso).
 */
async function push({ title, body, kind, data = {}, cat = null, urgent = false, exclude = null, only = null, ignorePrefs = false }) {
  const docs = only
    ? (await db.getAll(...only.map(id => db.doc(`members/${id}`)))).filter(d => d.exists)
    : (await db.collection('members').get()).docs;

  const msgs = [], owners = [];
  for (const d of docs) {
    const m = d.data();
    if (m.suspended || d.id === exclude) continue;
    const pr = m.prefs || {};
    if (!ignorePrefs) {
      if (cat && pr.cats && pr.cats[cat] === false) continue;
      if (kind === 'post' && pr.onlyUrgent && !urgent) continue;
    }
    const t = await db.doc(`members/${d.id}/private/fcm`).get();
    const token = t.exists && t.data().token;
    if (!token) continue;

    const quiet = !ignorePrefs && pr.quiet !== false && isClosed(m.open, m.close);
    const channelId = quiet ? 'silenzioso' : kind === 'chat' ? 'messaggi' : urgent ? 'urgenti' : 'avvisi';
    const payload = Object.fromEntries(Object.entries({ ...data, kind }).map(([k, v]) => [k, String(v)]));
    const notification = { channelId, icon: 'ic_stat_allerta', color: ACCENT, defaultSound: !quiet };
    if (data.tag) notification.tag = String(data.tag);

    msgs.push({
      token,
      notification: { title, body },
      data: payload,
      // priorità alta: la notifica arriva subito anche con app chiusa e telefono in standby
      android: { priority: 'high', ttl: 24 * 3600 * 1000, notification }
    });
    owners.push(d.id);
  }

  for (let i = 0; i < msgs.length; i += 500) {
    const res = await getMessaging().sendEach(msgs.slice(i, i + 500));
    res.responses.forEach((r, j) => {
      if (r.success) return;
      const code = r.error && r.error.code;
      logger.warn('Push non consegnata', { member: owners[i + j], code });
      if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
        db.doc(`members/${owners[i + j]}/private/fcm`).delete().catch(() => {});
      }
    });
  }
  return msgs.length;
}

/* ---------- funzioni chiamate dall'app ---------- */
exports.joinGroup = onCall(async req => {
  const uid = req.auth && req.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Accesso richiesto.');
  const ref = db.doc(`members/${uid}`);
  if ((await ref.get()).exists) return { ok: true };

  await guard(uid, 'join');
  const cfgRef = db.doc('config/group');
  let cfg = await cfgRef.get();
  if (!cfg.exists) { await cfgRef.set({ code: GROUP_CODE.value().trim().toUpperCase() }); cfg = await cfgRef.get(); }

  const code = String((req.data && req.data.code) || '').trim().toUpperCase();
  if (code !== cfg.data().code) throw new HttpsError('permission-denied', 'Codice del gruppo non valido. Controllalo con chi ti ha passato l’app.');

  const profile = cleanProfile(req.data && req.data.profile);
  await ref.set({
    ...profile,
    joined: FieldValue.serverTimestamp(),
    suspended: false,
    prefs: { cats: Object.fromEntries(Object.keys(CATS).map(k => [k, true])), onlyUrgent: false, quiet: true }
  });
  await db.collection('events').add({ kind: 'join', by: uid, text: `${profile.name} è entrato nel gruppo`, ts: FieldValue.serverTimestamp() });
  await push({ title: 'Nuovo negozio nel gruppo', body: `${profile.name} si è unito ad Allerta Botteghe`, kind: 'join', exclude: uid });
  return { ok: true };
});

exports.adminLogin = onCall({ secrets: [ADMIN_PASSWORD] }, async req => {
  const { uid } = await requireMember(req);
  await guard(uid, 'admin', 6);
  if (String((req.data && req.data.password) || '') !== ADMIN_PASSWORD.value()) {
    throw new HttpsError('permission-denied', 'Password errata. Controlla maiuscole e minuscole.');
  }
  await getAuth().setCustomUserClaims(uid, { admin: true });
  return { ok: true };
});

exports.adminLogout = onCall(async req => {
  const uid = req.auth && req.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Accesso richiesto.');
  await getAuth().setCustomUserClaims(uid, null);
  return { ok: true };
});

exports.sendTestPush = onCall(async req => {
  const { uid } = await requireMember(req);
  const delay = Math.min(15, Math.max(0, Number((req.data && req.data.delay) || 0)));
  await new Promise(r => setTimeout(r, delay * 1000));
  const n = await push({ title: 'Notifica di prova', body: 'Funziona: le notifiche ti arrivano anche ad app chiusa.', kind: 'test', only: [uid], ignorePrefs: true, urgent: true });
  if (!n) throw new HttpsError('failed-precondition', 'Questo telefono non è ancora registrato per le notifiche. Riapri l’app e consenti le notifiche.');
  return { ok: true };
});

/* ---------- trigger sul database ---------- */
exports.onPostCreated = onDocumentCreated('posts/{postId}', async event => {
  const snap = event.data; if (!snap) return;
  const p = snap.data();
  if (privacyIssue(`${p.title} ${p.text}`)) {
    logger.info('Avviso rimosso dal controllo privacy', { post: event.params.postId });
    await snap.ref.delete();
    return;
  }
  const author = (await db.doc(`members/${p.author}`).get()).data() || { name: 'Un negozio' };
  const label = CATS[p.cat] || 'Avviso';
  await db.collection('events').add({
    kind: 'post', by: p.author, post: event.params.postId, cat: p.cat, urgent: !!p.urgent,
    text: `${p.urgent ? 'Avviso urgente' : 'Nuovo avviso'}: ${p.title}`, ts: FieldValue.serverTimestamp()
  });
  await push({
    title: p.urgent ? `URGENTE · ${label}` : label,
    body: `${author.name}: ${p.title}`,
    kind: 'post', cat: p.cat, urgent: !!p.urgent, exclude: p.author,
    data: { id: event.params.postId, tag: 'post-' + event.params.postId }
  });
});

exports.onPostUpdated = onDocumentUpdated('posts/{postId}', async event => {
  const before = event.data.before.data(), after = event.data.after.data();
  const nb = (before.meToo || []).length + 1, na = (after.meToo || []).length + 1;
  if (!(nb < SERIES_AT && na >= SERIES_AT)) return;
  await db.collection('events').add({
    kind: 'series', by: null, post: event.params.postId, cat: after.cat,
    text: `Serie rilevata: “${after.title}” è successo a ${na} negozi`, ts: FieldValue.serverTimestamp()
  });
  await push({
    title: 'Serie rilevata in paese',
    body: `“${after.title}” è successo a ${na} negozi. Valutate una denuncia congiunta.`,
    kind: 'series', cat: after.cat, urgent: true,
    data: { id: event.params.postId, tag: 'series-' + event.params.postId }
  });
});

exports.onMessage = onDocumentCreated('chats/{chatId}/messages/{msgId}', async event => {
  const snap = event.data; if (!snap) return;
  const msg = snap.data();
  const chatRef = db.doc(`chats/${event.params.chatId}`);
  const chat = (await chatRef.get()).data();
  if (!chat) return;
  const to = (chat.members || []).find(x => x !== msg.from);
  await chatRef.set({ last: String(msg.text).slice(0, 120), lastTs: msg.ts || FieldValue.serverTimestamp(), lastFrom: msg.from }, { merge: true });
  if (!to) return;
  const sender = (await db.doc(`members/${msg.from}`).get()).data() || { name: 'Un negozio' };
  await push({
    title: sender.name, body: String(msg.text).slice(0, 180), kind: 'chat', only: [to],
    data: { from: msg.from, tag: 'chat-' + event.params.chatId }
  });
});
