// Personalizza il progetto Android creato da "npx cap add android":
// icone, schermata di avvio, icona e canale delle notifiche, firma e numero di versione.
import fs from 'node:fs';
import path from 'node:path';

const APP = 'android/app';
const RES = `${APP}/src/main/res`;
const run = process.env.GITHUB_RUN_NUMBER || process.env.BUILD_NUMBER || '1';

if (!fs.existsSync(APP)) { console.error('Cartella android mancante: esegui prima "npx cap add android"'); process.exit(1); }

// 1. Rimuove le immagini di avvio predefinite di Capacitor (sostituite da drawable/splash.xml)
for (const dir of fs.readdirSync(RES)) {
  const f = path.join(RES, dir, 'splash.png');
  if (fs.existsSync(f)) fs.rmSync(f);
}

// 2. Copia icone e risorse
fs.cpSync('resources/android/res', RES, { recursive: true, force: true });

// 3. AndroidManifest: permesso notifiche + icona, colore e canale predefiniti per Firebase
const mf = `${APP}/src/main/AndroidManifest.xml`;
let m = fs.readFileSync(mf, 'utf8');
if (!m.includes('android.permission.POST_NOTIFICATIONS')) {
  m = m.replace(/<application/, '<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />\n\n    <application');
}
if (!m.includes('default_notification_icon')) {
  m = m.replace(/<application[\s\S]*?>/, tag => `${tag}
        <meta-data android:name="com.google.firebase.messaging.default_notification_icon" android:resource="@drawable/ic_stat_allerta" />
        <meta-data android:name="com.google.firebase.messaging.default_notification_color" android:resource="@color/allerta_accent" />
        <meta-data android:name="com.google.firebase.messaging.default_notification_channel_id" android:value="avvisi" />`);
}
fs.writeFileSync(mf, m);

// 4. build.gradle: versione e firma con la chiave del progetto
const gf = `${APP}/build.gradle`;
let g = fs.readFileSync(gf, 'utf8');
g = g.replace(/versionCode\s+\d+/, `versionCode ${run}`).replace(/versionName\s+"[^"]*"/, `versionName "1.0.${run}"`);
if (!g.includes('signingConfigs')) {
  g = g.replace(/(\n\s*)buildTypes\s*\{/, `$1signingConfigs {
        release {
            storeFile file('allerta.keystore')
            storeType 'pkcs12'
            storePassword System.getenv('KEYSTORE_PASSWORD')
            keyAlias 'allerta'
            keyPassword System.getenv('KEYSTORE_PASSWORD')
        }
    }$1buildTypes {`);
  const bt = g.indexOf('buildTypes {');
  const rel = g.indexOf('release {', bt);
  if (rel < 0) throw new Error('Blocco release non trovato in build.gradle');
  g = g.slice(0, rel + 'release {'.length) + "\n            signingConfig signingConfigs.release" + g.slice(rel + 'release {'.length);
}
fs.writeFileSync(gf, g);

console.log(`Progetto Android pronto (versione 1.0.${run}).`);
