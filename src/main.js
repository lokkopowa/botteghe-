import './style.css';
import { initializeApp } from 'firebase/app';
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import {
  initializeFirestore, persistentLocalCache, doc, collection, onSnapshot, query, orderBy, limit, where,
  addDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, arrayUnion, arrayRemove
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { App as CapApp } from '@capacitor/app';
import { firebaseConfig, REGION } from './firebase-config.js';
import { CATS, CC, CI, I, COLORS, TYPES, SERIES_AT, privacyIssue } from './data.js';

/* ================= Stato ================= */
const D = 24 * 3600e3;
const native = Capacitor.isNativePlatform();
const LKEY = 'allerta-locale-v1';
const L = { theme: 'system', size: 1, localPolice: '', carabinieri: '', seenEvents: 0, seenChats: {} };
try { Object.assign(L, JSON.parse(localStorage.getItem(LKEY) || '{}')); } catch (e) { /* storage non disponibile */ }
const saveL = () => { try { localStorage.setItem(LKEY, JSON.stringify(L)); } catch (e) { /* ignora */ } };

let fb = null;                       // { auth, db, fns }
let phase = 'loading';               // loading | config | join | app | suspended | error
let errorMsg = '';
let uid = null, me = null, isAdmin = false;
let members = {}, posts = [], events = [], chats = {}, thread = [], groupCode = '';
let view = 'feed', filter = 'all', chatWith = null;
let pushState = native ? 'wait' : 'web'; // wait | on | denied | error | web
let pendingNav = null;
let unsubs = [], threadUnsub = null, meUnsub = null;
let joinColor = COLORS[1];
const clearIds = new Set();

/* ================= Utility ================= */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const initials = n => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
const ms = v => (v && typeof v.toMillis === 'function') ? v.toMillis() : (typeof v === 'number' ? v : Date.now());
const cidOf = other => [uid, other].sort().join('_');
function who(id) {
  if (id === uid && me) return me;
  return members[id] || { name: 'Negozio uscito dal gruppo', color: '#868e96', type: '' };
}
function ago(ts) {
  const m = Math.round((Date.now() - ts) / 60e3);
  if (m < 1) return 'adesso'; if (m < 60) return m + ' min fa';
  const h = Math.round(m / 60); if (h < 24) return h + ' h fa';
  const d = Math.round(h / 24); return d === 1 ? 'ieri' : d + ' giorni fa';
}
const hhmm = ts => new Date(ts).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
function greeting() { const h = new Date().getHours(); return h < 13 ? 'Buongiorno' : h < 18 ? 'Buon pomeriggio' : 'Buonasera'; }
function isClosed() {
  if (!me) return false;
  const toMin = s => { const [h, m] = String(s || '00:00').split(':').map(Number); return h * 60 + m; };
  const d = new Date(), t = d.getHours() * 60 + d.getMinutes(), o = toMin(me.open), c = toMin(me.close);
  return c > o ? (t < o || t > c) : (t > c && t < o);
}
let toastT;
function toast(msg) {
  const old = $('.toast'); if (old) old.remove();
  const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
  document.body.appendChild(t); clearTimeout(toastT); toastT = setTimeout(() => t.remove(), 2800);
}
function errText(e) {
  const c = e && e.code || '';
  if (c.includes('permission-denied')) return 'Operazione non permessa.';
  if (c.includes('unavailable') || c.includes('network')) return 'Connessione assente. Riprova quando torna la rete.';
  return (e && e.message) ? e.message.replace(/^Firebase:\s*/, '') : 'Qualcosa non ha funzionato. Riprova.';
}
function applyLook() {
  const r = document.documentElement;
  if (L.theme === 'system') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', L.theme);
  r.style.setProperty('--scale', L.size);
}
const prefs = () => Object.assign({ cats: {}, onlyUrgent: false, quiet: true }, me && me.prefs || {});
const activeMembers = () => Object.values(members).filter(m => !m.suspended);

/* ================= Firebase ================= */
function boot() {
  if (!firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith('INSERISCI')) { phase = 'config'; render(); return; }
  const app = initializeApp(firebaseConfig);
  const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
  const db = initializeFirestore(app, { localCache: persistentLocalCache() });
  const fns = getFunctions(app, REGION);
  fb = { auth, db, fns };
  onAuthStateChanged(auth, async u => {
    if (!u) {
      try { await signInAnonymously(auth); } catch (e) { fail(e); }
      return;
    }
    uid = u.uid;
    try { isAdmin = !!(await u.getIdTokenResult()).claims.admin; } catch (e) { isAdmin = false; }
    watchMe();
  });
}
const call = (name, data) => httpsCallable(fb.fns, name)(data).then(r => r.data);

function fail(e) { errorMsg = errText(e); phase = 'error'; render(); }

function watchMe() {
  if (meUnsub) meUnsub();
  meUnsub = onSnapshot(doc(fb.db, 'members', uid), snap => {
    if (!snap.exists()) { me = null; stopData(); phase = 'join'; render(); return; }
    me = { id: uid, ...snap.data() };
    if (me.suspended) { stopData(); phase = 'suspended'; render(); return; }
    if (phase !== 'app') {
      phase = 'app'; startData(); setupPush();
      if (pendingNav) { const n = pendingNav; pendingNav = null; navTo(n); }
    }
    render();
  }, fail);
}

function startData() {
  stopData();
  const db = fb.db;
  unsubs.push(onSnapshot(collection(db, 'members'), s => {
    members = {}; s.forEach(d => { members[d.id] = { id: d.id, ...d.data(), joined: ms(d.data().joined) }; }); render();
  }, () => {}));
  unsubs.push(onSnapshot(query(collection(db, 'posts'), orderBy('ts', 'desc'), limit(150)), s => {
    posts = s.docs.map(d => ({ id: d.id, ...d.data(), ts: ms(d.data().ts), meToo: d.data().meToo || [] })); render();
  }, () => {}));
  unsubs.push(onSnapshot(query(collection(db, 'events'), orderBy('ts', 'desc'), limit(60)), s => {
    events = s.docs.map(d => ({ id: d.id, ...d.data(), ts: ms(d.data().ts) })); render();
  }, () => {}));
  unsubs.push(onSnapshot(query(collection(db, 'chats'), where('members', 'array-contains', uid)), s => {
    chats = {};
    s.forEach(d => { const c = d.data(); const other = (c.members || []).find(x => x !== uid); if (other) chats[other] = { cid: d.id, ...c, lastTs: c.lastTs ? ms(c.lastTs) : 0 }; });
    render();
  }, () => {}));
  unsubs.push(onSnapshot(doc(db, 'config', 'group'), s => { groupCode = s.exists() ? s.data().code : ''; render(); }, () => {}));
}
function stopData() { unsubs.forEach(u => u()); unsubs = []; if (threadUnsub) { threadUnsub(); threadUnsub = null; } }

/* ================= Notifiche push ================= */
async function setupPush() {
  if (!native) return;
  try {
    await PushNotifications.createChannel({ id: 'urgenti', name: 'Avvisi urgenti', description: 'Episodi in corso in paese', importance: 5, visibility: 1, vibration: true, lights: true, lightColor: '#FF6A3D' });
    await PushNotifications.createChannel({ id: 'avvisi', name: 'Avvisi', description: 'Nuovi avvisi e serie in bacheca', importance: 4, visibility: 1, vibration: true });
    await PushNotifications.createChannel({ id: 'messaggi', name: 'Messaggi', description: 'Messaggi dagli altri negozi', importance: 4, visibility: 0, vibration: true });
    await PushNotifications.createChannel({ id: 'silenzioso', name: 'A negozio chiuso', description: 'Avvisi ricevuti fuori orario, senza suono', importance: 2, visibility: 1 });

    await PushNotifications.removeAllListeners();
    PushNotifications.addListener('registration', async t => {
      try { await setDoc(doc(fb.db, 'members', uid, 'private', 'fcm'), { token: t.value, platform: Capacitor.getPlatform(), ts: serverTimestamp() }); pushState = 'on'; }
      catch (e) { pushState = 'error'; }
      render();
    });
    PushNotifications.addListener('registrationError', () => { pushState = 'error'; render(); });
    PushNotifications.addListener('pushNotificationReceived', n => { toast(n.title ? `${n.title} · ${n.body || ''}` : (n.body || 'Nuova notifica')); });
    PushNotifications.addListener('pushNotificationActionPerformed', a => {
      const d = (a.notification && a.notification.data) || {};
      if (phase === 'app') navTo(d); else pendingNav = d;
    });

    let perm = await PushNotifications.checkPermissions();
    if (perm.receive !== 'granted') perm = await PushNotifications.requestPermissions();
    if (perm.receive !== 'granted') { pushState = 'denied'; render(); return; }
    await PushNotifications.register();
  } catch (e) { pushState = 'error'; render(); }
}
function navTo(d) {
  closeSheet();
  if (d.kind === 'chat' && d.from) { openChat(d.from); return; }
  chatWith = null; view = (d.kind === 'post' || d.kind === 'series') ? 'feed' : 'notifs'; filter = 'all'; render();
}

/* ================= Render ================= */
let raf = 0, lastView = null, lastPhase = null, lastChat = null, lastThreadLen = 0;
function render() { if (!raf) raf = requestAnimationFrame(doRender); }
function doRender() {
  raf = 0;
  applyLook();
  const keep = view === lastView && phase === lastPhase && chatWith === lastChat;
  const saved = {}; let focus = null;
  if (keep) {
    document.querySelectorAll('#app input[id], #app textarea[id], #app select[id]').forEach(el => {
      if (el.type !== 'checkbox' && el.type !== 'radio') saved[el.id] = el.value;
    });
    const a = document.activeElement;
    if (a && a.id && a.closest && a.closest('#app')) { focus = { id: a.id }; try { focus.s = a.selectionStart; focus.e = a.selectionEnd; } catch (e) { /* no selezione */ } }
  }
  const changed = !keep;
  lastView = view; lastPhase = phase; lastChat = chatWith;

  $('#app').innerHTML = phase === 'app' ? appShell(changed) : screens[phase]();

  for (const [id, v] of Object.entries(saved)) {
    const el = document.getElementById(id);
    if (el && !clearIds.has(id)) el.value = v;
  }
  clearIds.clear();
  if (focus) { const el = document.getElementById(focus.id); if (el) { el.focus({ preventScroll: true }); try { el.setSelectionRange(focus.s, focus.e); } catch (e) { /* ignora */ } } }
  if (phase === 'app' && view === 'chat' && chatWith && thread.length !== lastThreadLen) { lastThreadLen = thread.length; window.scrollTo(0, document.body.scrollHeight); }
  if (changed && !(view === 'chat' && chatWith)) window.scrollTo(0, 0);
}

function unreadEvents() { return events.filter(e => e.ts > L.seenEvents && e.by !== uid).length; }
function chatUnread(other) { const c = chats[other]; return !!c && c.lastFrom && c.lastFrom !== uid && (L.seenChats[c.cid] || 0) < c.lastTs; }
function unreadChats() { return Object.keys(chats).filter(chatUnread).length; }

function appShell(changed) {
  const nU = unreadEvents(), cU = unreadChats();
  const titles = { feed: 'Bacheca', chat: 'Messaggi', tools: 'Strumenti', settings: 'Impostazioni', notifs: 'Notifiche', admin: 'Superadmin' };
  const nav = (v, l, ic, badge) => `<button data-act="go" data-v="${v}" ${view === v || (v === 'settings' && view === 'admin') ? 'aria-current="page"' : ''}>${ic}${l}${badge ? `<span class="dot">${badge}</span>` : ''}</button>`;
  return `
  <header class="top"><div class="topbar wrap">
   <span class="logo">${I.logo}</span>
   <div class="brand"><h1>Allerta <em>Botteghe</em></h1><small>${activeMembers().length || 1} negozi nel gruppo</small></div>
   <button class="iconbtn" data-act="go" data-v="notifs" aria-label="Notifiche, ${nU} da leggere">${I.bell}${nU ? `<span class="dot">${nU}</span>` : ''}</button>
   <button class="avatar" data-act="go" data-v="settings" style="background-color:${esc(me.color)}" aria-label="Il tuo profilo">${esc(initials(me.name))}</button>
  </div></header>
  <main class="wrap ${changed ? 'enter' : ''}" aria-label="${titles[view]}">${views[view]()}</main>
  <nav class="dock" aria-label="Sezioni"><div class="in">
   ${nav('feed', 'Bacheca', I.home)}${nav('chat', 'Messaggi', I.chat, cU)}
   <button class="plus" data-act="new" aria-label="Nuovo avviso">${I.plus}</button>
   ${nav('tools', 'Strumenti', I.tools)}${nav('settings', 'Profilo', I.gear)}
  </div></nav>`;
}

const heroTop = '<div class="awning"></div><div class="scallop"></div>';
const screens = {
  loading: () => `<div class="screen wrap center"><span class="logo">${I.logo}</span><b>Allerta Botteghe</b><div class="spinner" aria-label="Caricamento"></div></div>`,
  config: () => `<div class="screen wrap"><section class="hero">${heroTop}<div class="hero-in"><span class="hero-eyebrow">Configurazione</span><h2>Manca il collegamento a Firebase</h2><p>Incolla la configurazione della tua app web nel file src/firebase-config.js, come spiegato al passo 3 della guida, e ricompila l’app.</p></div></section></div>`,
  error: () => `<div class="screen wrap center"><span class="logo">${I.logo}</span><b>Non riesco a collegarmi</b><p>${esc(errorMsg)}</p><button class="btn" data-act="reload">Riprova</button></div>`,
  suspended: () => `<div class="screen wrap"><section class="hero">${heroTop}<div class="hero-in"><span class="hero-eyebrow">Accesso sospeso</span><h2>Il tuo negozio è sospeso</h2><p>L’amministratore del gruppo ha sospeso questo profilo. Parlane con lui per essere riattivato.</p></div></section></div>`,
  join: () => `<div class="screen wrap join">
   <section class="hero">${heroTop}<div class="hero-in"><span class="hero-eyebrow">Benvenuto</span><h2>Entra nel gruppo dei negozi del paese</h2><p>Serve il codice del gruppo: chiedilo al collega che ti ha passato l’app.</p></div></section>
   <form class="list form form-pad" data-form="join">
    <label class="f">Codice del gruppo<input class="input mono" id="j-code" autocapitalize="characters" autocomplete="off" spellcheck="false" required placeholder="BOTTEGHE-XXXX"></label>
    <label class="f">Nome del negozio<input class="input" id="j-name" maxlength="40" required placeholder="Es. Alimentari Rosa"></label>
    <label class="f">Tipo di attività<select class="input" id="j-type">${TYPES.map(t => `<option>${t}</option>`).join('')}</select></label>
    <div class="f" style="display:flex;flex-direction:column;gap:8px">Colore del negozio
     <div class="swatches" role="group" aria-label="Colore del negozio">${COLORS.map(c => `<button type="button" data-act="jcolor" data-v="${c}" style="background:${c}" aria-label="Colore ${c}" aria-pressed="${joinColor === c}"></button>`).join('')}</div></div>
    <div class="privacy">${I.shield}<div>Qui si segnalano <b>episodi e metodi</b>, mai persone: niente nomi, iniziali, foto, indirizzi o targhe.</div></div>
    <div id="j-err"></div>
    <button class="btn" type="submit" id="j-btn">Entra nel gruppo</button>
   </form></div>`
};

const views = {
  feed() {
    const list = posts.filter(p => filter === 'all' || (filter === 'urgent' ? p.urgent : p.cat === filter));
    const day = Date.now() - D, recent = posts.filter(p => p.ts > day).length, urg = posts.filter(p => p.urgent && p.ts > day).length;
    const ser = posts.filter(p => p.meToo.length + 1 >= SERIES_AT).length;
    const date = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
    return `
    <section class="hero" aria-label="Situazione in paese">${heroTop}
     <div class="hero-in">
      <span class="hero-eyebrow">${greeting()} · ${esc(date)}</span>
      <h2>${urg ? `<span class="live-dot"></span>${urg} ${urg > 1 ? 'allerte in corso' : 'allerta in corso'} in paese` : 'Tutto tranquillo in paese'}</h2>
      <p>${esc(me.name)}, ecco cosa segnalano i colleghi.</p>
      <div class="hero-stats"><div><b>${recent}</b><span>ultime 24 ore</span></div><div class="${urg ? 'hot' : ''}"><b>${urg}</b><span>urgenti</span></div><div><b>${ser}</b><span>serie aperte</span></div></div>
     </div>
    </section>
    <div class="section-h"><h2>Bacheca</h2><span>${list.length} avvisi</span></div>
    <div class="chips" role="group" aria-label="Filtra avvisi">
     <button class="chip" data-act="filter" data-v="all" aria-pressed="${filter === 'all'}">Tutti</button>
     <button class="chip" data-act="filter" data-v="urgent" aria-pressed="${filter === 'urgent'}" style="--c:var(--crit)"><i></i>Urgenti</button>
     ${Object.entries(CATS).map(([k, l]) => `<button class="chip" data-act="filter" data-v="${k}" aria-pressed="${filter === k}" style="--c:${CC[k]}"><i></i>${l}</button>`).join('')}
    </div>
    <div class="feed">${list.length ? list.map(postCard).join('') : `<div class="empty">${posts.length ? 'Nessun avviso in questa categoria.' : 'Ancora nessun avviso. Quando un collega segnala un episodio lo trovi qui e ti arriva una notifica. Per scriverne uno tocca il +.'}</div>`}</div>`;
  },
  notifs() {
    const list = events;
    return `<div class="section-h"><h2>Notifiche</h2>${unreadEvents() ? `<button class="linkbtn" data-act="readall">Segna tutte come lette</button>` : ''}</div>
    ${prefs().quiet && isClosed() ? `<div class="demo"><div><b>Negozio chiuso:</b> le notifiche arrivano senza suono fino alle ${esc(me.open)}.</div></div>` : ''}
    ${list.length ? `<div class="list">${list.map(n => `<button class="row ${n.ts > L.seenEvents && n.by !== uid ? 'unread' : ''}" data-act="opennotif" data-id="${n.id}"><span class="nicon">${n.kind === 'post' && n.cat ? CI[n.cat] : I.bell}</span><span class="grow"><span class="t">${esc(n.text)}</span><span class="s">${ago(n.ts)}</span></span></button>`).join('')}</div>` : `<div class="empty">Nessuna notifica per ora.</div>`}`;
  },
  chat() {
    if (chatWith) {
      const m = who(chatWith);
      return `<div class="chat-head">
       <button class="iconbtn" data-act="closechat" aria-label="Torna ai messaggi">${I.back}</button>
       <div class="avatar" style="background-color:${esc(m.color)}">${esc(initials(m.name))}</div>
       <div><h2>${esc(m.name)}</h2><span class="hint">${esc(m.type || '')}</span></div></div>
      <div class="thread">${thread.length ? thread.map(x => `<div class="msg ${x.from === uid ? 'me' : ''}">${esc(x.text)}<time>${hhmm(x.ts)}</time></div>`).join('') : `<div class="empty">Scrivi il primo messaggio a ${esc(m.name)}.</div>`}</div>
      <form class="composer" data-form="msg"><input class="input" id="msgtext" placeholder="Scrivi un messaggio" autocomplete="off" maxlength="1000" aria-label="Messaggio"><button class="btn" type="submit">Invia</button></form>`;
    }
    const ms2 = activeMembers().filter(m => m.id !== uid).map(m => ({ m, c: chats[m.id] })).sort((a, b) => ((b.c && b.c.lastTs) || 0) - ((a.c && a.c.lastTs) || 0));
    return `<div class="section-h"><h2>Messaggi</h2><span>tra negozi</span></div>
    <p class="hint" style="margin:-4px 0 12px">Per chiedere una mano, un cambio di monete o un consiglio. Gli avvisi per tutti vanno in bacheca.</p>
    ${ms2.length ? `<div class="list">${ms2.map(({ m, c }) => `<button class="row ${chatUnread(m.id) ? 'unread' : ''}" data-act="openchat" data-id="${m.id}"><div class="avatar" style="background-color:${esc(m.color)}">${esc(initials(m.name))}</div><span class="grow"><span class="t">${esc(m.name)}</span><span class="s">${c && c.last ? esc((c.lastFrom === uid ? 'Tu: ' : '') + c.last) : esc(m.type)}</span></span>${c && c.lastTs ? `<span class="hint" style="white-space:nowrap">${ago(c.lastTs)}</span>` : ''}</button>`).join('')}</div>`
      : `<div class="empty">Sei l’unico negozio nel gruppo. Passa l’app a un collega e dagli il codice del gruppo.</div>`}`;
  },
  tools() {
    const lp = L.localPolice, cc = L.carabinieri;
    return `<div class="section-h"><h2>Strumenti</h2></div>
    <div class="group"><span class="eyebrow">Numeri utili</span><div class="list">
     <div class="num sos"><span style="flex:1;min-width:0"><span style="font-weight:700;display:block">Emergenza</span><span class="hint">Carabinieri, Polizia, soccorso</span></span><span class="big">112</span><a class="btn ghost sm" href="tel:112" style="text-decoration:none">Chiama</a></div>
     ${lp ? numRow(lp, 'Polizia Locale', 'del tuo comune') : ''}
     ${cc ? numRow(cc, 'Stazione Carabinieri', 'più vicina') : ''}
     ${!lp || !cc ? `<button class="row" data-act="go" data-v="settings"><span class="grow"><span class="t">Aggiungi i numeri del tuo paese</span><span class="s">Polizia Locale e stazione dei Carabinieri, dalle impostazioni</span></span></button>` : ''}
    </div></div>
    <div class="group"><span class="eyebrow">Guide rapide</span>
    <details class="guide" open><summary style="--c:${CC.banconote}"><span class="nicon">${CI.banconote}</span><span class="grow">Banconota falsa? Controllala in 10 secondi</span></summary><div class="body">
     <div class="steps"><div class="step"><b>Tocca</b>La stampa è in rilievo e la carta è croccante, non liscia né molle.</div>
     <div class="step"><b>Guarda</b>Controluce compaiono la filigrana con il ritratto e il filo di sicurezza scuro.</div>
     <div class="step"><b>Inclina</b>Il numero in basso a sinistra cambia colore da verde smeraldo a blu scuro.</div></div>
     <p class="hint" style="margin:0">Se hai un dubbio non restituire la banconota: trattienila, rilascia una ricevuta e consegnala alle forze dell’ordine o in banca.</p>
    </div></details>
    <details class="guide"><summary style="--c:${CC.pagamento}"><span class="nicon">${CI.pagamento}</span><span class="grow">Pagamenti con il telefono</span></summary><div class="body"><ul>
     <li>Conta solo la notifica della <b>tua</b> banca o del tuo POS, mai la schermata mostrata dal cliente.</li>
     <li>Un bonifico “istantaneo” può impiegare qualche minuto: se c’è fretta di portare via la merce, aspetta.</li>
     <li>Per importi alti preferisci carta o contanti verificati.</li></ul></div></details>
    <details class="guide"><summary style="--c:${CC.resto}"><span class="nicon">${CI.resto}</span><span class="grow">Truffa del resto e cambio di banconote</span></summary><div class="body"><ul>
     <li>Un’operazione alla volta: chiudi il cassetto prima di iniziarne un’altra.</li>
     <li>Lascia la banconota ricevuta sul banco finché il resto non è stato consegnato.</li>
     <li>Se il cliente cambia idea più volte, ricomincia da zero e conta ad alta voce.</li></ul></div></details>
    <details class="guide" id="guide-denuncia"><summary style="--c:var(--accent)"><span class="nicon">${I.shield}</span><span class="grow">Come fare una denuncia congiunta</span></summary><div class="body"><ul>
     <li>Ogni negozio colpito sporge la propria denuncia, nello stesso giorno se possibile, citando gli episodi simili negli altri negozi.</li>
     <li>Portate date, orari, importi, scontrini e le banconote trattenute.</li>
     <li>Le immagini della videosorveglianza si consegnano solo alle forze dell’ordine: non vanno pubblicate né girate nei gruppi.</li>
     <li>Coordinatevi nei Messaggi per scegliere il giorno e la caserma.</li></ul></div></details>
    </div>`;
  },
  settings() {
    const p = prefs();
    const pushRow = {
      on: ['<span class="pill on">Attive</span>', 'Arrivano anche ad app chiusa'],
      wait: ['<span class="pill wait">In attivazione</span>', 'Un attimo…'],
      denied: ['<span class="pill off">Bloccate</span>', 'Attivale da Impostazioni Android > App > Allerta Botteghe > Notifiche'],
      error: ['<span class="pill off">Errore</span>', 'Controlla la connessione e riapri l’app'],
      web: ['<span class="pill wait">Solo nell’app</span>', 'Le notifiche push funzionano nell’app Android installata']
    }[pushState];
    return `<div class="section-h"><h2>Impostazioni</h2></div>
    <div class="group"><span class="eyebrow">Profilo del negozio</span>
     <div class="list"><div class="pbanner" style="--c:${esc(me.color)}"><div class="avatar xl" style="background-color:rgba(255,255,255,.18)">${esc(initials(me.name))}</div><div><b>${esc(me.name)}</b><span>${esc(me.type)} · ${esc(me.open)}–${esc(me.close)}</span></div></div>
     <form class="form form-pad" data-form="profile">
      <div class="f" style="display:flex;flex-direction:column;gap:8px">Colore del negozio
       <div class="swatches" role="group" aria-label="Colore del negozio">${COLORS.map(c => `<button type="button" data-act="color" data-v="${c}" style="background:${c}" aria-label="Colore ${c}" aria-pressed="${me.color === c}"></button>`).join('')}</div></div>
      <label class="f">Nome del negozio<input class="input" id="p-name" value="${esc(me.name)}" maxlength="40"></label>
      <label class="f">Tipo di attività<select class="input" id="p-type">${TYPES.map(t => `<option ${t === me.type ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <div class="two"><label class="f">Apre alle<input class="input" type="time" id="p-open" value="${esc(me.open)}"></label>
      <label class="f">Chiude alle<input class="input" type="time" id="p-close" value="${esc(me.close)}"></label></div>
      <label class="f">Presentazione<textarea class="input" id="p-bio" maxlength="160" style="min-height:70px">${esc(me.bio || '')}</textarea></label>
      <div class="actions"><button class="btn" type="submit">Salva profilo</button></div>
     </form></div></div>

    <div class="group"><span class="eyebrow">Aspetto</span><div class="list">
     <div class="row"><span class="grow"><span class="t">Tema</span></span><div class="seg" role="group" aria-label="Tema">${[['system', 'Auto'], ['light', 'Chiaro'], ['dark', 'Scuro']].map(([k, l]) => `<button data-act="theme" data-v="${k}" aria-pressed="${L.theme === k}">${l}</button>`).join('')}</div></div>
     <div class="row"><span class="grow"><span class="t">Dimensione testo</span></span><div class="seg" role="group" aria-label="Dimensione testo">${[[0.92, 'A−'], [1, 'A'], [1.12, 'A+'], [1.25, 'A++']].map(([k, l]) => `<button data-act="size" data-v="${k}" aria-pressed="${L.size == k}">${l}</button>`).join('')}</div></div>
    </div></div>

    <div class="group"><span class="eyebrow">Notifiche</span><div class="list">
     <div class="row"><span class="grow"><span class="t">Notifiche push</span><span class="s" style="white-space:normal">${pushRow[1]}</span></span>${pushRow[0]}</div>
     ${native ? `<div class="row"><span class="grow"><span class="t">Prova le notifiche</span><span class="s" style="white-space:normal">Tocca Prova e chiudi l’app: dopo 10 secondi arriva una notifica</span></span><button class="btn ghost sm" data-act="testpush">Prova</button></div>` : ''}
     ${sw('onlyUrgent', 'Solo avvisi urgenti', 'Gli altri restano in bacheca senza avvisarti', p.onlyUrgent)}
     ${sw('quiet', 'Silenzio a negozio chiuso', `Dalle ${esc(me.close)} alle ${esc(me.open)} le notifiche arrivano senza suono`, p.quiet)}
     ${Object.entries(CATS).map(([k, l]) => sw('cat-' + k, l, '', p.cats[k] !== false)).join('')}
    </div>
    <p class="hint" style="margin:8px 6px 0">Su Xiaomi, Huawei, Oppo e alcuni Samsung togli l’app dal risparmio energetico, altrimenti il telefono può bloccare le notifiche ad app chiusa.</p></div>

    <div class="group"><span class="eyebrow">Numeri del paese</span><form class="list form form-pad" data-form="nums">
     <label class="f">Polizia Locale<input class="input" id="n-lp" inputmode="tel" value="${esc(L.localPolice)}" placeholder="Numero del comando"></label>
     <label class="f">Stazione Carabinieri<input class="input" id="n-cc" inputmode="tel" value="${esc(L.carabinieri)}" placeholder="Numero della stazione"></label>
     <div class="actions"><button class="btn ghost" type="submit">Salva numeri</button></div></form></div>

    <div class="group"><span class="eyebrow">Gruppo e inviti</span><div class="list">
     <div class="row"><span class="grow"><span class="t">Codice del gruppo</span><span class="s">Serve al nuovo negozio al primo avvio</span></span><span class="mono" style="user-select:all">${esc(groupCode || '—')}</span>${groupCode ? `<button class="btn ghost sm" data-act="copy" data-v="${esc(groupCode)}">Copia</button>` : ''}</div>
     <div class="row"><span class="grow"><span class="t">Come invitare un collega</span><span class="s" style="white-space:normal">Passagli il file APK di persona (WhatsApp, Bluetooth o chiavetta) e dettagli il codice. Non esistono link di invito.</span></span></div>
    </div></div>

    <div class="group"><span class="eyebrow">Regole del gruppo</span><div class="privacy">${I.shield}<div>Qui si segnalano <b>episodi e metodi</b>, mai persone: niente nomi, iniziali, foto, indirizzi o targhe. L’app blocca gli avvisi che li contengono. Per chi ruba o truffa la strada è la denuncia.</div></div></div>

    <button class="lightning" data-act="bolt" aria-label="Accesso Superadmin"><span class="bolt">${I.bolt}</span><span class="grow"><span style="font-weight:700;display:block">Superadmin</span><span class="hint">Gestione membri e avvisi</span></span></button>
    <p class="hint" style="text-align:center;margin-top:18px">Allerta Botteghe · versione 1.0</p>`;
  },
  admin() {
    if (!isAdmin) { view = 'settings'; return views.settings(); }
    const others = Object.values(members).filter(m => m.id !== uid).sort((a, b) => a.name.localeCompare(b.name));
    return `<div class="section-h" style="justify-content:flex-start;gap:10px"><button class="iconbtn" data-act="go" data-v="settings" aria-label="Torna alle impostazioni">${I.back}</button><span class="bolt" style="width:36px;height:36px;border-radius:11px">${I.bolt}</span><h2>Superadmin</h2><span style="margin-left:auto"><button class="btn ghost sm" data-act="logout">Esci</button></span></div>
    <div class="stat"><div><b>${activeMembers().length}</b><span>negozi attivi</span></div><div><b>${posts.length}</b><span>avvisi</span></div><div><b>${posts.filter(p => p.meToo.length + 1 >= SERIES_AT).length}</b><span>serie aperte</span></div></div>
    <div class="group"><span class="eyebrow">Membri</span><div class="list">
     ${others.length ? others.map(m => `<div class="row"><div class="avatar" style="background-color:${esc(m.color)};${m.suspended ? 'opacity:.4' : ''}">${esc(initials(m.name))}</div><span class="grow"><span class="t">${esc(m.name)}</span><span class="s">${esc(m.type)} · ${m.suspended ? 'sospeso' : 'entrato ' + ago(m.joined)}</span></span>
      <button class="btn ghost sm" data-act="editm" data-id="${m.id}">Modifica</button></div>`).join('') : `<div class="empty" style="box-shadow:none">Nessun altro membro per ora.</div>`}
    </div></div>
    <div class="group"><span class="eyebrow">Avvisi pubblicati</span><div class="list">
     ${posts.length ? posts.map(p => `<div class="row"><span class="grow"><span class="t">${esc(p.title)}</span><span class="s">${esc(who(p.author).name)} · ${ago(p.ts)}</span></span><button class="btn ghost sm" data-act="delpost" data-id="${p.id}">Elimina</button></div>`).join('') : `<div class="empty" style="box-shadow:none">Nessun avviso.</div>`}
    </div></div>
    <div class="group"><span class="eyebrow">Gruppo</span><div class="list">
     <div class="row"><span class="grow"><span class="t">Codice attuale</span><span class="s">${esc(groupCode)}</span></span></div>
     <div class="row"><span class="grow"><span class="t">Rigenera codice gruppo</span><span class="s" style="white-space:normal">Il vecchio codice smette di funzionare. I negozi già dentro restano</span></span><button class="btn ghost sm" data-act="regen">Rigenera</button></div>
    </div></div>`;
  }
};

function postCard(p) {
  const a = who(p.author), n = p.meToo.length + 1, own = p.author === uid, mine = p.meToo.includes(uid), series = n >= SERIES_AT;
  return `<article class="post" style="--c:${CC[p.cat] || CC.altro}">
   ${p.urgent ? '<div class="live"><span class="live-dot"></span>In corso · urgente</div>' : ''}
   <div class="post-body">
    <div class="post-head"><div class="cat-ic">${CI[p.cat] || CI.altro}</div>
     <div class="grow"><span class="cat-l">${esc(CATS[p.cat] || 'Altro')}</span><span class="meta">${ago(p.ts)}</span></div>
     ${p.amount ? `<span class="amount">${esc(p.amount)} €</span>` : ''}</div>
    <h3>${esc(p.title)}</h3><p>${esc(p.text)}</p>
    ${series ? `<div class="series-box"><div class="txt"><b>Serie: ${n} negozi colpiti</b>Lo stesso metodo si sta ripetendo in paese.</div><button class="btn sm" data-act="denuncia">Denuncia congiunta</button></div>`
      : `<div class="meter"><span class="segs" aria-hidden="true">${Array.from({ length: SERIES_AT }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span><span>${n} di ${SERIES_AT} negozi per aprire una serie</span></div>`}
   </div>
   <div class="post-foot"><span class="author"><span class="mini" style="background:${esc(a.color)}">${esc(initials(a.name))}</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.name)}</span></span>
   ${own ? `<button class="linkbtn" data-act="delmine" data-id="${p.id}" style="color:var(--muted)">Elimina</button>` : `<button class="metoo" data-act="metoo" data-id="${p.id}" aria-pressed="${mine}">${mine ? '✓ Anche a me' : 'È successo anche a me'}</button>`}</div>
  </article>`;
}
function numRow(n, t, s) { return `<div class="num"><span style="flex:1;min-width:0"><span style="font-weight:650;display:block">${esc(t)}</span><span class="hint">${esc(s)}</span></span><span class="big">${esc(n)}</span><button class="btn ghost sm" data-act="copy" data-v="${esc(n)}">Copia</button></div>`; }
function sw(id, t, s, on) { return `<label class="row" for="sw-${id}"><span class="grow"><span class="t">${esc(t)}</span>${s ? `<span class="s" style="white-space:normal">${s}</span>` : ''}</span><span class="switch"><input type="checkbox" id="sw-${id}" data-sw="${id}" ${on ? 'checked' : ''}><span></span></span></label>`; }

/* ================= Fogli (sheet) ================= */
function sheet(html) {
  $('#layer').innerHTML = `<div class="overlay" data-act="closesheet"><div class="sheet wrap" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div></div>`;
  const f = $('#layer input:not([type=radio]), #layer textarea'); if (f) f.focus();
}
function closeSheet() { $('#layer').innerHTML = ''; }
const sheetOpen = () => !!$('#layer .overlay');

function newPostSheet() {
  sheet(`<h2>Nuovo avviso</h2>
  <form class="form" data-form="post">
   <div class="privacy">${I.shield}<div>Descrivi <b>cosa è successo e come</b>, non chi è stato. Niente nomi, iniziali, foto, indirizzi o targhe.</div></div>
   <div class="f" style="display:flex;flex-direction:column;gap:8px">Tipo di episodio
    <div class="catpick" role="radiogroup" aria-label="Tipo di episodio">${Object.entries(CATS).map(([k, l], i) => `<label style="--c:${CC[k]}"><input type="radio" name="np-cat" value="${k}" ${i === 0 ? 'checked' : ''}><span class="cat-ic">${CI[k]}</span>${l}</label>`).join('')}</div></div>
   <label class="f">Titolo<input class="input" id="np-title" maxlength="80" required placeholder="Es. Banconote da 20 € false alla cassa"></label>
   <label class="f">Cosa è successo<textarea class="input" id="np-text" maxlength="600" required placeholder="Il metodo usato, quando, come riconoscerlo, cosa fare."></textarea></label>
   <div class="two"><label class="f">Importo (€)<input class="input" id="np-amount" inputmode="decimal" maxlength="10" placeholder="Facoltativo"></label>
   <label class="f">Urgenza<span class="row" style="padding:8px 0;border:0"><span class="grow hint">Sta succedendo ora</span><span class="switch"><input type="checkbox" id="np-urgent"><span></span></span></span></label></div>
   <div id="np-err"></div>
   <div class="actions"><button type="button" class="btn ghost" data-act="closesheet">Annulla</button><button class="btn" type="submit" id="np-btn">Pubblica e avvisa tutti</button></div>
  </form>`);
}
function adminLoginSheet() {
  sheet(`<h2 style="display:flex;align-items:center;gap:12px"><span class="bolt">${I.bolt}</span>Accesso Superadmin</h2>
  <form class="form" data-form="admin"><label class="f">Password<input class="input" type="password" id="ad-pw" autocomplete="current-password"></label><div id="ad-err"></div>
  <div class="actions"><button type="button" class="btn ghost" data-act="closesheet">Annulla</button><button class="btn" type="submit" id="ad-btn">Entra</button></div></form>`);
}
function memberSheet(m) {
  sheet(`<h2>Modifica negozio</h2>
  <form class="form" data-form="member" data-id="${m.id}">
   <label class="f">Nome<input class="input" id="me-name" value="${esc(m.name)}" required maxlength="40"></label>
   <label class="f">Tipo<select class="input" id="me-type">${TYPES.map(t => `<option ${t === m.type ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
   <div class="f" style="display:flex;flex-direction:column;gap:8px">Colore<div class="swatches" role="radiogroup">${COLORS.map(c => `<label style="position:relative"><input type="radio" name="me-color" value="${c}" ${c === m.color ? 'checked' : ''} style="position:absolute;opacity:0"><span class="sw-dot" style="background:${c}"></span></label>`).join('')}</div></div>
   ${sw('susp', 'Sospeso', 'Non vede la bacheca e non riceve notifiche', m.suspended).replace('class="row"', 'class="row" style="padding:4px 0;border:0"')}
   <div class="actions"><button type="button" class="btn danger" data-act="delm" data-id="${m.id}">Rimuovi</button><span style="flex:1"></span><button type="button" class="btn ghost" data-act="closesheet">Annulla</button><button class="btn" type="submit">Salva</button></div>
  </form>`);
}
function confirmSheet(text, action, id) {
  sheet(`<h2>${esc(text)}</h2><p class="hint" style="margin:-6px 0 16px">L’operazione non si può annullare.</p><div class="actions"><button class="btn ghost" data-act="closesheet">Annulla</button><button class="btn danger" data-act="${action}" data-id="${id || ''}">Conferma</button></div>`);
}

/* ================= Chat ================= */
async function openChat(other) {
  chatWith = other; view = 'chat'; thread = []; lastThreadLen = -1;
  render();
  const cid = cidOf(other);
  try {
    await setDoc(doc(fb.db, 'chats', cid), { members: [uid, other].sort() }, { merge: true });
  } catch (e) { toast(errText(e)); return; }
  if (threadUnsub) threadUnsub();
  threadUnsub = onSnapshot(query(collection(fb.db, 'chats', cid, 'messages'), orderBy('ts', 'asc'), limit(300)), s => {
    thread = s.docs.map(d => ({ id: d.id, ...d.data(), ts: ms(d.data().ts) }));
    L.seenChats[cid] = Date.now(); saveL(); render();
  }, () => {});
}
function closeChat() { chatWith = null; if (threadUnsub) { threadUnsub(); threadUnsub = null; } thread = []; render(); }

/* ================= Eventi ================= */
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const a = el.dataset.act, v = el.dataset.v, id = el.dataset.id;
  if (a === 'closesheet') { if (e.target === el || el.tagName === 'BUTTON') closeSheet(); return; }
  if (a === 'reload') { location.reload(); return; }
  if (a === 'jcolor') { joinColor = v; document.querySelectorAll('[data-act=jcolor]').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === v)); return; }
  if (phase !== 'app') return;
  try {
    switch (a) {
      case 'go': if (v !== 'chat') closeChat(); view = v; render(); return;
      case 'filter': filter = v; render(); return;
      case 'new': newPostSheet(); return;
      case 'metoo': {
        const p = posts.find(x => x.id === id); if (!p) return;
        const mine = p.meToo.includes(uid);
        await updateDoc(doc(fb.db, 'posts', id), { meToo: mine ? arrayRemove(uid) : arrayUnion(uid) });
        if (!mine) toast(p.meToo.length + 2 >= SERIES_AT ? 'Segnato. Questo metodo ora è una serie.' : 'Segnato. Grazie per la conferma.');
        return;
      }
      case 'denuncia': closeChat(); view = 'tools'; render(); requestAnimationFrame(() => requestAnimationFrame(() => { const g = $('#guide-denuncia'); if (g) { g.open = true; g.scrollIntoView({ block: 'start' }); } })); return;
      case 'delmine': confirmSheet('Eliminare il tuo avviso?', 'dodelpost', id); return;
      case 'readall': L.seenEvents = Date.now(); saveL(); render(); return;
      case 'opennotif': {
        const n = events.find(x => x.id === id); L.seenEvents = Math.max(L.seenEvents, n ? n.ts : 0); saveL();
        if (n && n.post) { view = 'feed'; filter = 'all'; } render(); return;
      }
      case 'openchat': openChat(id); return;
      case 'closechat': closeChat(); return;
      case 'theme': L.theme = v; saveL(); render(); return;
      case 'size': L.size = +v; saveL(); render(); return;
      case 'color': await updateDoc(doc(fb.db, 'members', uid), { color: v }); return;
      case 'copy': {
        const done = () => toast('Copiato: ' + v);
        try { await navigator.clipboard.writeText(v); done(); } catch (_) { toast('Tieni premuto sul testo per copiarlo'); }
        return;
      }
      case 'testpush': await call('sendTestPush', { delay: 10 }); toast('Chiudi l’app: tra 10 secondi arriva la notifica'); return;
      case 'bolt': if (isAdmin) { view = 'admin'; render(); } else adminLoginSheet(); return;
      case 'logout':
        await call('adminLogout', {}); await fb.auth.currentUser.getIdToken(true);
        isAdmin = false; view = 'settings'; render(); toast('Uscito da Superadmin'); return;
      case 'editm': memberSheet(members[id]); return;
      case 'delm': confirmSheet('Rimuovere questo negozio dal gruppo?', 'dodelm', id); return;
      case 'dodelm': { const m = members[id]; await deleteDoc(doc(fb.db, 'members', id)); closeSheet(); toast((m ? m.name : 'Negozio') + ' rimosso'); return; }
      case 'delpost': confirmSheet('Eliminare questo avviso per tutti?', 'dodelpost', id); return;
      case 'dodelpost': await deleteDoc(doc(fb.db, 'posts', id)); closeSheet(); toast('Avviso eliminato'); return;
      case 'regen': {
        const c = 'BOTTEGHE-' + Array.from(crypto.getRandomValues(new Uint8Array(4)), b => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
        await setDoc(doc(fb.db, 'config', 'group'), { code: c }); toast('Nuovo codice: ' + c); return;
      }
    }
  } catch (err) { toast(errText(err)); }
});

