/**
 * Shiklul: UI controller.
 * State lives in one object. Every change goes through commit() → save → render.
 */
import {
  KINDS, PALETTE, formatCurrency, parseAmount, monthKey, shiftMonth, monthRange, monthLabel,
  monthTotals, hasData, series, categoryAverage, pctChange, topChanges, savingsRate, budgetStatus,
  toCSV, slugify, escapeHTML, setItems, dailyAllowance,
} from "./utils.js";
import { load, save, normalize, emptyState, demoState, isFirstVisit } from "./store.js";
import { donut, bars } from "./charts.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

let state = load();
const ui = { month: monthKey(new Date()), view: "month", range: 6, showEmpty: false };
const thisMonth = () => monthKey(new Date());
const cat = id => state.categories.find(c => c.id === id);
const monthData = (key = ui.month) => state.months[key] ?? {};
const itemsOf = (id, key = ui.month) => state.items?.[key]?.[id] ?? [];

let saveTimer;
function persist(message) {
  clearTimeout(saveTimer);
  if (!save(state)) toast("⚠️ לא ניתן לשמור בדפדפן הזה");
  else if (message) toast(message);
}
function commit(next, message) {
  state = next;
  persist(message);
  renderAll();
}

/* =========================================================
   Render: structure (only when month / categories change) + live parts
   ========================================================= */

function renderAll() {
  $("#monthLabel").textContent = monthLabel(ui.month);
  $("#nextMonth").disabled = ui.month >= thisMonth();
  $("#demoBanner").hidden = !state.demo;
  $("#welcome").hidden = state.demo || Object.keys(state.months).length > 0;
  renderSheet();
  renderLive();
}

/** Everything that depends on the numbers. Safe to call while the user is typing. */
function renderLive() {
  renderSummary();
  if (ui.view === "month") { renderSheetNumbers(); renderDonut(); renderSplit(); renderMovers(); }
  if (ui.view === "compare") { renderBars(); renderFacts(); renderTable(); }
  if (ui.view === "plan") { renderPlan(); renderGoals(); }
}

function renderSummary() {
  const t = monthTotals(monthData(), state.categories);
  const p = monthTotals(monthData(shiftMonth(ui.month, -1)), state.categories);
  const rate = savingsRate(t.income, t.expense);
  const delta = (now, before, goodUp) => {
    const pct = pctChange(now, before);
    if (pct === null) return `<span class="delta">&nbsp;</span>`;
    if (pct === 0) return `<span class="delta">כמו בחודש הקודם</span>`;
    const good = goodUp ? pct > 0 : pct < 0;
    return `<span class="delta ${good ? "good" : "bad"}">${pct > 0 ? "▲" : "▼"} ${Math.abs(pct)}% מהחודש הקודם</span>`;
  };
  const cards = [
    { label: "הכנסות", value: formatCurrency(t.income), cls: "inc", icon: "↓", extra: delta(t.income, p.income, true) },
    { label: "הוצאות", value: formatCurrency(t.expense), cls: "exp", icon: "↑", extra: delta(t.expense, p.expense, false) },
    { label: "נשאר החודש", value: formatCurrency(t.balance), cls: t.balance >= 0 ? "bal" : "neg", icon: "=",
      extra: `<span class="delta">${!t.income && !t.expense ? "&nbsp;" : t.balance >= 0 ? "יתרה חיובית 👏" : "יצאת ביותר ממה שנכנס"}</span>` },
    { label: "שיעור חיסכון", value: `${rate}%`, cls: "rate", icon: "%",
      extra: `<div class="mini-bar"><span style="width:${Math.max(0, Math.min(rate, 100))}%"></span></div>` },
  ];
  $("#summary").innerHTML = cards.map(c => `
    <article class="stat card ${c.cls}">
      <div class="stat-top"><span class="stat-icon">${c.icon}</span><span>${c.label}</span></div>
      <strong class="stat-value">${c.value}</strong>${c.extra}
    </article>`).join("");
}

/* ---------- Month sheet ----------
   Each category is a block: a total, optional separate entries under it
   (e.g. several supermarket trips), and, for expenses, a monthly budget with what's left. */

