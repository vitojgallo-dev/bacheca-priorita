// Bacheca "Cose da fare": il foglio importante/urgente in tre parti, con post-it.
// I dati stanno su Firebase (Firestore) in utenti/<id>/note: ognuno vede solo i suoi,
// uguali su tutti i dispositivi dove entra con la stessa email.

import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, signOut,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

// Le tre parti del foglio. Un post-it con una parte sconosciuta finisce in basso.
const QUAD = {
  q1: { nome: "Importante urgente", dot: "var(--q1-note)" },
  q2: { nome: "Importante non urgente", dot: "var(--q2-note)" },
  q4: { nome: "Non importante non urgente", dot: "var(--q4-note)" },
};
const qOf = (n) => (n.q === "q1" || n.q === "q2") ? n.q : "q4";

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const show = (id) => {
  for (const v of ["vista-setup", "vista-accesso", "vista-bacheca"]) $("#" + v).hidden = v !== id;
};

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

let notes = new Map();
let col = null;          // la collezione dei post-it di chi è entrato
let stopListen = null;
let loaded = false;

onAuthStateChanged(auth, (user) => {
  if (stopListen) { stopListen(); stopListen = null; }
  notes = new Map();
  loaded = false;
  if (!user) {
    col = null;
    show("vista-accesso");
    return;
  }
  $("#chi").textContent = "Sei entrato come " + (user.email || "");
  col = collection(db, "utenti", user.uid, "note");
  show("vista-bacheca");
  render();
  setSync("wait", "Collegamento…");
  stopListen = onSnapshot(col, { includeMetadataChanges: true }, (snap) => {
    const o = new Map();
    snap.forEach((d) => o.set(d.id, d.data()));
    notes = o;
    loaded = true;
    if (snap.metadata.hasPendingWrites) setSync("wait", "Sto salvando…");
    else if (snap.metadata.fromCache) setSync("off", navigator.onLine ? "Collegamento…" : "Senza internet: salvo appena torna");
    else setSync("on", "Salvato e sincronizzato");
    render();
  }, () => setSync("err", "Collegamento perso: ricarica la pagina"));
});

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
const put = (id, data) => safe(setDoc(doc(col, id), data));
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
  try {
    if (creating) await createUserWithEmailAndPassword(auth, email, pass);
    else await signInWithEmailAndPassword(auth, email, pass);
    $("#acc-pass").value = "";
  } catch (err) {
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

$("#esci").addEventListener("click", () => signOut(auth));

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

    const list = el("div", "notes");
    if (!items.length) list.append(el("p", "empty", loaded ? "Nessun post-it." : "Caricamento…"));
    for (const [id, n] of items) list.append(noteCard(id, n));
    box.append(head, list);
  }

  done.sort((a, b) => (b[1].fatto || 0) - (a[1].fatto || 0));
  $("#fatti-n").textContent = done.length ? "(" + done.length + ")" : "";
  const ul = $("#fatti-list");
  ul.replaceChildren();
  if (!done.length) ul.append(el("li", "done-empty", "Quando premi «✓ Fatto» su un post-it, lo trovi qui."));
  for (const [id, n] of done) ul.append(doneRow(id, n));
}

function noteCard(id, n) {
  const card = el("article", "note");
  card.draggable = true;
  card.dataset.id = id;

  const open = el("button", "open");
  open.type = "button";
  open.setAttribute("aria-label", "Apri " + (n.titolo || "post-it"));
  open.append(el("div", "t", n.titolo || "Senza titolo"));
  if (n.persona) open.append(el("div", "who", n.persona));
  const w = whenText(n.quando);
  if (w) open.append(el("div", "when " + w.cls, w.label));
  if (n.dettagli || n.tel || n.email || n.rif) open.append(el("div", "info", "Altre informazioni dentro"));
  open.addEventListener("click", () => openEditor(id));

  const doneBtn = el("button", "done-btn", "✓ Fatto");
  doneBtn.type = "button";
  doneBtn.setAttribute("aria-label", "Segna come fatto: " + (n.titolo || "post-it"));
  doneBtn.addEventListener("click", () => markDone(id, card));

  card.append(open, doneBtn);
  card.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
    card.classList.add("dragging");
  });
  card.addEventListener("dragend", () => card.classList.remove("dragging"));
  return card;
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
    setTimeout(go, 220);
  } else go();
}

// Sul computer si può anche trascinare un post-it da una parte all'altra
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

/* ---------- Finestra del post-it ---------- */

const dlg = $("#dlg");
let editing = null;

const quadBox = $("#f-quad");
for (const [q, info] of Object.entries(QUAD)) {
  const lab = el("label");
  const r = el("input");
  r.type = "radio"; r.name = "quad"; r.value = q; r.id = "f-quad-" + q;
  const dot = el("i"); dot.style.background = info.dot;
  lab.append(r, dot, el("span", null, info.nome));
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
  $("#dlg-title").textContent = id ? "Post-it" : "Nuovo post-it";
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

/* ---------- Funziona anche senza internet ---------- */

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => { /* senza, la pagina funziona lo stesso online */ });
}
