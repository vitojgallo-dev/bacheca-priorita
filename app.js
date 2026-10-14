// Bacheca "Cose da fare": il foglio importante/urgente in tre parti, ognuna con il suo elenco da spuntare.
// I dati stanno su Firebase (Firestore) in utenti/<id>/note: ognuno vede solo i suoi,
// uguali su tutti i dispositivi dove entra con la stessa email.
// Il contenuto delle voci viaggia e resta cifrato: vedi cifratura.js.

import { firebaseConfig } from "./firebase-config.js";
import { chiaveRiserva } from "./chiave-riserva.js";
import {
  nuovaChiave, avvolgiConPassword, apriConPassword, avvolgiPerRiserva,
  creaVerifica, eLaChiave, cifraVoce, decifraVoce, haCampiInChiaro,
} from "./cifratura.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, signOut,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, getDocFromServer, runTransaction,
  terminate, clearIndexedDbPersistence,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

// Le tre parti del foglio. Una voce con una parte sconosciuta finisce in basso.
const QUAD = {
  q1: { nome: "Importante urgente" },
  q2: { nome: "Importante non urgente" },
  q4: { nome: "Non importante non urgente" },
};
const qOf = (n) => (n.q === "q1" || n.q === "q2") ? n.q : "q4";

// Il documento con la chiave avvolta sta nella stessa collezione delle voci (così valgono
// le stesse regole del database). Gli id delle voci non cominciano mai con "_".
const ID_CHIAVE = "_chiave";

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const VISTE = ["vista-setup", "vista-accesso", "vista-attesa", "vista-blocco", "vista-bacheca"];
const show = (id) => { for (const v of VISTE) $("#" + v).hidden = v !== id; };

/* ---------- Avvio ---------- */

if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
  show("vista-setup");
  throw new Error("firebase-config.js vuoto");
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

let notes = new Map();   // id → voce già decifrata
let col = null;          // la collezione delle voci di chi è entrato
let chiave = null;       // la chiave dati, una volta sbloccata
let stopListen = null;
let loaded = false;
let passwordAppenaScritta = null;   // tenuta in memoria solo il tempo di sbloccare la chiave
let uscendo = false;

/* ---------- La chiave sul dispositivo ---------- */