function renderSheet() {
  const data = monthData();
  $("#sheet").innerHTML = KINDS.map(k => {
    const cats = state.categories.filter(c => c.kind === k.id);
    const isExp = k.id === "variable"; // budgets matter for spending that varies, not for rent
    return `<article class="card sheet-card kind-${k.id}">
      <header class="sheet-head">
        <div><h2>${k.name}</h2><small class="muted">${k.hint}</small></div>
        <div class="head-totals"><strong class="subtotal" data-subtotal="${k.id}"></strong>
          ${isExp ? `<small class="head-budget" data-head-budget="${k.id}"></small>` : ""}</div>
      </header>
      <div class="sheet-cols" aria-hidden="true"><span></span><span>סה״כ החודש</span><span>חודש שעבר</span><span>שינוי</span></div>
      <ul class="sheet-rows">
        ${cats.map(c => {
          const items = itemsOf(c.id);
          const n = items.length;
          return `
          <li class="cat-block ${n ? "has-items" : ""}" data-id="${c.id}">
            <div class="sheet-row ${n ? "locked" : ""}">
              <label for="in-${c.id}" class="row-name"><span class="row-icon" style="--c:${c.color}">${escapeHTML(c.icon)}</span>${escapeHTML(c.name)}</label>
              <div class="amount"><input class="main-amt" id="in-${c.id}" inputmode="decimal" autocomplete="off" placeholder="הקלידו סכום"
                value="${data[c.id] ?? ""}" aria-label="${escapeHTML(c.name)}, סה״כ בשקלים" ${n ? `readonly title="סכום אוטומטי של ${n} ההוצאות שמתחת"` : ""} /><span>₪</span></div>
              <span class="prev" data-prev></span>
              <span class="chg" data-chg></span>
            </div>
            ${n ? `<div class="subs">${items.map((it, i) => `
              <div class="sub" data-item="${escapeHTML(it.id)}">
                <span class="sub-n">${i + 1}</span>
                <input class="sub-note" maxlength="40" value="${escapeHTML(it.note)}" placeholder="על מה? (לא חובה)" aria-label="תיאור הוצאה ${i + 1}" />
                <div class="amount sm"><input class="sub-amt" inputmode="decimal" autocomplete="off" value="${it.amount || ""}" placeholder="סכום" aria-label="סכום הוצאה ${i + 1}" /><span>₪</span></div>
                <button type="button" class="x" data-del-sub aria-label="מחיקת הוצאה ${i + 1}">✕</button>
              </div>`).join("")}</div>` : ""}
            <div class="cat-foot">
              <button type="button" class="add-sub" data-add-sub>＋ ${n ? "עוד הוצאה" : "פירוט לכמה הוצאות"}</button>
              ${isExp ? `<div class="budget-inline">
                <label>תקציב חודשי <span class="amount xs"><input class="budget-in" inputmode="decimal" autocomplete="off" value="${state.budgets[c.id] ?? ""}" placeholder="ללא" aria-label="תקציב חודשי ל${escapeHTML(c.name)}" /><span>₪</span></span></label>
                <span class="b-status" data-bstatus></span>
              </div>` : ""}
            </div>
            ${isExp ? `<div class="b-track" data-btrack hidden><span></span></div>` : ""}
          </li>`;
        }).join("") || `<li class="placeholder">אין עדיין קטגוריות בחלק הזה</li>`}
      </ul>
      <div class="new-cat" data-kind="${k.id}">
        <button type="button" class="add-cat-btn" data-new-cat>＋ הוספת ${k.id === "income" ? "סוג הכנסה" : "קטגוריה"} משלך</button>
        <form class="new-cat-form" hidden autocomplete="off">
          <input name="icon" class="nc-icon" maxlength="4" value="🏷️" aria-label="אייקון" />
          <input name="name" maxlength="30" placeholder="${k.id === "income" ? "למשל: שכר דירה מיחידה" : k.id === "fixed" ? "למשל: ועד בית, גן ילדים" : "למשל: וטרינר, תספורת"}" aria-label="שם הקטגוריה" />
          <button class="btn small primary">הוספה</button>
          <button type="button" class="btn small" data-cancel-cat>ביטול</button>
        </form>
      </div>
    </article>`;
  }).join("");
}

function renderSheetNumbers() {
  const now = monthData(), prev = monthData(shiftMonth(ui.month, -1));
  const t = monthTotals(now, state.categories);
  for (const k of KINDS) {
    const el = $(`[data-subtotal="${k.id}"]`);
    if (el) el.textContent = formatCurrency(t[k.id]);
    const hb = $(`[data-head-budget="${k.id}"]`);
    if (hb) {
      const ids = state.categories.filter(c => c.kind === k.id && state.budgets[c.id]).map(c => c.id);
      const planned = ids.reduce((a, id) => a + state.budgets[id], 0);
      const used = ids.reduce((a, id) => a + (Number(now[id]) || 0), 0);
      hb.textContent = planned ? `מתוך תקציב ${formatCurrency(planned)} · ${used <= planned ? `נשאר ${formatCurrency(planned - used)}` : `חריגה ${formatCurrency(used - planned)}`}` : "";
      hb.className = `head-budget ${used > planned ? "over" : ""}`;
    }
  }
  for (const block of $$(".cat-block")) {
    const c = cat(block.dataset.id);
    const v = Number(now[c.id]) || 0, pv = Number(prev[c.id]) || 0;
    const main = block.querySelector(".main-amt");
    if (main.readOnly) main.value = v || "";
    block.querySelector("[data-prev]").textContent = pv ? formatCurrency(pv) : "—";
    const pct = pctChange(v, pv);
    const chg = block.querySelector("[data-chg]");
    if (!v || pct === null || pct === 0) { chg.textContent = ""; chg.className = "chg"; }
    else {
      const good = c.kind === "income" ? pct > 0 : pct < 0;
      chg.textContent = `${pct > 0 ? "▲" : "▼"}${Math.abs(pct)}%`;
      chg.className = `chg ${good ? "good" : "bad"}`;
    }
    // budget status for this category
    const status = block.querySelector("[data-bstatus]");
    if (!status) continue;
    const limit = state.budgets[c.id] || 0;
    const track = block.querySelector("[data-btrack]");
    if (!limit) { status.textContent = ""; status.className = "b-status"; track.hidden = true; continue; }
    const { pct: bp, state: st } = budgetStatus(v, limit);
    const left = limit - v;
    status.textContent = left >= 0 ? `נשאר ${formatCurrency(left)}` : `חריגה של ${formatCurrency(-left)}`;
    status.className = `b-status ${st}`;
    track.hidden = false;
    track.className = `b-track ${st}`;
    track.firstElementChild.style.width = Math.min(bp, 100) + "%";
  }
}

let saveSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => persist(), 400); };

function updateItem(catId, itemId, patch) {
  const items = itemsOf(catId).map(i => i.id === itemId ? { ...i, ...patch } : i);
  state = setItems(state, ui.month, catId, items);
}

