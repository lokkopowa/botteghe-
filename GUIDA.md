# Allerta Botteghe: messa in funzione

Questa guida porta l'app da questa cartella a un APK installato sui telefoni dei commercianti, con le notifiche che arrivano anche ad app chiusa. Va fatta una volta sola. Tempo previsto: circa un'ora.

## Cosa ti serve

- Un account Google, per Firebase
- Un account GitHub gratuito, che compila l'APK al posto tuo
- Un computer con **Node.js 22** (da nodejs.org, versione LTS), solo per il passo 5
- Il file **CHIAVE-FIRMA.txt** che ti ho consegnato insieme al progetto

## Come funziona

- **Firebase Firestore** è il database condiviso: avvisi, profili, messaggi.
- **Firebase Authentication** identifica ogni telefono senza password. L'ingresso nel gruppo avviene solo con il codice.
- **Cloud Functions** è il piccolo server che controlla il codice del gruppo e la password del Superadmin, e manda le notifiche push.
- **Firebase Cloud Messaging** consegna le notifiche anche ad app chiusa.

---

## Passo 1: crea il progetto Firebase

1. Vai su console.firebase.google.com e scegli **Crea un progetto**.
2. Chiamalo `allerta-botteghe`. Google Analytics non serve.

## Passo 2: piano, accesso e database

1. **Piano Blaze.** In basso a sinistra, *Esegui l'upgrade* e scegli Blaze. È obbligatorio per le Cloud Functions, cioè per le notifiche ad app chiusa. Chiede una carta, ma le soglie gratuite sono ampie: 2 milioni di chiamate al mese, notifiche push gratuite e 50.000 letture al giorno. Per un gruppo di negozi di paese il costo atteso è 0 €, al massimo qualche centesimo al mese per l'archivio del server.
2. **Avviso di spesa.** Subito dopo imposta un avviso di budget di 1 €: console.cloud.google.com, poi *Fatturazione*, *Budget e avvisi*. Se qualcosa andasse storto lo sapresti subito.
3. **Accesso anonimo.** Vai su *Authentication*, poi *Inizia*, poi la scheda *Metodo di accesso*. Attiva **Anonimo**.
4. **Database.** Vai su *Firestore Database* e scegli *Crea database*. Seleziona la **modalità di produzione** e come posizione **europe-west1 (Belgio)**. La posizione è importante, perché il server è configurato su quella regione.

## Passo 3: collega l'app (configurazione web)

1. In *Impostazioni progetto* (la rotellina), sezione *Le tue app*, tocca l'icona **`</>`** (Web). Come nome metti `allerta-web`; Hosting non serve.
2. Firebase ti mostra un blocco `firebaseConfig`. Copia i valori nel file **`src/firebase-config.js`** al posto delle scritte `INSERISCI`.

## Passo 4: registra l'app Android

1. Sempre in *Le tue app*, scegli **Aggiungi app** e poi l'icona Android.
2. Come nome pacchetto scrivi esattamente **`it.allertabotteghe.app`**.
3. Scarica **`google-services.json`** e tienilo da parte. Non va messo nella cartella del progetto, ti serve al passo 6.

## Passo 5: pubblica il server (una volta sola, dal computer)

Apri un terminale nella cartella del progetto e lancia, uno alla volta:

```
npm install -g firebase-tools
firebase login
firebase use --add
```

Con `firebase use --add` scegli il progetto `allerta-botteghe` e come alias scrivi `default`.

Poi imposta la password del Superadmin. Resta sul server e non è scritta nell'app:

```
firebase functions:secrets:set ADMIN_PASSWORD
```

Quando la chiede, scrivi `commerciantiMolesti` e premi Invio.

Infine installa e pubblica:

```
cd functions
npm install
cd ..
firebase deploy --only firestore:rules,functions
```

Se ti chiede **GROUP_CODE**, premi Invio per usare `BOTTEGHE-2026`. Dopo il primo accesso lo cambi dal pannello Superadmin.

## Passo 6: fai compilare l'APK a GitHub

