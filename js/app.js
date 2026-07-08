"use strict";

/* ————— Constantes ————— */
const ENTRIES_KEY = "kcal.entries.v1";
const GOAL_KEY = "kcal.goal.v1";
const DEFAULT_GOAL = 2200;

const MEALS = {
  "petit-dejeuner": "Petit-déjeuner",
  "dejeuner": "Déjeuner",
  "diner": "Dîner",
  "collation": "Collation",
  "autre": "Autre",
};
const MEAL_ORDER = ["petit-dejeuner", "dejeuner", "collation", "diner", "autre"];

const CLAUDE_PROMPT = `Tu es un assistant nutritionnel. Je t'envoie une photo d'un repas ou d'un aliment.

Analyse la photo, identifie chaque aliment distinct, estime sa masse en grammes à partir des proportions visibles, puis calcule ses valeurs nutritionnelles à partir de bases de référence standard (Ciqual / USDA).

Réponds UNIQUEMENT avec un JSON valide, sans aucun texte avant ou après, sans bloc de code markdown, au format exact suivant :

{
  "meal": "petit-dejeuner | dejeuner | diner | collation",
  "items": [
    {
      "name": "Nom de l'aliment en français",
      "mass_g": 0,
      "kcal": 0,
      "protein_g": 0,
      "carbs_g": 0,
      "fat_g": 0
    }
  ]
}

Règles :
- Un objet par aliment distinct visible sur la photo.
- Tous les champs numériques sont des nombres (jamais des chaînes).
- "kcal" et "mass_g" arrondis à l'entier ; macros avec au plus 1 décimale.
- "kcal" correspond à la portion visible (pas aux 100 g).
- Choisis "meal" d'après le contexte (heure, type d'aliments) ; en cas de doute utilise "collation".
- Si je précise des quantités ou des aliments dans mon message, priorise mes indications sur ton estimation visuelle.
- Si l'image ne contient pas de nourriture, réponds : {"error": "Aucun aliment détecté"}`;

/* ————— État ————— */
const state = {
  view: "day",
  anchor: new Date(),
};

/* ————— Stockage ————— */
function loadEntries() {
  try {
    const raw = JSON.parse(localStorage.getItem(ENTRIES_KEY));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}
function saveEntries(entries) {
  localStorage.setItem(ENTRIES_KEY, JSON.stringify(entries));
}
function loadGoal() {
  const g = Number(localStorage.getItem(GOAL_KEY));
  return g > 0 ? g : DEFAULT_GOAL;
}
function saveGoal(g) {
  localStorage.setItem(GOAL_KEY, String(g));
}

/* ————— Dates (locales, pas d'UTC) ————— */
function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fromISO(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function startOfWeek(d) {
  const r = new Date(d);
  r.setDate(r.getDate() - ((r.getDay() + 6) % 7)); // lundi
  return r;
}
function isValidISO(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(fromISO(s).getTime());
}

const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
const fmtDay = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });
const fmtDayYear = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const fmtMonth = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });
const fmtShort = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });

/* ————— Agrégats ————— */
function itemTotals(items) {
  const t = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
  for (const it of items) {
    t.kcal += it.kcal || 0;
    t.protein_g += it.protein_g || 0;
    t.carbs_g += it.carbs_g || 0;
    t.fat_g += it.fat_g || 0;
  }
  return t;
}
function kcalByDate(entries) {
  const map = new Map();
  for (const e of entries) {
    map.set(e.date, (map.get(e.date) || 0) + itemTotals(e.items).kcal);
  }
  return map;
}