function addSub(catId) {
  let items = [...itemsOf(catId)];
  const existing = Number(monthData()[catId]) || 0;
  // a total typed before becomes the first entry, so nothing is lost
  if (!items.length && existing) items.push({ id: slugify(), amount: existing, note: "", day: 1 });
  const day = ui.month === thisMonth() ? new Date().getDate() : 1;
  const fresh = { id: slugify(), amount: 0, note: "", day };
  items.push(fresh);
  state = setItems(state, ui.month, catId, items);
  persist();
  renderSheet(); renderLive();
  $(`.cat-block[data-id="${CSS.escape(catId)}"] .sub[data-item="${CSS.escape(fresh.id)}"] .sub-amt`)?.focus();
}

/* Live editing: update numbers while typing, keep focus, save shortly after */
$("#sheet").addEventListener("input", e => {
  const block = e.target.closest(".cat-block");
  if (!block) return;
  const id = block.dataset.id;
  const el = e.target;

  if (el.matches(".main-amt") && !el.readOnly) {
    const v = parseAmount(el.value);
    el.classList.toggle("invalid", Number.isNaN(v));
    if (Number.isNaN(v)) return;
    const m = { ...monthData() };
    if (v > 0) m[id] = v; else delete m[id];
    const months = { ...state.months };
    if (Object.keys(m).length) months[ui.month] = m; else delete months[ui.month];
    state = { ...state, months };
  } else if (el.matches(".sub-amt")) {
    const v = parseAmount(el.value);
    el.classList.toggle("invalid", Number.isNaN(v));
    if (Number.isNaN(v)) return;
    updateItem(id, el.closest(".sub").dataset.item, { amount: v });
  } else if (el.matches(".sub-note")) {
    updateItem(id, el.closest(".sub").dataset.item, { note: el.value });
    saveSoon();
    return;
  } else if (el.matches(".budget-in")) {
    const v = parseAmount(el.value);
    el.classList.toggle("invalid", Number.isNaN(v));
    if (Number.isNaN(v)) return;
    const budgets = { ...state.budgets };
    if (v > 0) budgets[id] = v; else delete budgets[id];
    state = { ...state, budgets };
  } else return;

  renderLive();
  saveSoon();
});
// when leaving a field, show the computed sum ("120+85" → "205")
$("#sheet").addEventListener("change", e => {
  if (!e.target.matches(".main-amt, .sub-amt, .budget-in")) return;
  const v = parseAmount(e.target.value);
  if (!Number.isNaN(v)) { e.target.value = v || ""; persist(); }
});
$("#sheet").addEventListener("keydown", e => {
  if (e.key !== "Enter" || !e.target.matches("input") || e.target.closest(".new-cat-form")) return;
  e.preventDefault();
  // Enter on the last entry of a category adds another one
  if (e.target.matches(".sub-amt") && !e.target.closest(".sub").nextElementSibling && parseAmount(e.target.value) > 0) {
    return addSub(e.target.closest(".cat-block").dataset.id);
  }
  const all = $$("#sheet input:not([readonly])");
  all[all.indexOf(e.target) + 1]?.focus();
});
$("#sheet").addEventListener("focusin", e => { if (e.target.matches(".main-amt:not([readonly]), .sub-amt, .budget-in")) e.target.select(); });
$("#sheet").addEventListener("click", e => {
  const block = e.target.closest(".cat-block");
  if (!block) return;
  const id = block.dataset.id;
  if (e.target.closest("[data-add-sub]")) return addSub(id);
  if (e.target.closest("[data-del-sub]")) {
    const itemId = e.target.closest(".sub").dataset.item;
    commit(setItems(state, ui.month, id, itemsOf(id).filter(i => i.id !== itemId)));
    return;
  }
  // clicking a locked total jumps to its first entry
  if (e.target.matches(".main-amt[readonly]")) block.querySelector(".sub-amt")?.focus();
});

$("#copyPrev").addEventListener("click", () => {
  const prev = monthData(shiftMonth(ui.month, -1));
  const now = { ...monthData() };
  let n = 0;
  for (const c of state.categories) {
    if ((c.kind === "fixed" || c.kind === "income") && prev[c.id] && !now[c.id]) { now[c.id] = prev[c.id]; n++; }
  }
  if (!n) return toast(hasData(prev) ? "אין מה להעתיק: הסכומים כבר מולאו" : "אין נתונים בחודש הקודם");
  commit({ ...state, months: { ...state.months, [ui.month]: now } }, `הועתקו ${n} סכומים ✓`);
});

/* ---------- Side panel ---------- */

function renderDonut() {
  const now = monthData();
  const items = state.categories.filter(c => c.kind !== "income" && now[c.id] > 0)
    .map(c => ({ c, v: now[c.id] })).sort((a, b) => b.v - a.v);
  const total = items.reduce((s, x) => s + x.v, 0);
  // show the top 6, group the rest as "other"
  const top = items.slice(0, 6), rest = items.slice(6).reduce((s, x) => s + x.v, 0);
  const segs = top.map(x => ({ label: x.c.name, value: x.v, color: x.c.color }));
  if (rest) segs.push({ label: "כל השאר", value: rest, color: "#d6ccb6" });
  $("#donut").innerHTML = donut(segs, { centerTitle: "סה״כ הוצאות", centerValue: formatCurrency(total) });
  $("#legend").innerHTML = segs.map(s => `<li><span class="dot" style="background:${s.color}"></span>
    <span class="legend-name">${escapeHTML(s.label)}</span><span class="legend-val">${formatCurrency(s.value)}</span>
    <span class="legend-pct">${Math.round((s.value / total) * 100)}%</span></li>`).join("");
}