// Resta qui finché non si preme «Esci»: è quella che permette di aprire l'app senza
// riscrivere la password, e di sopravvivere a un cambio di password.
const chiaveLocale = {
  apri() {
    return new Promise((ok, ko) => {
      const r = indexedDB.open("cose-da-fare-chiavi", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("chiavi");
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ko(r.error);
    });
  },
  async fai(modo, fn) {
    const d = await this.apri();
    return new Promise((ok, ko) => {
      const t = d.transaction("chiavi", modo);
      const q = fn(t.objectStore("chiavi"));
      t.oncomplete = () => { d.close(); ok(q.result); };
      t.onerror = () => { d.close(); ko(t.error); };
    });
  },
  async leggi(uid) { try { return (await this.fai("readonly", (s) => s.get(uid))) || null; } catch { return null; } },
  async scrivi(uid, k) { try { await this.fai("readwrite", (s) => s.put(k, uid)); } catch { /* resta solo in memoria */ } },
  async cancella(uid) { try { await this.fai("readwrite", (s) => s.delete(uid)); } catch { /* niente da cancellare */ } },
};

class Bloccata extends Error {}
class DaRientrare extends Error {}

/**
 * Trova la chiave dati di chi è entrato, senza chiedere niente in più.
 * - App riaperta (nessuna password a disposizione): quella sul dispositivo.
 * - Accesso con password: quella nel database, aperta con la password; la prima volta la crea.
 * - La password non la apre (è stata cambiata): se quella sul dispositivo è giusta, la si
 *   riavvolge con la password nuova. Altrimenti la voce resta bloccata (Bloccata).
 */
async function sbloccaChiave(user, password) {
  const locale = await chiaveLocale.leggi(user.uid);
  if (!password) {
    if (locale) return locale;
    throw new DaRientrare();
  }

  const ref = doc(col, ID_CHIAVE);
  const snap = await getDocFromServer(ref);

  if (!snap.exists()) {
    const k = locale || await nuovaChiave();
    const rec = {
      v: 1,
      utente: await avvolgiConPassword(k, password),
      riserva: await avvolgiPerRiserva(k, chiaveRiserva),
      verifica: await creaVerifica(k),
      creato: Date.now(),
    };
    // Se nel frattempo un altro dispositivo l'ha creata, vale la sua: mai due chiavi diverse.
    const altra = await runTransaction(db, async (tx) => {
      const s = await tx.get(ref);
      if (s.exists()) return s.data();
      tx.set(ref, rec);
      return null;
    });
    if (!altra) { await chiaveLocale.scrivi(user.uid, k); return k; }
    return apriRecord(user, altra, password, locale);
  }
  return apriRecord(user, snap.data(), password, locale);
}

async function apriRecord(user, rec, password, locale) {
  try {
    const k = await apriConPassword(rec.utente, password);
    await chiaveLocale.scrivi(user.uid, k);
    return k;
  } catch {
    // Password cambiata: la chiave sul dispositivo, se è quella giusta, si riavvolge da sola.
    if (locale && await eLaChiave(locale, rec.verifica)) {
      await updateDoc(doc(col, ID_CHIAVE), { utente: await avvolgiConPassword(locale, password), aggiornato: Date.now() });
      return locale;
    }
    throw new Bloccata();
  }
}

/* ---------- Entrata e uscita ---------- */

onAuthStateChanged(auth, async (user) => {
  if (stopListen) { stopListen(); stopListen = null; }
  notes = new Map();
  loaded = false;
  chiave = null;
  if (!user) {
    col = null;
    if (!uscendo) show("vista-accesso");
    return;
  }
  col = collection(db, "utenti", user.uid, "note");
  const password = passwordAppenaScritta;
  passwordAppenaScritta = null;
  show("vista-attesa");
  try {
    chiave = await sbloccaChiave(user, password);
  } catch (e) {
    if (e instanceof Bloccata) { mostraBlocco(user, password); return; }
    if (e instanceof DaRientrare) {
      // Accesso ricordato ma niente chiave qui (la versione di prima non cifrava, o è stata
      // cancellata la memoria del browser): si chiede la password una volta.
      await signOut(auth);
      loginMsg("", "Per proteggere le tue voci, scrivi di nuovo la tua password.");
      return;
    }
    show("vista-accesso");
    loginMsg(e && e.code === "unavailable"
      ? "Serve internet per entrare la prima volta. Controlla la connessione e riprova."
      : "Non sono riuscito ad aprire le tue voci. Riprova.", "");
    await signOut(auth);
    return;
  }
  apriBacheca(user);
});

function apriBacheca(user) {
  $("#chi").textContent = "Sei entrato come " + (user.email || "");
  show("vista-bacheca");
  render();
  setTimeout(loadXlsx, 1500);
  setSync("wait", "Collegamento…");
  stopListen = onSnapshot(col, { includeMetadataChanges: true }, (snap) => {
    leggiSnapshot(snap).catch(() => setSync("err", "Non riesco a leggere le voci: ricarica la pagina"));
  }, () => setSync("err", "Collegamento perso: ricarica la pagina"));
}

// Le voci decifrate restano in memoria finché il documento non cambia: lo stesso
// documento non si decifra due volte.
const giaDecifrate = new Map();   // id → { firma, voce }
const inConversione = new Set();
let turno = 0;

async function leggiSnapshot(snap) {
  const mio = ++turno;
  const o = new Map();
  const daConvertire = [];
  for (const d of snap.docs) {
    if (d.id.startsWith("_")) continue;
    const dati = d.data();
    const firma = JSON.stringify(dati);
    const prima = giaDecifrate.get(d.id);
    let voce;
    if (prima && prima.firma === firma) voce = prima.voce;
    else {
      try { voce = await decifraVoce(chiave, dati); }
      catch { continue; }   // cifrata con un'altra chiave: non la si mostra e non la si tocca
      giaDecifrate.set(d.id, { firma, voce });
    }
    o.set(d.id, voce);
    if (haCampiInChiaro(dati)) daConvertire.push(d.id);
  }
  if (mio !== turno) return;   // nel frattempo è arrivato uno snapshot più nuovo
  notes = o;
  loaded = true;
  if (snap.metadata.hasPendingWrites) setSync("wait", "Sto salvando…");
  else if (snap.metadata.fromCache) setSync("off", navigator.onLine ? "Collegamento…" : "Senza internet: salvo appena torna");
  else setSync("on", "Salvato e sincronizzato");
  render();
  // Le voci ancora in chiaro (di prima della cifratura) si cifrano da sole, una alla volta.
  for (const id of daConvertire) {
    if (inConversione.has(id)) continue;
    inConversione.add(id);
    cifraVoce(chiave, o.get(id))
      .then((cifrata) => setDoc(doc(col, id), cifrata))
      .catch(() => { /* resta in chiaro, ci si riprova al prossimo giro */ })
      .finally(() => inConversione.delete(id));
  }
}

$("#esci").addEventListener("click", async () => {
  // Uscire toglie da questo dispositivo sia la chiave sia la copia delle voci.
  uscendo = true;
  const uid = auth.currentUser && auth.currentUser.uid;
  if (stopListen) { stopListen(); stopListen = null; }
  try { await signOut(auth); } catch { /* si pulisce lo stesso */ }
  if (uid) await chiaveLocale.cancella(uid);
  try { await terminate(db); await clearIndexedDbPersistence(db); } catch { /* al peggio resta la cache cifrata */ }
  location.reload();
});

/* ---------- Voci bloccate (password cambiata su un dispositivo nuovo) ---------- */

let bloccoUtente = null, bloccoPassword = null;

function mostraBlocco(user, password) {
  bloccoUtente = user;
  bloccoPassword = password;
  $("#blocco-pass").value = "";
  $("#blocco-err").hidden = true;
  show("vista-blocco");
}

$("#blocco-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const vecchia = $("#blocco-pass").value;
  if (!vecchia || !bloccoUtente) return;
  const b = $("#blocco-ok");
  b.disabled = true;
  try {
    const snap = await getDocFromServer(doc(col, ID_CHIAVE));
    const k = await apriConPassword(snap.data().utente, vecchia);
    // Da qui in avanti vale la password nuova, quella con cui si è appena entrati.
    await updateDoc(doc(col, ID_CHIAVE), { utente: await avvolgiConPassword(k, bloccoPassword), aggiornato: Date.now() });
    await chiaveLocale.scrivi(bloccoUtente.uid, k);
    chiave = k;
    const u = bloccoUtente;
    bloccoUtente = bloccoPassword = null;
    apriBacheca(u);
  } catch {
    $("#blocco-err").hidden = false;
  } finally {
    b.disabled = false;
  }
});