/* ————— Validation du JSON collé ————— */
function normalizeInput(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("JSON invalide : vérifie que tu as bien copié toute la réponse de Claude.");
  }
  if (data && data.error) throw new Error(`Claude n'a rien détecté : ${data.error}`);

  let rawEntries;
  if (Array.isArray(data)) rawEntries = data;
  else if (data && Array.isArray(data.entries)) rawEntries = data.entries;
  else if (data && Array.isArray(data.items)) rawEntries = [data];
  else throw new Error('Format inattendu : il faut un objet avec un tableau "items".');

  if (rawEntries.length === 0) throw new Error("Aucun repas dans ce JSON.");

  return rawEntries.map((e, i) => {
    if (!Array.isArray(e.items) || e.items.length === 0) {
      throw new Error(`Repas ${i + 1} : "items" manquant ou vide.`);
    }
    const items = e.items.map((it, j) => {
      if (typeof it.name !== "string" || !it.name.trim()) {
        throw new Error(`Aliment ${j + 1} : "name" manquant.`);
      }
      if (typeof it.kcal !== "number" || !isFinite(it.kcal) || it.kcal < 0) {
        throw new Error(`"${it.name}" : "kcal" doit être un nombre positif.`);
      }
      const num = (v) => (typeof v === "number" && isFinite(v) && v >= 0 ? v : undefined);
      return {
        name: it.name.trim(),
        kcal: Math.round(it.kcal),
        mass_g: num(it.mass_g),
        protein_g: num(it.protein_g),
        carbs_g: num(it.carbs_g),
        fat_g: num(it.fat_g),
      };
    });
    return {
      date: isValidISO(e.date) ? e.date : null,
      meal: MEALS[e.meal] ? e.meal : null,
      items,
    };
  });
}

/* ————— Rendu ————— */
const $ = (sel) => document.querySelector(sel);
const viewEl = $("#view");