function renderSplit() {
  const t = monthTotals(monthData(), state.categories);
  const total = t.expense || 1;
  const fp = Math.round((t.fixed / total) * 100);
  $("#split").innerHTML = t.expense ? `
    <div class="split-bar"><span class="fix" style="width:${fp}%"></span><span class="var" style="width:${100 - fp}%"></span></div>
    <div class="split-legend">
      <div><span class="key fix">קבועות</span><b>${formatCurrency(t.fixed)}</b><small>${fp}%</small></div>
      <div><span class="key var">משתנות</span><b>${formatCurrency(t.variable)}</b><small>${100 - fp}%</small></div>
    </div>
    <p class="muted small-note">${fp >= 60 ? "רוב ההוצאות קבועות. הדרך לחסוך היא לבדוק חוזים, ביטוחים ומנויים." : "חלק גדול מההוצאות משתנה, ושם קל יותר לחסוך מחודש לחודש."}</p>`
    : `<p class="placeholder">מלאו הוצאות כדי לראות את החלוקה</p>`;
}

function renderMovers() {
  const list = topChanges(state, ui.month, 3, 4);
  $("#movers").innerHTML = list.length ? list.map(x => `
    <li><span class="row-icon" style="--c:${x.category.color}">${escapeHTML(x.category.icon)}</span>
      <span class="mv-name">${escapeHTML(x.category.name)}<small class="muted">ממוצע: ${formatCurrency(x.avg)}</small></span>
      <span class="chg ${x.diff > 0 ? "bad" : "good"}">${x.diff > 0 ? "+" : "−"}${formatCurrency(Math.abs(x.diff))}</span></li>`).join("")
    : `<li class="placeholder">כדי להשוות צריך נתונים מכמה חודשים</li>`;
}

/* ---------- Compare view ---------- */

function renderBars() {
  const s = series(state, ui.month, ui.range).reverse();
  const opts = ui.range > 6 ? { month: "narrow" } : { month: "short" };
  $("#bars").innerHTML = bars(s.map(x => ({ label: monthLabel(x.key, opts), income: x.income, fixed: x.fixed, variable: x.variable, active: x.key === ui.month })));
  $$("#rangeSeg button").forEach(b => b.setAttribute("aria-checked", +b.dataset.range === ui.range));
}

function renderFacts() {
  const s = series(state, ui.month, ui.range).filter(x => x.income || x.expense);
  if (!s.length) { $("#facts").innerHTML = `<li class="placeholder">עוד אין נתונים בטווח הזה</li>`; return; }
  const sum = f => s.reduce((a, x) => a + x[f], 0);
  const best = [...s].sort((a, b) => b.balance - a.balance)[0];
  const worst = [...s].sort((a, b) => b.expense - a.expense)[0];
  const facts = [
    ["ממוצע הכנסות בחודש", formatCurrency(sum("income") / s.length)],
    ["ממוצע הוצאות בחודש", formatCurrency(sum("expense") / s.length)],
    [sum("balance") >= 0 ? `נחסך ב-${s.length} חודשים` : `גירעון ב-${s.length} חודשים`, formatCurrency(Math.abs(sum("balance")))],
    ["החודש הכי חסכוני", `${monthLabel(best.key, { month: "long" })} · ${formatCurrency(best.balance)}`],
    ["החודש הכי יקר", `${monthLabel(worst.key, { month: "long" })} · ${formatCurrency(worst.expense)}`],
  ];
  $("#facts").innerHTML = facts.map(([k, v]) => `<li><span class="muted">${k}</span><b>${v}</b></li>`).join("");
}

function renderTable() {
  const keys = monthRange(ui.month, ui.range).reverse(); // newest first
  const avgKeys = keys;
  const head = `<thead><tr><th class="sticky">קטגוריה</th>${keys.map(k => `<th class="${k === ui.month ? "cur" : ""}">${monthLabel(k, { month: "short", year: "2-digit" })}</th>`).join("")}<th class="avg">ממוצע</th></tr></thead>`;

  const row = c => {
    const vals = keys.map(k => Number(state.months[k]?.[c.id]) || 0);
    if (!ui.showEmpty && !vals.some(Boolean)) return "";
    const max = Math.max(...vals), min = Math.min(...vals.filter(Boolean));
    const avg = categoryAverage(state, c.id, avgKeys);
    const cells = vals.map((v, i) => {
      if (!v) return `<td class="${keys[i] === ui.month ? "cur" : ""}">—</td>`;
      // shade relative to the row's own range, so steady bills (rent) stay calm and spikes stand out
      const a = c.kind === "income" || max === min ? 0 : Math.round(((v - min) / (max - min)) * 26);
      const off = avg ? (v - avg) / avg : 0;
      const flag = c.kind !== "income" && Math.abs(off) > 0.15 ? `<i class="${off > 0 ? "up" : "down"}">${off > 0 ? "▲" : "▼"}</i>` : "";
      return `<td class="${keys[i] === ui.month ? "cur" : ""}" style="--a:${a}%">${flag}${formatCurrency(v)}</td>`;
    }).join("");
    return `<tr><th class="sticky" scope="row"><span class="row-icon sm" style="--c:${c.color}">${escapeHTML(c.icon)}</span>${escapeHTML(c.name)}</th>${cells}<td class="avg">${avg ? formatCurrency(avg) : "—"}</td></tr>`;
  };
  const totalRow = (label, field, cls) => {
    const vals = keys.map(k => monthTotals(state.months[k], state.categories)[field]);
    const used = keys.filter(k => hasData(state.months[k]));
    const avg = used.length ? used.reduce((s, k) => s + monthTotals(state.months[k], state.categories)[field], 0) / used.length : 0;
    return `<tr class="total ${cls}"><th class="sticky" scope="row">${label}</th>${vals.map((v, i) => `<td class="${keys[i] === ui.month ? "cur" : ""} ${field === "balance" && v < 0 ? "neg" : ""}">${v ? formatCurrency(v) : "—"}</td>`).join("")}<td class="avg">${avg ? formatCurrency(avg) : "—"}</td></tr>`;
  };

  const body = KINDS.map(k => {
    const rows = state.categories.filter(c => c.kind === k.id).map(row).join("");
    return `<tr class="group"><th class="sticky" colspan="${keys.length + 2}">${k.name}</th></tr>${rows}${totalRow(`סה״כ ${k.name}`, k.id, "sub")}`;
  }).join("");
  const footer = totalRow("סה״כ הוצאות", "expense", "grand") + totalRow("נשאר בסוף החודש", "balance", "grand");
  $("#cmpTable").innerHTML = head + `<tbody>${body}${footer}</tbody>`;
}