$("#blocco-esci").addEventListener("click", () => { bloccoUtente = bloccoPassword = null; signOut(auth); });

function setSync(state, label) {
  const s = $("#sync");
  s.dataset.s = state;
  s.lastElementChild.textContent = label;
}

// Le scritture non si aspettano: con internet assente restano in coda e partono dopo.
function safe(p) {
  p.catch((e) => {
    const code = e && e.code;
    if (code === "permission-denied") showToast("Non hai il permesso di salvare qui. Prova a uscire e rientrare.", false);
    else if (code === "resource-exhausted") showToast("Troppe modifiche in poco tempo, riprova fra poco", false);
    else showToast("Non sono riuscito a salvare, riprova", false);
  });
}
// Una voce intera si scrive sempre cifrata; i ritocchi (parte, fatto) toccano solo campi in chiaro.
const put = (id, voce) => safe(cifraVoce(chiave, voce).then((c) => setDoc(doc(col, id), c)));
const patch = (id, data) => safe(updateDoc(doc(col, id), data));
const remove = (id) => safe(deleteDoc(doc(col, id)));
const newId = () => doc(col).id;

/* ---------- Accesso ---------- */

let creating = false;

function setLoginMode(c) {
  creating = c;
  $("#acc-entra").textContent = c ? "Crea il mio accesso" : "Entra";
  $("#acc-switch").textContent = c ? "Ho già un accesso: entra" : "Prima volta? Crea il tuo accesso";
  $("#acc-intro").textContent = c
    ? "Scegli la tua email e una password di almeno 6 caratteri. Usa sempre le stesse su tutti i dispositivi."
    : "Entra con la tua email e la tua password. Basta farlo una volta per ogni telefono o computer.";
  $("#acc-pass").autocomplete = c ? "new-password" : "current-password";
  $("#acc-reset").hidden = c;
  loginMsg("", "");
}