function esc(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function render() {
  document.querySelectorAll(".tab").forEach((t) => {
    t.setAttribute("aria-selected", String(t.dataset.view === state.view));
  });
  renderPeriodLabel();
  const entries = loadEntries();
  if (state.view === "day") renderDay(entries);
  else if (state.view === "week") renderWeek(entries);
  else if (state.view === "month") renderMonth(entries);
  else renderYear(entries);
}

function renderPeriodLabel() {
  const a = state.anchor;
  const now = new Date();
  let label;
  if (state.view === "day") {
    const iso = toISO(a);
    if (iso === toISO(now)) label = "Aujourd'hui";
    else if (iso === toISO(addDays(now, -1))) label = "Hier";
    else label = (a.getFullYear() === now.getFullYear() ? fmtDay : fmtDayYear).format(a);
  } else if (state.view === "week") {
    const s = startOfWeek(a);
    label = `${fmtShort.format(s)} – ${fmtShort.format(addDays(s, 6))} ${s.getFullYear()}`;
  } else if (state.view === "month") {
    label = fmtMonth.format(a);
  } else {
    label = String(a.getFullYear());
  }
  $("#btn-today").textContent = label;
}

function summaryCard(kcal, goal, macros) {
  const pct = Math.min(100, (kcal / goal) * 100);
  const over = kcal > goal;
  const rest = goal - kcal;
  return `
    <section class="card">
      <div class="total-kcal">
        <span class="big">${nf.format(kcal)}</span>
        <span class="unit">/ ${nf.format(goal)} kcal</span>
      </div>
      <div class="progress"><div class="${over ? "over" : ""}" style="width:${pct}%"></div></div>
      <p class="goal-line">${over ? `Objectif dépassé de ${nf.format(-rest)} kcal` : `Encore ${nf.format(rest)} kcal disponibles`}</p>
      <div class="macros">
        <div class="macro"><b>${nf1.format(macros.protein_g)} g</b><span>Protéines</span></div>
        <div class="macro"><b>${nf1.format(macros.carbs_g)} g</b><span>Glucides</span></div>
        <div class="macro"><b>${nf1.format(macros.fat_g)} g</b><span>Lipides</span></div>
      </div>
    </section>`;
}

function renderDay(entries) {
  const iso = toISO(state.anchor);
  const dayEntries = entries.filter((e) => e.date === iso);
  const allItems = dayEntries.flatMap((e) => e.items);
  const totals = itemTotals(allItems);
  const goal = loadGoal();

  let html = summaryCard(totals.kcal, goal, totals);

  if (dayEntries.length === 0) {
    html += `
      <div class="empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/>
        </svg>
        <p>Rien d'enregistré ce jour.<br>Prends ton repas en photo et ajoute-le.</p>
      </div>`;
  } else {
    for (const mealKey of MEAL_ORDER) {
      const group = dayEntries.filter((e) => e.meal === mealKey);
      if (group.length === 0) continue;
      const groupItems = group.flatMap((e) => e.items.map((it, idx) => ({ entryId: e.id, idx, ...it })));
      const groupKcal = itemTotals(groupItems).kcal;
      html += `
        <section class="card meal-group">
          <div class="meal-head">
            <h3>${MEALS[mealKey]}</h3>
            <span class="kcal">${nf.format(groupKcal)} kcal</span>
          </div>
          ${groupItems.map((it) => `
            <div class="food-item">
              <span class="name">${esc(it.name)}</span>
              <span class="meta">${it.mass_g != null ? nf.format(it.mass_g) + " g" : ""}</span>
              <span class="kcal">${nf.format(it.kcal)}</span>
              <button class="btn-del" data-entry="${it.entryId}" data-idx="${it.idx}" aria-label="Supprimer ${esc(it.name)}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
              </button>
            </div>`).join("")}
        </section>`;
    }
  }
  viewEl.innerHTML = html;
}

function chartCard(bars, goal, maxOverride) {
  const max = Math.max(maxOverride || 0, goal, ...bars.map((b) => b.kcal), 1);
  const goalPct = (goal / max) * 100;
  return `
    <section class="card">
      <div class="chart">
        <div class="goal-marker" style="bottom:${goalPct}%"></div>
        ${bars.map((b) => `
          <button class="bar-col ${b.today ? "today" : ""} ${b.kcal > goal ? "over" : ""}"
                  data-date="${b.date || ""}" title="${b.title} : ${nf.format(b.kcal)} kcal"
                  aria-label="${b.title} : ${nf.format(b.kcal)} kcal">
            <div class="bar" style="height:${(b.kcal / max) * 100}%"></div>
            <span class="lbl">${b.label}</span>
          </button>`).join("")}
      </div>
    </section>`;
}

function statsRow(days) {
  const filled = days.filter((d) => d.kcal > 0);
  const total = filled.reduce((s, d) => s + d.kcal, 0);
  const avg = filled.length ? total / filled.length : 0;
  return `
    <div class="stats-row">
      <div class="stat"><b>${nf.format(total)}</b><span>kcal total</span></div>
      <div class="stat"><b>${nf.format(avg)}</b><span>moy. / jour</span></div>
      <div class="stat"><b>${filled.length}</b><span>jours suivis</span></div>
    </div>`;
}

function renderWeek(entries) {
  const byDate = kcalByDate(entries);
  const start = startOfWeek(state.anchor);
  const todayISO = toISO(new Date());
  const labels = ["L", "M", "M", "J", "V", "S", "D"];
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i);
    const iso = toISO(d);
    days.push({
      date: iso,
      kcal: byDate.get(iso) || 0,
      label: labels[i],
      title: fmtDay.format(d),
      today: iso === todayISO,
    });
  }
  viewEl.innerHTML = statsRow(days) + chartCard(days, loadGoal());
}

function renderMonth(entries) {
  const byDate = kcalByDate(entries);
  const a = state.anchor;
  const nbDays = new Date(a.getFullYear(), a.getMonth() + 1, 0).getDate();
  const todayISO = toISO(new Date());
  const days = [];
  for (let i = 1; i <= nbDays; i++) {
    const d = new Date(a.getFullYear(), a.getMonth(), i);
    const iso = toISO(d);
    days.push({
      date: iso,
      kcal: byDate.get(iso) || 0,
      label: i === 1 || i % 5 === 0 ? String(i) : "",
      title: fmtDay.format(d),
      today: iso === todayISO,
    });
  }
  viewEl.innerHTML = statsRow(days) + chartCard(days, loadGoal());
}