$("#rangeSeg").addEventListener("click", e => {
  const b = e.target.closest("button");
  if (!b) return;
  ui.range = +b.dataset.range;
  renderLive();
});
$("#showEmpty").addEventListener("change", e => { ui.showEmpty = e.target.checked; renderTable(); });

/* ---------- Plan view ---------- */

function renderPlan() {
  const now = monthData();
  const isCurrent = ui.month === thisMonth();
  const ids = state.categories.filter(c => c.kind !== "income" && (state.budgets[c.id] || itemsOf(c.id).length)).map(c => c.id);
  const budgeted = ids.filter(id => state.budgets[id]);
  const planned = budgeted.reduce((s, id) => s + state.budgets[id], 0);
  const spent = budgeted.reduce((s, id) => s + (Number(now[id]) || 0), 0);
  const left = planned - spent;
  $("#planStats").innerHTML = planned ? `
    <div><small>תוקצב</small><b>${formatCurrency(planned)}</b></div>
    <div><small>הוצא</small><b>${formatCurrency(spent)}</b></div>
    <div class="${left < 0 ? "neg" : "pos"}"><small>${left < 0 ? "חריגה" : "נשאר"}</small><b>${formatCurrency(Math.abs(left))}</b></div>` : "";

  if (!ids.length) {
    $("#envelopes").innerHTML = `<div class="card placeholder env-empty">
      <p>עוד לא הוגדר תקציב לחודש הזה.</p>
      <p class="muted">למשל: 500 ₪ לבילויים, 1,800 ₪ לסופר. אחר כך מוסיפים כל הוצאה ורואים כמה נשאר.</p>
      <button class="btn primary" data-open-budgets>✏️ הגדרת תקציב</button></div>`;
    return;
  }

  $("#envelopes").innerHTML = ids.map(id => {
    const c = cat(id);
    const limit = state.budgets[id] || 0;
    const items = [...itemsOf(id)].sort((a, b) => b.day - a.day);
    const used = Number(now[id]) || 0;
    const remaining = limit - used;
    const { pct, state: st } = budgetStatus(used, limit);
    const perDay = isCurrent ? dailyAllowance(remaining, ui.month) : null;
    const [, mm] = ui.month.split("-");
    const manual = used && !items.length;
    return `<article class="card env ${st}" data-id="${escapeHTML(id)}" style="--c:${c.color}">
      <header class="env-head">
        <span class="row-icon">${escapeHTML(c.icon)}</span>
        <div class="env-title"><h3>${escapeHTML(c.name)}</h3>
          <small class="muted">${limit ? `תקציב: ${formatCurrency(limit)}` : "ללא תקציב"}</small></div>
        <button class="chip ghost" data-open-budgets>${limit ? "שינוי" : "＋ תקציב"}</button>
      </header>
      ${limit ? `
      <div class="env-left"><small>${remaining < 0 ? "חריגה של" : "נשאר"}</small><strong>${formatCurrency(Math.abs(remaining))}</strong></div>
      <div class="track"><span style="width:${Math.min(pct, 100)}%"></span></div>
      <p class="env-note">הוצאת ${formatCurrency(used)} מתוך ${formatCurrency(limit)} (${pct}%)${perDay !== null ? ` · אפשר עוד כ-<b>${formatCurrency(perDay)}</b> ביום עד סוף החודש` : ""}</p>`
      : `<div class="env-left"><small>הוצא החודש</small><strong>${formatCurrency(used)}</strong></div>`}
      <ul class="items">
        ${manual ? `<li class="muted manual">סכום כללי שהוזן בטבלה: ${formatCurrency(used)}. הוצאה ראשונה שתוסיפי תצורף אליו.</li>` : ""}
        ${items.map(i => `<li><span class="day">${i.day}.${+mm}</span><span class="note">${escapeHTML(i.note) || "—"}</span>
          <b>${formatCurrency(i.amount)}</b><button class="x" data-del-item="${escapeHTML(i.id)}" aria-label="מחיקת הוצאה">✕</button></li>`).join("")}
      </ul>
      <form class="add-item" autocomplete="off">
        <input name="note" maxlength="40" placeholder="על מה?" aria-label="תיאור ההוצאה" />
        <input name="amount" inputmode="decimal" placeholder="₪" aria-label="סכום" />
        <button class="btn small primary" aria-label="הוספת הוצאה">＋</button>
      </form>
    </article>`;
  }).join("");
}