function loginMsg(err, msg) {
  $("#acc-err").textContent = err; $("#acc-err").hidden = !err;
  $("#acc-msg").textContent = msg; $("#acc-msg").hidden = !msg;
}

const AUTH_ERR = {
  "auth/invalid-email": "L'email non è scritta bene.",
  "auth/missing-password": "Scrivi la password.",
  "auth/invalid-credential": "Email o password sbagliate.",
  "auth/wrong-password": "Email o password sbagliate.",
  "auth/user-not-found": "Email o password sbagliate.",
  "auth/email-already-in-use": "Questa email ha già un accesso. Premi «Ho già un accesso: entra».",
  "auth/weak-password": "La password deve avere almeno 6 caratteri.",
  "auth/too-many-requests": "Troppi tentativi. Aspetta qualche minuto e riprova.",
  "auth/network-request-failed": "Manca internet. Controlla la connessione e riprova.",
  "auth/operation-not-allowed": "L'accesso con email non è attivo su Firebase (vedi LEGGIMI).",
};
const authErr = (e) => AUTH_ERR[e && e.code] || "Qualcosa non ha funzionato. Riprova.";

$("#acc-switch").addEventListener("click", () => setLoginMode(!creating));

$("#acc-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#acc-email").value.trim();
  const pass = $("#acc-pass").value;
  if (!email) { loginMsg("Scrivi la tua email.", ""); return; }
  if (!pass) { loginMsg("Scrivi la password.", ""); return; }
  const b = $("#acc-entra");
  b.disabled = true;
  loginMsg("", "");
  // La password serve anche ad aprire la chiave delle voci: la si passa a chi gestisce l'entrata
  passwordAppenaScritta = pass;
  try {
    if (creating) await createUserWithEmailAndPassword(auth, email, pass);
    else await signInWithEmailAndPassword(auth, email, pass);
    $("#acc-pass").value = "";
  } catch (err) {
    passwordAppenaScritta = null;
    loginMsg(authErr(err), "");
  } finally {
    b.disabled = false;
  }
});

$("#acc-reset").addEventListener("click", async () => {
  const email = $("#acc-email").value.trim();
  if (!email) { loginMsg("Scrivi prima la tua email qui sopra, poi premi di nuovo «Password dimenticata».", ""); return; }
  try {
    await sendPasswordResetEmail(auth, email);
    loginMsg("", "Ti ho mandato un'email per scegliere una nuova password. Guarda anche nella posta indesiderata.");
  } catch (err) {
    loginMsg(authErr(err), "");
  }
});

/* ---------- Date ---------- */

const fmtDay = new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "numeric", month: "long" });
const fmtTime = new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit" });
const fmtFull = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

function parseLocal(s) {
  if (!s) return null;
  const d = new Date(s.length === 10 ? s + "T00:00" : s);
  return isNaN(d) ? null : d;
}
const hasTime = (s) => typeof s === "string" && s.length > 10;
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

function whenText(s) {
  const d = parseLocal(s);
  if (!d) return null;
  const now = new Date();
  const days = Math.round((startOfDay(d) - startOfDay(now)) / 86400000);
  const t = hasTime(s) ? " alle " + fmtTime.format(d) : "";
  let label, cls = "";
  if (days === 0) { label = "Oggi" + t; cls = "today"; }
  else if (days === 1) label = "Domani" + t;
  else if (days === -1) label = "Ieri" + t;
  else { const f = fmtDay.format(d); label = f.charAt(0).toUpperCase() + f.slice(1) + t; }
  if (hasTime(s) ? d < now : days < 0) { cls = "late"; label = "Scaduto · " + label; }
  return { label, cls };
}