1. Su github.com crea un repository **privato** chiamato `allerta-botteghe`.
2. Carica tutta la cartella del progetto, compresa la cartella nascosta `.github`. Il modo più semplice è con **GitHub Desktop**: *Add local repository*, poi *Publish*.
3. Nel repository vai su *Settings*, *Secrets and variables*, *Actions* e usa **New repository secret** per crearne tre:

| Nome | Valore |
|---|---|
| `GOOGLE_SERVICES_JSON` | Tutto il contenuto del file `google-services.json` (aprilo con il Blocco note, copia e incolla) |
| `KEYSTORE_BASE64` | Il testo lungo della sezione 1 di `CHIAVE-FIRMA.txt` |
| `KEYSTORE_PASSWORD` | La password della sezione 2 di `CHIAVE-FIRMA.txt` |

4. Vai su **Actions**, scegli **Crea APK** e poi **Run workflow**. Ci vogliono circa 8 minuti.
5. A lavoro finito, apri l'esecuzione e scarica **AllertaBotteghe-APK** in fondo alla pagina. È uno zip che contiene l'APK.

Ogni volta che modifichi l'app e carichi le modifiche su GitHub, l'APK si ricompila da solo con un numero di versione più alto.

## Passo 7: installa e crea il gruppo

1. Passa l'APK al telefono (WhatsApp, Bluetooth, cavo) e aprilo. Android chiede di consentire l'installazione da questa fonte: conferma.
2. Al primo avvio inserisci il codice `BOTTEGHE-2026` e il profilo del tuo negozio. Consenti le notifiche.
3. Vai su **Profilo**, poi sul pulsante **fulmine**, e inserisci `commerciantiMolesti`. Nel pannello Superadmin tocca **Rigenera codice**: il gruppo avrà così un codice tutto suo.
4. Per invitare un collega: passagli l'APK di persona e dettagli il codice.

## Passo 8: verifica le notifiche ad app chiusa

In **Profilo**, sezione *Notifiche*, tocca **Prova** e chiudi subito l'app, togliendola anche dalle app recenti. Dopo 10 secondi deve arrivare "Notifica di prova".

Se non arriva:
- Controlla che le notifiche dell'app siano consentite: *Impostazioni Android*, *App*, *Allerta Botteghe*, *Notifiche*.
- Su **Xiaomi, Huawei, Oppo, Realme e alcuni Samsung** togli l'app dal risparmio energetico e, dove c'è, attiva l'*Avvio automatico*. Questi telefoni chiudono le app in modo aggressivo e possono bloccare le notifiche.

## Come sono fatte le notifiche

| Canale Android | Quando | Suono |
|---|---|---|
| Avvisi urgenti | Avviso "sta succedendo ora", serie rilevata | Sì, priorità massima |
| Avvisi | Nuovo avviso normale, nuovo negozio | Sì |
| Messaggi | Messaggio privato da un negozio | Sì |
| A negozio chiuso | Tutto ciò che arriva fuori dal tuo orario, se il silenzio è attivo | No |

Ognuno sceglie dalle impostazioni quali categorie ricevere e se vuole solo gli urgenti. Le scelte valgono sul server, quindi funzionano anche ad app chiusa.

## Sicurezza, in breve

- Solo chi ha il codice del gruppo entra; dopo 8 tentativi sbagliati in un'ora il telefono viene bloccato per un'ora.
- La password Superadmin è controllata sul server, con al massimo 6 tentativi all'ora. Non si può estrarre dall'APK.
- Le regole del database impediscono a chiunque non sia nel gruppo di leggere qualsiasi cosa. Un negozio sospeso o rimosso perde subito l'accesso.
- Il controllo privacy (iniziali, nomi, telefoni, targhe, indirizzi) gira sia nell'app sia sul server.

## Custodisci la chiave di firma

`CHIAVE-FIRMA.txt` e il file `allerta.keystore` firmano l'APK. Conservane una copia sicura, per esempio su una chiavetta. Se li perdi, i telefoni non potranno installare gli aggiornamenti sopra la versione vecchia: andrebbe disinstallata, e ogni negozio dovrebbe rientrare nel gruppo.

## Provare l'app sul computer (facoltativo)

```
npm install
npm run dev
```

Si apre nel browser e funziona tutto tranne le notifiche push, che esistono solo nell'app Android.