$("#envelopes").addEventListener("submit", e => {
  e.preventDefault();
  const form = e.target;
  const id = form.closest(".env").dataset.id;
  const amount = parseAmount(form.amount.value);
  if (!(amount > 0)) { form.amount.classList.add("invalid"); form.amount.focus(); return; }
  const today = new Date();
  const day = ui.month === thisMonth() ? today.getDate() : 1;
  let items = [...itemsOf(id)];
  const existing = Number(monthData()[id]) || 0;
  // a plain total typed in the sheet becomes the first item, so nothing is lost
  if (!items.length && existing) items.push({ id: slugify(), amount: existing, note: "סכום שהוזן קודם", day: 1 });
  items.push({ id: slugify(), amount, note: form.note.value.trim(), day });
  commit(setItems(state, ui.month, id, items));
  const c = cat(id), left = (state.budgets[id] || 0) - (Number(monthData()[id]) || 0);
  toast(state.budgets[id] ? (left >= 0 ? `נוסף ✓ נשארו ${formatCurrency(left)} ל${c.name}` : `נוסף. חריגה של ${formatCurrency(-left)} 🚨`) : "ההוצאה נוספה ✓");
  $(`.env[data-id="${CSS.escape(id)}"] input[name=note]`)?.focus();
});
$("#envelopes").addEventListener("input", e => e.target.classList.remove("invalid"));
$("#envelopes").addEventListener("click", e => {
  if (e.target.closest("[data-open-budgets]")) return openBudgets();
  const itemId = e.target.closest("[data-del-item]")?.dataset.delItem;
  if (!itemId) return;
  const id = e.target.closest(".env").dataset.id;
  commit(setItems(state, ui.month, id, itemsOf(id).filter(i => i.id !== itemId)), "ההוצאה נמחקה");
});

function renderGoals() {
  $("#goals").innerHTML = state.goals.length ? state.goals.map(g => {
    const pct = Math.min(100, Math.round((g.saved / g.target) * 100));
    const done = pct >= 100;
    return `<li class="goal ${done ? "done" : ""}" data-id="${escapeHTML(g.id)}">
      <div class="ring" style="--p:${pct}"><span>${escapeHTML(g.icon)}</span></div>
      <div class="goal-body">
        <div class="goal-head"><strong>${escapeHTML(g.name)}</strong><span>${pct}%</span></div>
        <small class="muted">${formatCurrency(g.saved)} מתוך ${formatCurrency(g.target)}${done ? " · הושג! 🎉" : ""}</small>
        <div class="goal-actions">
          <button class="chip" data-goal-add="100">+100</button>
          <button class="chip" data-goal-add="500">+500</button>
          <button class="chip ghost" data-goal-edit>עריכה</button>
        </div>
      </div></li>`;
  }).join("") : `<li class="placeholder">אין עדיין יעדים. מה החלום הבא? ✨</li>`;
}

/* =========================================================
   Dialogs
   ========================================================= */

$$("dialog").forEach(d => d.addEventListener("click", e => {
  if (e.target === d || e.target.matches("[data-close]")) d.close();
}));

function ask(message, okLabel = "אישור", danger = false) {
  const d = $("#confirmDialog");
  $("#confirmMsg").textContent = message;
  $("#confirmOk").textContent = okLabel;
  $("#confirmOk").classList.toggle("danger-solid", danger);
  d.returnValue = "";
  d.showModal();
  return new Promise(res => d.addEventListener("close", () => res(d.returnValue === "ok"), { once: true }));
}

/* ---------- Categories ---------- */
function renderCatList() {
  $("#catList").innerHTML = KINDS.map(k => `
    <h4>${k.name}</h4>
    <ul>${state.categories.filter(c => c.kind === k.id).map(c => `
      <li><span>${escapeHTML(c.icon)} ${escapeHTML(c.name)}</span>
      <button type="button" class="chip ghost" data-del-cat="${escapeHTML(c.id)}" aria-label="הסרת ${escapeHTML(c.name)}">✕ הסרה</button></li>`).join("")}</ul>`).join("");
}
/** Create a custom category; returns its id, or an error message. */
function createCategory(name, icon, kind) {
  name = name.trim();
  if (!name) return { error: "יש לתת שם לקטגוריה" };
  if (state.categories.some(c => c.name === name && c.kind === kind)) return { error: "קטגוריה בשם הזה כבר קיימת" };
  const color = PALETTE[state.categories.length % PALETTE.length];
  const c = { id: slugify(name), name, icon: icon.trim() || "🏷️", color, kind, custom: true };
  // place it right after the last category of the same section
  const cats = [...state.categories];
  cats.splice(cats.map(x => x.kind).lastIndexOf(kind) + 1, 0, c);
  state = { ...state, categories: cats };
  persist(`הקטגוריה "${name}" נוספה ✓`);
  return { id: c.id };
}

$("#sheet").addEventListener("click", e => {
  const box = e.target.closest(".new-cat");
  if (!box) return;
  const form = box.querySelector(".new-cat-form");
  if (e.target.closest("[data-new-cat]")) {
    box.querySelector("[data-new-cat]").hidden = true;
    form.hidden = false;
    form.elements.name.focus();
  }
  if (e.target.closest("[data-cancel-cat]")) {
    form.hidden = true;
    box.querySelector("[data-new-cat]").hidden = false;
  }
});
$("#sheet").addEventListener("submit", e => {
  const form = e.target.closest(".new-cat-form");
  if (!form) return;
  e.preventDefault();
  const res = createCategory(form.elements.name.value, form.icon.value, form.closest(".new-cat").dataset.kind);
  if (res.error) { toast(res.error); form.elements.name.focus(); return; }
  renderAll();
  const input = $(`#in-${CSS.escape(res.id)}`);
  input?.scrollIntoView({ behavior: "smooth", block: "center" });
  input?.focus({ preventScroll: true });
});

