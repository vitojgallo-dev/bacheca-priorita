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

1. **Cambiare la forma dei dati.** Il percorso `utenti/<id>/note` e i nomi dei campi
   (`titolo`, `persona`, `quando`, `q`, `stato`, `dettagli`, `tel`, `email`, `rif`, `creato`,
   `aggiornato`, `fatto`) sono un contratto con i dati già salvati. Si possono **aggiungere**
   campi nuovi; rinominarli o spostarli no, a meno di scrivere prima una conversione che
   aggiorna le voci esistenti.
2. **Cambiare `firebase-config.js`** verso un altro progetto: la lista apparirebbe vuota.
3. **Cambiare `firestore.rules`** senza provarle: l'app non leggerebbe più niente.

Le parti di una volta che non esistono più vengono lette lo stesso (`qOf()` in `app.js` porta
una parte sconosciuta in "Non importante non urgente"), e le modifiche conservano i campi che
la versione corrente non conosce. Prima di un cambiamento grosso: **scarica una copia Excel**.

## File

| File | Cosa contiene |
|---|---|
| `index.html` | le tre viste: accesso, bacheca, finestra del post-it |
| `style.css` | l'aspetto: foglio a quadretti, post-it, versione telefono |
| `app.js` | accesso, lettura e scrittura su Firestore, disegno della bacheca |
| `firebase-config.js` | i dati del progetto Firebase (non sono segreti) |
| `firestore.rules` | chi può leggere e scrivere cosa |
| `sw.js` | la copia offline della pagina |
| `manifest.webmanifest`, `icone/` | installazione come app |