/* ---------- Disegno ---------- */

function sortOpen(a, b) {
  const da = parseLocal(a[1].quando), dbb = parseLocal(b[1].quando);
  if (da && dbb) return da - dbb;
  if (da) return -1;
  if (dbb) return 1;
  return (a[1].creato || 0) - (b[1].creato || 0);
}

function render() {
  const open = [...notes].filter(([, n]) => n.stato !== "fatto");
  const done = [...notes].filter(([, n]) => n.stato === "fatto");

  for (const q of Object.keys(QUAD)) {
    const box = $(`.quad[data-q="${q}"]`);
    const items = open.filter(([, n]) => qOf(n) === q).sort(sortOpen);
    box.replaceChildren();

    const head = el("div", "qhead");
    const h = el("h2", null, QUAD[q].nome);
    if (items.length) h.append(el("span", "n", String(items.length)));
    const add = el("button", "btn small", "+ Aggiungi");
    add.type = "button";
    add.setAttribute("aria-label", "Aggiungi in " + QUAD[q].nome);
    add.addEventListener("click", () => openEditor(null, q));
    head.append(h, add);

    const list = el("ul", "items");
    if (!items.length) list.append(el("li", "empty", loaded ? "Niente da fare qui." : "Caricamento…"));
    for (const [id, n] of items) list.append(itemRow(id, n));
    box.append(head, list);
  }

  done.sort((a, b) => (b[1].fatto || 0) - (a[1].fatto || 0));
  $("#fatti-n").textContent = done.length ? "(" + done.length + ")" : "";
  const ul = $("#fatti-list");
  ul.replaceChildren();
  if (!done.length) ul.append(el("li", "done-empty", "Quando tocchi il pallino di una voce, la trovi qui."));
  for (const [id, n] of done) ul.append(doneRow(id, n));
}

// Una voce dell'elenco: il pallino a sinistra la segna come fatta, il testo la apre
function itemRow(id, n) {
  const li = el("li", "item");
  li.draggable = true;
  li.dataset.id = id;

  const tick = el("button", "tick");
  tick.type = "button";
  tick.setAttribute("aria-label", "Segna come fatto: " + (n.titolo || "voce"));
  tick.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5L20 7"/></svg>';
  tick.addEventListener("click", () => markDone(id, li));

  const open = el("button", "open");
  open.type = "button";
  open.setAttribute("aria-label", "Apri " + (n.titolo || "voce"));
  open.append(el("span", "t", n.titolo || "Senza titolo"));
  const sub = el("span", "sub");
  if (n.persona) sub.append(el("span", "who", n.persona));
  const w = whenText(n.quando);
  if (w) sub.append(el("span", "when " + w.cls, w.label));
  if (n.dettagli || n.tel || n.email || n.rif) sub.append(el("span", "info", "altre informazioni"));
  if (sub.childElementCount) open.append(sub);
  open.addEventListener("click", () => openEditor(id));

  li.append(tick, open);
  li.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
    li.classList.add("dragging");
  });
  li.addEventListener("dragend", () => li.classList.remove("dragging"));
  return li;
}

function doneRow(id, n) {
  const li = el("li");
  const tick = el("span", "tick", "✓");
  const txt = el("div", "txt");
  txt.append(el("b", null, n.titolo || "Senza titolo"));
  const bits = [];
  if (n.persona) bits.push(n.persona);
  if (n.fatto) bits.push("fatto il " + fmtFull.format(new Date(n.fatto)));
  txt.append(el("span", null, bits.join(" · ")));

  const acts = el("div", "acts");
  const back = el("button", "btn small", "Rimetti tra le cose da fare");
  back.type = "button";
  back.addEventListener("click", () => reopen(id));
  const del = el("button", "btn small danger", "Elimina");
  del.type = "button";
  del.addEventListener("click", () => {
    if (del.dataset.armed) { remove(id); return; }
    del.dataset.armed = "1";
    del.className = "btn small danger solid";
    del.textContent = "Sicuro? Elimina";
    setTimeout(() => {
      if (del.isConnected) { delete del.dataset.armed; del.className = "btn small danger"; del.textContent = "Elimina"; }
    }, 4000);
  });
  acts.append(back, del);
  li.append(tick, txt, acts);
  return li;
}