function renderYear(entries) {
  const byDate = kcalByDate(entries);
  const year = state.anchor.getFullYear();
  const goal = loadGoal();
  const labels = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
  const months = [];
  const allDays = [];
  for (let m = 0; m < 12; m++) {
    const nbDays = new Date(year, m + 1, 0).getDate();
    let total = 0, filled = 0;
    for (let i = 1; i <= nbDays; i++) {
      const kcal = byDate.get(toISO(new Date(year, m, i))) || 0;
      if (kcal > 0) { total += kcal; filled++; allDays.push({ kcal }); }
    }
    months.push({
      date: toISO(new Date(year, m, 1)),
      kcal: filled ? Math.round(total / filled) : 0,
      label: labels[m],
      title: fmtMonth.format(new Date(year, m, 1)) + " (moy./jour)",
      today: new Date().getFullYear() === year && new Date().getMonth() === m,
    });
  }
  viewEl.innerHTML =
    statsRow(allDays) +
    `<p class="helper" style="margin:0 4px 8px">Barres : moyenne kcal / jour suivi, par mois.</p>` +
    chartCard(months, goal);
}

/* ————— Toast ————— */
let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3000);
}

/* ————— Événements ————— */
document.querySelectorAll(".tab").forEach((t) => {
  t.addEventListener("click", () => {
    state.view = t.dataset.view;
    render();
  });
});

$("#btn-prev").addEventListener("click", () => shiftPeriod(-1));
$("#btn-next").addEventListener("click", () => shiftPeriod(1));
$("#btn-today").addEventListener("click", () => {
  state.anchor = new Date();
  render();
});

function shiftPeriod(dir) {
  const a = state.anchor;
  if (state.view === "day") state.anchor = addDays(a, dir);
  else if (state.view === "week") state.anchor = addDays(a, dir * 7);
  else if (state.view === "month") state.anchor = new Date(a.getFullYear(), a.getMonth() + dir, 1);
  else state.anchor = new Date(a.getFullYear() + dir, 0, 1);
  render();
}

// Clic sur une barre → vue jour (ou mois depuis l'année)
viewEl.addEventListener("click", (ev) => {
  const del = ev.target.closest(".btn-del");
  if (del) {
    const entries = loadEntries();
    const entry = entries.find((e) => e.id === del.dataset.entry);
    if (!entry) return;
    entry.items.splice(Number(del.dataset.idx), 1);
    saveEntries(entries.filter((e) => e.items.length > 0));
    toast("Aliment supprimé");
    render();
    return;
  }
  const bar = ev.target.closest(".bar-col");
  if (bar && bar.dataset.date) {
    state.anchor = fromISO(bar.dataset.date);
    state.view = state.view === "year" ? "month" : "day";
    render();
  }
});

/* — Modale d'ajout — */
const dlgAdd = $("#dlg-add");
const jsonInput = $("#json-input");
const jsonStatus = $("#json-status");
const btnSubmit = $("#btn-submit-add");

$("#btn-add").addEventListener("click", () => {
  $("#fallback-date").value = state.view === "day" ? toISO(state.anchor) : toISO(new Date());
  const h = new Date().getHours();
  $("#fallback-meal").value = h < 11 ? "petit-dejeuner" : h < 15 ? "dejeuner" : h < 18 ? "collation" : "diner";
  jsonInput.value = "";
  jsonStatus.textContent = "";
  jsonStatus.className = "helper";
  btnSubmit.disabled = true;
  dlgAdd.showModal();
});

