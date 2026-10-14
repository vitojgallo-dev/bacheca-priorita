# Cose da fare

Il foglio delle priorità (importante urgente · importante non urgente · non importante non urgente)
con un elenco da spuntare per ogni parte. Si apre dal browser su iPhone, Android, Windows e Mac, si può installare come app e
resta uguale su tutti i dispositivi di chi entra con la stessa email.

App: https://vitojgallo-dev.github.io/bacheca-priorita/

## Come funziona

- La pagina è statica (GitHub Pages). Le voci stanno su **Firebase Firestore**, in
  `utenti/<id della persona>/note`. Ognuno vede solo le sue: lo decidono le regole in `firestore.rules`.
- Si entra con email e password (Firebase Authentication). Si fa una volta per dispositivo, poi resta dentro.
- Senza internet la pagina si apre lo stesso (service worker) e le modifiche partono quando torna la connessione.
- Il contenuto delle voci è **cifrato sul dispositivo** prima di partire: nel database, e quindi anche nella
  console di Firebase, si legge solo testo illeggibile. Chi usa l'app non se ne accorge. Vedi «Cifratura».

## Messa in funzione (una volta sola)

### 1. Progetto Firebase

1. Vai su https://console.firebase.google.com e premi **Crea un progetto**. Nome: `cose-da-fare`.
   Google Analytics non serve.
2. Menu a sinistra **Build → Authentication → Inizia**. Scheda **Metodo di accesso** →
   **Email/password** → attiva il primo interruttore → **Salva**.
3. **Authentication → Impostazioni → Domini autorizzati → Aggiungi dominio**: `vitojgallo-dev.github.io`.
4. **Build → Firestore Database → Crea database**. Posizione `eur3 (europe-west)`, avvio in
   **modalità di produzione**.
5. Nella scheda **Regole** del database cancella tutto, incolla il contenuto di `firestore.rules` e premi **Pubblica**.
6. Ingranaggio in alto a sinistra → **Impostazioni progetto** → in fondo **Le tue app** → icona **`</>`**
   (Web). Soprannome `bacheca`, Firebase Hosting **no** → **Registra app**.
   Copia i valori di `firebaseConfig` dentro `firebase-config.js`.

Il piano gratuito (Spark) basta e avanza: 50.000 letture e 20.000 scritture al giorno.

### 2. GitHub Pages

1. Crea il repository vuoto `bacheca-priorita` su GitHub (pubblico, senza README).
2. `git push -u origin main`
3. Nel repository: **Settings → Pages → Build and deployment → Deploy from a branch** → `main` e `/ (root)` → **Save**.
   Dopo un minuto l'app è all'indirizzo sopra.

## Usarla

- **Computer**: apri il link, premi «Prima volta? Crea il tuo accesso», scegli email e password.
  In Chrome o Edge puoi installarla dall'icona nella barra dell'indirizzo.
- **iPhone**: apri il link in **Safari** → pulsante Condividi → **Aggiungi alla schermata Home** →
  apri l'icona ed entra con la stessa email e password.
- **Password dimenticata**: scrivi l'email nella schermata di accesso e premi «Password dimenticata».

## Aggiornare l'app

Dopo aver cambiato un file, alza `VERSIONE` in `sw.js` (es. `v2`), poi commit e push.
I dispositivi prendono la nuova versione alla prossima apertura con internet.

### Un aggiornamento non deve mai toccare le voci scritte

L'app (questi file, su GitHub) e le voci (su Firestore) sono separate: pubblicare una versione
nuova non cancella niente. Restano tre modi per far *sparire* le voci, e vanno evitati:

1. **Cambiare la forma dei dati.** Il percorso `utenti/<id>/note`, il documento `_chiave`, i campi
   in chiaro (`q`, `stato`, `creato`, `aggiornato`, `fatto`, `v`, `c`) e quelli dentro la parte cifrata
   (`titolo`, `persona`, `quando`, `dettagli`, `tel`, `email`, `rif`) sono un contratto con i dati già salvati. Si possono **aggiungere**
   campi nuovi; rinominarli o spostarli no, a meno di scrivere prima una conversione che
   aggiorna le voci esistenti.
2. **Cambiare `firebase-config.js`** verso un altro progetto: la lista apparirebbe vuota.
3. **Cambiare `firestore.rules`** senza provarle: l'app non leggerebbe più niente.

Le parti di una volta che non esistono più vengono lette lo stesso (`qOf()` in `app.js` porta
una parte sconosciuta in "Non importante non urgente"), e le modifiche conservano i campi che
la versione corrente non conosce. Prima di un cambiamento grosso: **scarica una copia Excel**.

## Cifratura

Ogni persona ha una sua **chiave dati** (AES-GCM 256), creata dall'app al primo accesso. Le voci si
cifrano con quella sul dispositivo (`cifratura.js`); nel database restano in chiaro solo parte, stato e date.

La chiave dati non è mai nel database in chiaro. Il documento `utenti/<id>/note/_chiave` la contiene
avvolta in due modi, e ne basta uno per riaverla:

- `utente`: con la **password di accesso** (PBKDF2-SHA256, 600.000 giri). Per questo chi la usa non deve
  ricordare niente in più;
- `riserva`: con la **chiave pubblica di riserva** dell'amministratore (`chiave-riserva.js`, RSA-OAEP 3072).
  La privata corrispondente **non è nel repository**: sta in `G:\chiavi\bacheca-priorita\` sul PC di Vito.

Più una `verifica`, un testo noto cifrato con la chiave dati, che serve a riconoscere la chiave giusta.

Sul dispositivo la chiave resta salvata (IndexedDB) finché non si preme «Esci», che cancella anche la
copia delle voci. Per questo l'app si riapre senza password.

**Cambio di password** («Password dimenticata»):

- sul dispositivo dove si entra c'è già la chiave: l'app la riconosce con la `verifica` e la riavvolge con
  la password nuova da sola, senza chiedere niente;
- dispositivo nuovo: l'app chiede **una volta** la password di prima;
- dispositivo nuovo e password di prima dimenticata: solo l'amministratore, con la chiave privata di
  riserva, può riaprire la chiave dati. Lo strumento di recupero non è ancora scritto, si fa quando serve:
  riapre `riserva` con `apriConRiserva()` di `cifratura.js` e riavvolge la chiave per la persona.

Le voci di prima della cifratura vengono convertite da sole al primo accesso. Una voce scritta in chiaro
da una versione vecchia rimasta su qualche dispositivo viene letta lo stesso e ricifrata.

**Non cambiare `chiave-riserva.js`**: le persone già attive resterebbero con la copia avvolta da quella vecchia.

## File

| File | Cosa contiene |
|---|---|
| `index.html` | le viste: accesso, apertura, voci bloccate, bacheca, finestra della voce |
| `style.css` | l'aspetto: le tre parti, gli elenchi a pallini, versione telefono |
| `app.js` | accesso, sblocco della chiave, lettura e scrittura su Firestore, disegno, copia Excel |
| `cifratura.js` | chiave dati, avvolgimenti, cifratura delle voci |
| `chiave-riserva.js` | la chiave **pubblica** di riserva dell'amministratore |
| `firebase-config.js` | i dati del progetto Firebase (non sono segreti) |
| `firestore.rules` | chi può leggere e scrivere cosa |
| `sw.js` | la copia offline della pagina |
| `manifest.webmanifest`, `icone/` | installazione come app |