/* ---------- Azioni ---------- */

let toastTimer = null, undoFn = null;
function showToast(msg, withUndo, fn) {
  $("#toast-msg").textContent = msg;
  $("#toast-undo").hidden = !withUndo;
  undoFn = fn || null;
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $("#toast").hidden = true; undoFn = null; }, 6000);
}
$("#toast-undo").addEventListener("click", () => {
  if (undoFn) undoFn();
  undoFn = null;
  $("#toast").hidden = true;
});

const reopen = (id) => patch(id, { stato: "aperto", fatto: null, aggiornato: Date.now() });

function markDone(id, card) {
  if (!notes.has(id)) return;
  const go = () => {
    patch(id, { stato: "fatto", fatto: Date.now(), aggiornato: Date.now() });
    showToast("Spostato nei Fatti", true, () => reopen(id));
  };
  if (card && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    card.classList.add("going");
    setTimeout(go, 380);
  } else go();
}

// Sul computer si può anche trascinare una voce da una parte all'altra
document.querySelectorAll(".quad").forEach((box) => {
  box.addEventListener("dragover", (e) => { e.preventDefault(); box.classList.add("drop"); });
  box.addEventListener("dragleave", (e) => { if (!box.contains(e.relatedTarget)) box.classList.remove("drop"); });
  box.addEventListener("drop", (e) => {
    e.preventDefault();
    box.classList.remove("drop");
    const id = e.dataTransfer.getData("text/plain");
    const n = notes.get(id);
    if (n && qOf(n) !== box.dataset.q) patch(id, { q: box.dataset.q, aggiornato: Date.now() });
  });
});

$("#nuovo").addEventListener("click", () => openEditor(null, "q1"));
$("#fatti-toggle").addEventListener("click", (e) => {
  const list = $("#fatti-list");
  list.hidden = !list.hidden;
  e.currentTarget.textContent = list.hidden ? "Mostra i fatti" : "Nascondi i fatti";
  e.currentTarget.setAttribute("aria-expanded", String(!list.hidden));
});

/* ---------- Finestra della voce ---------- */

const dlg = $("#dlg");
let editing = null;

const quadBox = $("#f-quad");
for (const [q, info] of Object.entries(QUAD)) {
  const lab = el("label");
  const r = el("input");
  r.type = "radio"; r.name = "quad"; r.value = q; r.id = "f-quad-" + q;
  lab.append(r, el("span", null, info.nome));
  quadBox.append(lab);
}

function showExtra(on) { $("#extra").hidden = !on; $("#piu").hidden = on; }
$("#piu").addEventListener("click", () => { showExtra(true); $("#f-dettagli").focus(); });

function resetDelete() {
  const z = $("#del-zone");
  z.replaceChildren();
  if (!editing) return;
  const b = el("button", "btn danger", "Elimina");
  b.type = "button";
  b.addEventListener("click", () => {
    z.replaceChildren();
    const wrap = el("span", "confirm-del", "Eliminarlo per sempre?");
    const yes = el("button", "btn danger solid", "Sì, elimina");
    yes.type = "button";
    yes.addEventListener("click", () => { const id = editing; dlg.close(); if (id) remove(id); });
    const no = el("button", "btn", "No");
    no.type = "button";
    no.addEventListener("click", resetDelete);
    wrap.append(yes, no);
    z.append(wrap);
  });
  z.append(b);
}

