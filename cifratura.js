// Cifratura delle voci sul dispositivo, prima che arrivino al database.
//
// Ogni persona ha una chiave dati (AES-GCM 256) generata a caso. Nel database la chiave
// non c'è mai in chiaro: c'è solo "avvolta" in due modi, e basta uno dei due per riaverla:
//   - con la password di accesso (PBKDF2 → AES-GCM): chi la usa non si accorge di niente;
//   - con la chiave pubblica di riserva dell'amministratore (RSA-OAEP): serve solo se una
//     persona perde tutti i dispositivi e dimentica la password. La privata non è online.
// Una "verifica" cifrata con la chiave dati dice se una chiave trovata sul dispositivo è quella
// giusta: così, dopo un cambio di password, la si riavvolge con la nuova senza chiedere niente.
//
// Funziona uguale nel browser e in Node (globalThis.crypto), così si può provare da riga di comando.

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

const ITERAZIONI = 600000;           // PBKDF2-SHA256, il minimo che consiglia OWASP
const TESTO_VERIFICA = "cose-da-fare:ok";

// Campi che restano in chiaro: servono per ordinare e dividere, e non dicono niente di sensibile.
// Tutto il resto della voce, compresi i campi che una versione futura aggiungerà, va cifrato.
export const CAMPI_IN_CHIARO = ["q", "stato", "creato", "aggiornato", "fatto"];
const RISERVATI = ["c", "v"];

/* ---------- base64 ---------- */

function aB64(buf) {
  const b = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
function daB64(s) {
  const bin = atob(s);
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return b;
}
const casuale = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

/* ---------- chiavi ---------- */

/** Una chiave dati nuova. Estraibile: va avvolta per il database e per la riserva. */
export function nuovaChiave() {
  return subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

async function chiaveDaPassword(password, sale, iterazioni) {
  const base = await subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  return subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: sale, iterations: iterazioni },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["wrapKey", "unwrapKey"],
  );
}

/** Avvolge la chiave dati con una password. */
export async function avvolgiConPassword(chiave, password) {
  const sale = casuale(16);
  const iv = casuale(12);
  const kek = await chiaveDaPassword(password, sale, ITERAZIONI);
  const avvolta = await subtle.wrapKey("raw", chiave, kek, { name: "AES-GCM", iv });
  return { sale: aB64(sale), iter: ITERAZIONI, iv: aB64(iv), chiave: aB64(avvolta) };
}

/** Riapre la chiave dati con una password. Lancia un errore se la password è sbagliata. */
export async function apriConPassword(rec, password) {
  const kek = await chiaveDaPassword(password, daB64(rec.sale), rec.iter);
  return subtle.unwrapKey(
    "raw", daB64(rec.chiave), kek, { name: "AES-GCM", iv: daB64(rec.iv) },
    { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"],
  );
}

/** Avvolge la chiave dati con la chiave pubblica di riserva (JWK RSA-OAEP). */
export async function avvolgiPerRiserva(chiave, pubblicaJwk) {
  const pub = await subtle.importKey("jwk", pubblicaJwk, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["wrapKey"]);
  const avvolta = await subtle.wrapKey("raw", chiave, pub, { name: "RSA-OAEP" });
  return { alg: "RSA-OAEP-256", kid: pubblicaJwk.kid || "", chiave: aB64(avvolta) };
}

/** Riapre la chiave dati con la privata di riserva. Serve solo allo strumento di recupero. */
export async function apriConRiserva(rec, privataJwk) {
  const priv = await subtle.importKey("jwk", privataJwk, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["unwrapKey"]);
  return subtle.unwrapKey(
    "raw", daB64(rec.chiave), priv, { name: "RSA-OAEP" },
    { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"],
  );
}

/* ---------- testo cifrato ---------- */

async function cifraTesto(chiave, testo) {
  const iv = casuale(12);
  const ct = await subtle.encrypt({ name: "AES-GCM", iv }, chiave, enc.encode(testo));
  const out = new Uint8Array(12 + ct.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ct), 12);
  return aB64(out);
}

async function decifraTesto(chiave, b64) {
  const tutto = daB64(b64);
  const pt = await subtle.decrypt({ name: "AES-GCM", iv: tutto.subarray(0, 12) }, chiave, tutto.subarray(12));
  return dec.decode(pt);
}

/** Un piccolo testo cifrato con la chiave dati, per riconoscerla più avanti. */
export const creaVerifica = (chiave) => cifraTesto(chiave, TESTO_VERIFICA);

/** true se questa chiave è quella che ha prodotto la verifica. */
export async function eLaChiave(chiave, verifica) {
  try { return (await decifraTesto(chiave, verifica)) === TESTO_VERIFICA; }
  catch { return false; }
}

/* ---------- voci ---------- */

/** true se la voce ha ancora dei campi in chiaro da cifrare (vecchia o scritta da una versione vecchia). */
export function haCampiInChiaro(doc) {
  return Object.keys(doc).some((k) => !CAMPI_IN_CHIARO.includes(k) && !RISERVATI.includes(k));
}

/** Da voce leggibile a documento per il database: in chiaro solo CAMPI_IN_CHIARO. */
export async function cifraVoce(chiave, voce) {
  const fuori = { v: 2 };
  const dentro = {};
  for (const [k, val] of Object.entries(voce)) {
    if (RISERVATI.includes(k)) continue;
    if (CAMPI_IN_CHIARO.includes(k)) fuori[k] = val;
    else dentro[k] = val;
  }
  fuori.c = await cifraTesto(chiave, JSON.stringify(dentro));
  // Prima di scrivere, si controlla che si riapra uguale: niente va al database se non è leggibile.
  const prova = JSON.parse(await decifraTesto(chiave, fuori.c));
  if (JSON.stringify(prova) !== JSON.stringify(dentro)) throw new Error("cifratura non verificata");
  return fuori;
}

/**
 * Da documento del database a voce leggibile. Accetta anche le voci vecchie in chiaro.
 * Se una versione vecchia dell'app ha scritto dei campi in chiaro accanto a "c",
 * quelli sono più recenti e vincono.
 */
export async function decifraVoce(chiave, doc) {
  const voce = {};
  if (typeof doc.c === "string") Object.assign(voce, JSON.parse(await decifraTesto(chiave, doc.c)));
  for (const [k, val] of Object.entries(doc)) if (!RISERVATI.includes(k)) voce[k] = val;
  return voce;
}