document.addEventListener('change', async e => {
  const k = e.target.dataset.sw; if (!k || k === 'susp' || phase !== 'app') return;
  const val = e.target.checked;
  const field = k.startsWith('cat-') ? 'prefs.cats.' + k.slice(4) : 'prefs.' + k;
  try { await updateDoc(doc(fb.db, 'members', uid), { [field]: val }); }
  catch (err) { e.target.checked = !val; toast(errText(err)); }
});

document.addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target.dataset.form;
  const busy = (btn, on) => { const b = document.getElementById(btn); if (b) b.disabled = on; };
  try {
    if (f === 'join') {
      const code = $('#j-code').value.trim().toUpperCase(), name = $('#j-name').value.trim();
      if (!code || name.length < 2) { $('#j-err').innerHTML = '<div class="alert-err">Inserisci il codice del gruppo e il nome del negozio.</div>'; return; }
      busy('j-btn', true);
      try { await call('joinGroup', { code, profile: { name, type: $('#j-type').value, color: joinColor } }); }
      catch (err) { $('#j-err').innerHTML = `<div class="alert-err">${esc(errText(err))}</div>`; busy('j-btn', false); }
      return;
    }
    if (f === 'post') {
      const title = $('#np-title').value.trim(), text = $('#np-text').value.trim();
      const issue = privacyIssue(title + ' ' + text);
      if (!title || !text) { $('#np-err').innerHTML = '<div class="alert-err">Scrivi un titolo e cosa è successo.</div>'; return; }
      if (issue) { $('#np-err').innerHTML = `<div class="alert-err">${esc(issue)} Togli i dati che identificano qualcuno e descrivi solo il metodo.</div>`; return; }
      const cat = (document.querySelector('input[name=np-cat]:checked') || { value: 'altro' }).value;
      const urgent = $('#np-urgent').checked;
      busy('np-btn', true);
      await addDoc(collection(fb.db, 'posts'), {
        cat, title, text, urgent, author: uid, ts: serverTimestamp(), meToo: [],
        amount: $('#np-amount').value.replace(/[^\d,.]/g, '').slice(0, 10)
      });
      closeSheet(); closeChat(); filter = 'all'; view = 'feed'; render();
      toast(urgent ? 'Avviso urgente inviato a tutti i negozi' : 'Avviso pubblicato in bacheca');
      return;
    }
    if (f === 'msg') {
      const t = $('#msgtext').value.trim(); if (!t || !chatWith) return;
      $('#msgtext').value = ''; clearIds.add('msgtext');
      await addDoc(collection(fb.db, 'chats', cidOf(chatWith), 'messages'), { from: uid, text: t, ts: serverTimestamp() });
      return;
    }
    if (f === 'profile') {
      const n = $('#p-name').value.trim(); if (n.length < 2) { toast('Il nome del negozio deve avere almeno 2 lettere'); return; }
      await updateDoc(doc(fb.db, 'members', uid), { name: n, type: $('#p-type').value, open: $('#p-open').value || '08:00', close: $('#p-close').value || '19:30', bio: $('#p-bio').value.trim().slice(0, 160) });
      toast('Profilo salvato'); return;
    }
    if (f === 'nums') { L.localPolice = $('#n-lp').value.trim(); L.carabinieri = $('#n-cc').value.trim(); saveL(); render(); toast('Numeri salvati'); return; }
    if (f === 'admin') {
      busy('ad-btn', true);
      try {
        await call('adminLogin', { password: $('#ad-pw').value });
        await fb.auth.currentUser.getIdToken(true);
        isAdmin = true; closeSheet(); view = 'admin'; render(); toast('Accesso Superadmin');
      } catch (err) {
        $('#ad-err').innerHTML = `<div class="alert-err">${esc(errText(err))}</div>`; busy('ad-btn', false); $('#ad-pw').select();
      }
      return;
    }
    if (f === 'member') {
      const id = e.target.dataset.id, name = $('#me-name').value.trim(); if (name.length < 2) return;
      const color = (document.querySelector('input[name=me-color]:checked') || {}).value || members[id].color;
      await updateDoc(doc(fb.db, 'members', id), { name, type: $('#me-type').value, color, suspended: $('#sw-susp').checked });
      closeSheet(); toast('Negozio salvato'); return;
    }
  } catch (err) { toast(errText(err)); ['np-btn', 'ad-btn'].forEach(b => busy(b, false)); }
});

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

if (native) {
  CapApp.addListener('backButton', () => {
    if (sheetOpen()) { closeSheet(); return; }
    if (phase === 'app' && view === 'chat' && chatWith) { closeChat(); return; }
    if (phase === 'app' && view === 'admin') { view = 'settings'; render(); return; }
    if (phase === 'app' && view !== 'feed') { closeChat(); view = 'feed'; render(); return; }
    CapApp.exitApp();
  });
  CapApp.addListener('resume', () => render());
}
setInterval(render, 60e3); // aggiorna i "x min fa"

render();
boot();