function openEditor(id, q) {
  if (!col) return;
  editing = id;
  const n = id ? notes.get(id) || {} : {};
  const quad = id ? qOf(n) : (q || "q1");
  $("#dlg-title").textContent = id ? "Cosa da fare" : "Nuova cosa da fare";
  $("#f-titolo").value = n.titolo || "";
  $("#f-titolo").placeholder = "Es. Rinnovo polizza auto";
  $("#f-persona").value = n.persona || "";
  const qd = n.quando || "";
  $("#f-giorno").value = qd.slice(0, 10);
  $("#f-ora").value = qd.length > 10 ? qd.slice(11, 16) : "";
  $("#f-dettagli").value = n.dettagli || "";
  $("#f-tel").value = n.tel || "";
  $("#f-email").value = n.email || "";
  $("#f-rif").value = n.rif || "";
  $("#f-quad-" + quad).checked = true;
  showExtra(!!(n.dettagli || n.tel || n.email || n.rif));

  const stamp = $("#f-stamp");
  if (id && n.creato) {
    stamp.textContent = "Scritto il " + fmtFull.format(new Date(n.creato)) +
      (n.stato === "fatto" && n.fatto ? " · fatto il " + fmtFull.format(new Date(n.fatto)) : "");
    stamp.hidden = false;
  } else stamp.hidden = true;

  const fb = $("#fatto-btn");
  fb.hidden = !id;
  fb.textContent = n.stato === "fatto" ? "Rimetti tra le cose da fare" : "✓ Fatto";
  resetDelete();

  dlg.showModal();
  if (!id) setTimeout(() => $("#f-titolo").focus(), 30);
}

function collect() {
  const giorno = $("#f-giorno").value;
  const ora = $("#f-ora").value;
  let quando = "";
  if (giorno) quando = ora ? giorno + "T" + ora : giorno;
  else if (ora) {
    // Solo l'ora: vale per oggi
    const d = new Date();
    const pad = (x) => String(x).padStart(2, "0");
    quando = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + ora;
  }
  return {
    titolo: $("#f-titolo").value.trim(),
    persona: $("#f-persona").value.trim(),
    quando,
    q: (quadBox.querySelector("input:checked") || {}).value || "q1",
    dettagli: $("#f-dettagli").value.trim(),
    tel: $("#f-tel").value.trim(),
    email: $("#f-email").value.trim(),
    rif: $("#f-rif").value.trim(),
  };
}

$("#form").addEventListener("submit", (e) => {
  e.preventDefault();
  const data = collect();
  if (!data.titolo) {
    const t = $("#f-titolo");
    t.placeholder = "Scrivi almeno il titolo";
    t.focus();
    return;
  }
  const now = Date.now();
  if (editing) put(editing, { ...(notes.get(editing) || {}), ...data, aggiornato: now });
  else put(newId(), { ...data, stato: "aperto", creato: now, aggiornato: now, fatto: null });
  dlg.close();
});

$("#fatto-btn").addEventListener("click", () => {
  const id = editing;
  if (!id) return;
  const n = notes.get(id) || {};
  const data = collect();
  if (!data.titolo) data.titolo = n.titolo || "";
  const now = Date.now();
  if (n.stato === "fatto") {
    put(id, { ...n, ...data, stato: "aperto", fatto: null, aggiornato: now });
  } else {
    put(id, { ...n, ...data, stato: "fatto", fatto: now, aggiornato: now });
    showToast("Spostato nei Fatti", true, () => reopen(id));
  }
  dlg.close();
});

$("#chiudi").addEventListener("click", () => dlg.close());
dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });

// "Oggi" e "Scaduto" seguono l'orologio
setInterval(() => { if (col && !dlg.open) render(); }, 60000);

/* ---------- Copia di sicurezza in Excel ---------- */

// La libreria per scrivere i file Excel si carica dopo l'accesso, in sottofondo:
// così al tocco del pulsante è già pronta (iPhone vuole il salvataggio subito dopo il tocco).
// Se non arriva, la copia esce in CSV, che Excel apre lo stesso.
const XLSX_URL = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/xlsx.mjs";
let xlsx = null;
let xlsxLoading = null;
function loadXlsx() {
  if (!xlsxLoading) {
    xlsxLoading = import(XLSX_URL)
      .then((m) => (xlsx = m))
      .catch(() => { xlsxLoading = null; return null; });
  }
  return xlsxLoading;
}