$("#manageCats").addEventListener("click", () => { renderCatList(); $("#catErrors").textContent = ""; $("#catDialog").showModal(); });
$("#catForm").addEventListener("submit", e => {
  e.preventDefault();
  const f = e.target;
  const res = createCategory(f.elements.name.value, f.icon.value, f.kind.value);
  if (res.error) { $("#catErrors").textContent = res.error; return; }
  f.elements.name.value = ""; $("#catErrors").textContent = "";
  renderCatList(); renderAll();
});
$("#catList").addEventListener("click", async e => {
  const id = e.target.closest("[data-del-cat]")?.dataset.delCat;
  if (!id) return;
  const c = cat(id);
  const used = Object.values(state.months).some(m => m[id]);
  $("#catDialog").close();
  if (used && !(await ask(`בקטגוריה "${c.name}" יש סכומים שמורים. להסיר אותה ואת הסכומים שלה?`, "הסרה", true))) { $("#catDialog").showModal(); return; }
  const months = {};
  for (const [k, m] of Object.entries(state.months)) {
    const { [id]: _, ...rest } = m;
    if (Object.keys(rest).length) months[k] = rest;
  }
  const { [id]: __, ...budgets } = state.budgets;
  const items = {};
  for (const [k, byCat] of Object.entries(state.items ?? {})) {
    const { [id]: ___, ...rest } = byCat;
    if (Object.keys(rest).length) items[k] = rest;
  }
  commit({ ...state, categories: state.categories.filter(x => x.id !== id), months, items, budgets }, `"${c.name}" הוסרה`);
  renderCatList(); $("#catDialog").showModal();
});

/* ---------- Budgets ---------- */
function openBudgets() {
  $("#budgetFields").innerHTML = state.categories.filter(c => c.kind === "variable").concat(state.categories.filter(c => c.kind === "fixed")).map(c => `
    <label class="budget-field"><span>${escapeHTML(c.icon)} ${escapeHTML(c.name)}</span>
      <input type="number" min="0" step="10" name="${escapeHTML(c.id)}" value="${state.budgets[c.id] ?? ""}" placeholder="—" /></label>`).join("");
  $("#budgetDialog").showModal();
}
$("#editBudgets").addEventListener("click", openBudgets);
$("#budgetForm").addEventListener("submit", e => {
  e.preventDefault();
  const budgets = {};
  for (const [k, v] of new FormData(e.target)) if (Number(v) > 0) budgets[k] = Number(v);
  $("#budgetDialog").close();
  commit({ ...state, budgets }, "התקציב נשמר ✓");
});

/* ---------- Goals ---------- */
let editingGoal = null;
function openGoal(goal = null) {
  editingGoal = goal;
  const f = $("#goalForm");
  f.reset();
  $("#goalErrors").textContent = "";
  $("#goalTitle").textContent = goal ? "עריכת יעד" : "יעד חיסכון חדש";
  $("#goalDelete").hidden = !goal;
  if (goal) { f.icon.value = goal.icon; f.elements.name.value = goal.name; f.target.value = goal.target; f.saved.value = goal.saved; }
  $("#goalDialog").showModal();
}
$("#addGoal").addEventListener("click", () => openGoal());
$("#goalForm").addEventListener("submit", e => {
  e.preventDefault();
  const f = e.target;
  const g = { id: editingGoal?.id ?? slugify(), icon: f.icon.value.trim() || "🎯", name: f.elements.name.value.trim(),
    target: Number(f.target.value), saved: Math.max(0, Number(f.saved.value) || 0) };
  if (!g.name || !(g.target > 0)) { $("#goalErrors").textContent = "יש למלא שם וסכום יעד"; return; }
  const goals = editingGoal ? state.goals.map(x => x.id === g.id ? g : x) : [...state.goals, g];
  $("#goalDialog").close();
  commit({ ...state, goals }, "היעד נשמר ✓");
});
$("#goalDelete").addEventListener("click", () => {
  $("#goalDialog").close();
  commit({ ...state, goals: state.goals.filter(g => g.id !== editingGoal.id) }, "היעד נמחק");
});
$("#goals").addEventListener("click", e => {
  const li = e.target.closest(".goal");
  if (!li) return;
  const goal = state.goals.find(g => g.id === li.dataset.id);
  if (e.target.matches("[data-goal-edit]")) return openGoal(goal);
  const add = Number(e.target.dataset.goalAdd);
  if (!add) return;
  const reached = goal.saved < goal.target && goal.saved + add >= goal.target;
  commit({ ...state, goals: state.goals.map(g => g.id === goal.id ? { ...g, saved: g.saved + add } : g) },
    reached ? `🎉 הגעת ליעד "${goal.name}"!` : `נוספו ${formatCurrency(add)} ל${goal.name}`);
  if (reached) confetti();
});

/* =========================================================
   Navigation, theme, data tools
   ========================================================= */