jsonInput.addEventListener("input", () => {
  const text = jsonInput.value.trim();
  if (!text) {
    jsonStatus.textContent = "";
    jsonStatus.className = "helper";
    btnSubmit.disabled = true;
    return;
  }
  try {
    const parsed = normalizeInput(text);
    const nb = parsed.reduce((s, e) => s + e.items.length, 0);
    const kcal = parsed.reduce((s, e) => s + itemTotals(e.items).kcal, 0);
    jsonStatus.textContent = `✓ ${nb} aliment${nb > 1 ? "s" : ""} — ${nf.format(kcal)} kcal`;
    jsonStatus.className = "helper ok";
    btnSubmit.disabled = false;
  } catch (err) {
    jsonStatus.textContent = err.message;
    jsonStatus.className = "helper err";
    btnSubmit.disabled = true;
  }
});

$("#form-add").addEventListener("submit", (ev) => {
  let parsed;
  try {
    parsed = normalizeInput(jsonInput.value.trim());
  } catch {
    ev.preventDefault();
    return;
  }
  const fallbackDate = isValidISO($("#fallback-date").value) ? $("#fallback-date").value : toISO(new Date());
  const fallbackMeal = $("#fallback-meal").value;
  const entries = loadEntries();
  for (const e of parsed) {
    entries.push({
      id: crypto.randomUUID(),
      date: e.date || fallbackDate,
      meal: e.meal || fallbackMeal,
      items: e.items,
      addedAt: new Date().toISOString(),
    });
  }
  saveEntries(entries);
  state.view = "day";
  state.anchor = fromISO(parsed[0].date || fallbackDate);
  toast("Repas ajouté");
  render();
});

$("#btn-copy-prompt").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(CLAUDE_PROMPT);
    toast("Prompt copié — colle-le dans Claude avec ta photo");
  } catch {
    toast("Copie impossible : le prompt est dans PROMPT.md du dépôt");
  }
});

/* — Réglages — */
const dlgSettings = $("#dlg-settings");

$("#btn-settings").addEventListener("click", () => {
  $("#goal-input").value = loadGoal();
  dlgSettings.showModal();
});

$("#goal-input").addEventListener("change", () => {
  const g = Number($("#goal-input").value);
  if (g > 0) {
    saveGoal(g);
    toast(`Objectif : ${nf.format(g)} kcal / jour`);
    render();
  }
});

$("#btn-export").addEventListener("click", () => {
  const payload = {
    app: "kcal",
    exportedAt: new Date().toISOString(),
    goal: loadGoal(),
    entries: loadEntries(),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `kcal-sauvegarde-${toISO(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast("Sauvegarde téléchargée");
});

$("#btn-import").addEventListener("click", () => $("#import-file").click());
$("#import-file").addEventListener("change", async (ev) => {
  const file = ev.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data || !Array.isArray(data.entries)) throw new Error();
    const existing = loadEntries();
    const known = new Set(existing.map((e) => e.id));
    let added = 0;
    for (const e of data.entries) {
      if (e && e.id && !known.has(e.id) && Array.isArray(e.items) && isValidISO(e.date)) {
        existing.push(e);
        added++;
      }
    }
    saveEntries(existing);
    if (data.goal > 0) saveGoal(data.goal);
    toast(`${added} repas importé${added > 1 ? "s" : ""}`);
    render();
  } catch {
    toast("Fichier de sauvegarde invalide");
  }
  ev.target.value = "";
});

$("#btn-clear").addEventListener("click", () => {
  if (confirm("Effacer définitivement toutes les données ? Cette action est irréversible.")) {
    localStorage.removeItem(ENTRIES_KEY);
    toast("Données effacées");
    dlgSettings.close();
    render();
  }
});

// Fermeture des modales
document.querySelectorAll("[data-close]").forEach((b) => {
  b.addEventListener("click", () => b.closest("dialog").close());
});
document.querySelectorAll("dialog").forEach((d) => {
  d.addEventListener("click", (ev) => {
    if (ev.target === d) d.close(); // clic sur le backdrop
  });
});

/* ————— Service worker (hors ligne) ————— */
if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js");
}

render();