const COLONNE = [
  "Parte", "Titolo", "Persona o nota", "Giorno", "Ora", "Note", "Telefono", "Email",
  "N. pratica o polizza", "Scritto il", "Fatto il", "Codice",
];
const fmtDate = new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" });
const fmtStamp = new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

function riga(id, n) {
  const d = parseLocal(n.quando);
  return [
    QUAD[qOf(n)].nome,
    n.titolo || "",
    n.persona || "",
    d ? fmtDate.format(d) : "",
    d && hasTime(n.quando) ? fmtTime.format(d) : "",
    n.dettagli || "",
    n.tel || "",
    n.email || "",
    n.rif || "",
    n.creato ? fmtStamp.format(new Date(n.creato)) : "",
    n.fatto ? fmtStamp.format(new Date(n.fatto)) : "",
    id,
  ];
}

function righe() {
  const all = [...notes];
  const ordineParte = { q1: 0, q2: 1, q4: 2 };
  const daFare = all.filter(([, n]) => n.stato !== "fatto")
    .sort((a, b) => (ordineParte[qOf(a[1])] - ordineParte[qOf(b[1])]) || sortOpen(a, b))
    .map(([id, n]) => riga(id, n));
  const fatti = all.filter(([, n]) => n.stato === "fatto")
    .sort((a, b) => (b[1].fatto || 0) - (a[1].fatto || 0))
    .map(([id, n]) => riga(id, n));
  return { daFare, fatti };
}

function fileXlsx(nome, { daFare, fatti }) {
  const wb = xlsx.utils.book_new();
  const larghezze = [24, 32, 28, 12, 7, 50, 16, 28, 20, 18, 18, 24].map((wch) => ({ wch }));
  for (const [titolo, dati] of [["Da fare", daFare], ["Fatti", fatti]]) {
    const ws = xlsx.utils.aoa_to_sheet([COLONNE, ...dati]);
    ws["!cols"] = larghezze;
    xlsx.utils.book_append_sheet(wb, ws, titolo);
  }
  const buf = xlsx.write(wb, { bookType: "xlsx", type: "array" });
  return new File([buf], nome + ".xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

// Ripiego senza libreria: punto e virgola e BOM, come lo vuole Excel in italiano
function fileCsv(nome, { daFare, fatti }) {
  const cella = (v) => /[";\n\r]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
  const testo = [["Stato", ...COLONNE], ...daFare.map((r) => ["Da fare", ...r]), ...fatti.map((r) => ["Fatto", ...r])]
    .map((r) => r.map(cella).join(";")).join("\r\n");
  return new File(["﻿" + testo], nome + ".csv", { type: "text/csv;charset=utf-8" });
}

function salvaFile(file) {
  // Sull'iPhone installato come app il download non funziona: si passa dal pannello Condividi
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (ios && navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator.share({ files: [file], title: file.name }).catch(() => { /* chiuso dall'utente */ });
    return;
  }
  const url = URL.createObjectURL(file);
  const a = el("a");
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

$("#scarica").addEventListener("click", async () => {
  if (!loaded) { showToast("Aspetta che l'elenco sia caricato, poi riprova", false); return; }
  const oggi = new Date();
  const pad = (x) => String(x).padStart(2, "0");
  const nome = "cose-da-fare-" + oggi.getFullYear() + "-" + pad(oggi.getMonth() + 1) + "-" + pad(oggi.getDate());
  const dati = righe();
  if (!xlsx) await loadXlsx();
  const file = xlsx ? fileXlsx(nome, dati) : fileCsv(nome, dati);
  salvaFile(file);
  const tot = dati.daFare.length + dati.fatti.length;
  showToast("Copia pronta: " + tot + (tot === 1 ? " voce" : " voci") + " in " + file.name, false);
});

/* ---------- Funziona anche senza internet ---------- */

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => { /* senza, la pagina funziona lo stesso online */ });
}