const VIEWS = ["month", "plan", "compare"];
function openView(view, focusId) {
  ui.view = VIEWS.includes(view) ? view : "month";
  for (const name of VIEWS) $(`#view-${name}`).hidden = name !== ui.view;
  $$(".tabs a").forEach(a => a.setAttribute("aria-selected", a.dataset.view === ui.view));
  try { if (location.hash !== "#" + ui.view) history.replaceState(null, "", "#" + ui.view); } catch { /* sandboxed */ }
  renderLive();
  if (focusId) {
    const el = $(`.env[data-id="${CSS.escape(focusId)}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    el?.querySelector("input[name=note]")?.focus({ preventScroll: true });
  } else {
    window.scrollTo({ top: 0 });
  }
}
window.addEventListener("hashchange", () => openView(location.hash.slice(1)));
// handle clicks ourselves so tabs also work inside frames where the hash can't change
document.addEventListener("click", e => {
  const a = e.target.closest('a[href^="#"]');
  if (!a) return;
  e.preventDefault();
  openView(a.getAttribute("href").slice(1));
});

function goMonth(key) { ui.month = key; renderAll(); }
$("#prevMonth").addEventListener("click", () => goMonth(shiftMonth(ui.month, -1)));
$("#nextMonth").addEventListener("click", () => goMonth(shiftMonth(ui.month, 1)));
$("#monthLabel").addEventListener("click", () => goMonth(thisMonth()));
document.addEventListener("keydown", e => {
  if (e.target.closest("input, select, textarea, dialog")) return;
  if (e.key === "ArrowRight") $("#prevMonth").click();
  if (e.key === "ArrowLeft" && !$("#nextMonth").disabled) $("#nextMonth").click();
});

function syncThemeIcon() { $("#themeBtn").textContent = document.documentElement.dataset.theme === "dark" ? "☀️" : "🌙"; }
$("#themeBtn").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("shiklul-theme", next); } catch { /* ignore */ }
  syncThemeIcon();
});

function startEmpty(message) {
  ui.month = thisMonth();
  commit(emptyState(), message);
  openView("month");
  setTimeout(() => $(".amount input")?.focus(), 300);
}
$("#startFresh").addEventListener("click", () => startEmpty("הטבלה ריקה. אפשר להתחיל למלא ✍️"));
$("#startTyping").addEventListener("click", () => {
  const first = $(".amount input");
  first?.scrollIntoView({ behavior: "smooth", block: "center" });
  first?.focus({ preventScroll: true });
});
$("#peekDemo").addEventListener("click", () => { ui.month = thisMonth(); commit(demoState(), "אלה נתוני דוגמה, הם לא יישמרו"); });
$("#loadDemo").addEventListener("click", async () => {
  if (!state.demo && Object.keys(state.months).length && !(await ask("לטעון נתוני דוגמה? הנתונים שלך יימחקו.", "טעינה", true))) return;
  ui.month = thisMonth();
  commit(demoState(), "נתוני דוגמה נטענו ✓");
});
$("#resetBtn").addEventListener("click", async () => {
  if (!(await ask("למחוק את כל הנתונים? אי אפשר לבטל את הפעולה.", "מחיקת הכול", true))) return;
  commit(emptyState(), "כל הנתונים נמחקו");
});

const inFrame = (() => { try { return window.self !== window.top; } catch { return true; } })();
async function exportData(name, content, type, what) {
  if (inFrame) {
    // downloads are blocked inside sandboxed frames: copy instead
    try { await navigator.clipboard.writeText(content.replace(/^﻿/, "")); toast(`${what} הועתק. אפשר להדביק ב-Excel ✓`); }
    catch { toast("⚠️ לא ניתן להעתיק בדפדפן הזה"); }
    return;
  }
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`${what} ירד ✓`);
}
$("#exportCsv").addEventListener("click", () => {
  const keys = monthRange(ui.month, 12).filter(k => state.months[k]);
  if (!keys.length) return toast("אין נתונים לייצוא");
  exportData(`shiklul-${ui.month}.csv`, toCSV(state, keys), "text/csv;charset=utf-8", "הטבלה");
});
$("#exportJson").addEventListener("click", () =>
  exportData(`shiklul-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(state, null, 2), "application/json", "הגיבוי"));
$("#importJson").addEventListener("change", async e => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const data = normalize(JSON.parse(await file.text()));
    if (!Object.keys(data.months).length && !data.goals.length) throw new Error("empty");
    commit({ ...data, demo: false }, `שוחזרו נתונים של ${Object.keys(data.months).length} חודשים ✓`);
  } catch { toast("⚠️ הקובץ לא תקין"); }
});

/* ---------- Install as an app (PWA) ---------- */
const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
let installEvent = null;
if (!inFrame && !standalone) {
  window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvent = e; $("#installBtn").hidden = false; });
  if (isIOS) $("#installBtn").hidden = false; // iOS has no install prompt: we show instructions instead
}
$("#installBtn").addEventListener("click", async () => {
  if (!installEvent) return $("#installDialog").showModal();
  installEvent.prompt();
  const { outcome } = await installEvent.userChoice;
  installEvent = null;
  if (outcome === "accepted") $("#installBtn").hidden = true;
});
window.addEventListener("appinstalled", () => { $("#installBtn").hidden = true; toast("שקלול הותקן 🎉"); });
if ("serviceWorker" in navigator && !inFrame && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("./sw.js").catch(() => { /* offline support is optional */ });
}

/* ---------- Toast + confetti ---------- */
let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}
function confetti() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const colors = ["#145c4b", "#c0922f", "#f3dc9b", "#2f7d57", "#b4452f"];
  for (let i = 0; i < 70; i++) {
    const p = document.createElement("i");
    p.className = "confetti";
    p.style.cssText = `left:${Math.random() * 100}vw;background:${colors[i % 5]};animation-duration:${1.2 + Math.random() * 1.4}s;animation-delay:${Math.random() * .3}s`;
    document.body.append(p);
    setTimeout(() => p.remove(), 3000);
  }
}

/* ---------- Boot ---------- */
// everyone starts with a clean sheet; sample data is only a preview and is never kept
if (isFirstVisit() || state.demo) { state = emptyState(); save(state); }
syncThemeIcon();
renderAll();
openView(location.hash.slice(1));
