/**
 * Pure helper functions: no DOM, no storage.
 * Everything here is covered by tests in /tests.
 *
 * Data model
 * ----------
 * state.categories : [{ id, name, icon, color, kind: "income" | "fixed" | "variable", custom? }]
 * state.months     : { "2026-11": { rent: 3400, groceries: 1650, ... } }
 */

export const KINDS = [
  { id: "income", name: "הכנסות", hint: "משכורת, עסק, קצבאות" },
  { id: "fixed", name: "הוצאות קבועות", hint: "חוזרות כל חודש בסכום דומה" },
  { id: "variable", name: "הוצאות משתנות", hint: "משתנות מחודש לחודש" },
];

export const DEFAULT_CATEGORIES = [
  // income
  { id: "salary", name: "משכורת", icon: "💼", color: "#2f7d57", kind: "income" },
  { id: "business", name: "עסק עצמאי", icon: "✨", color: "#3f8f86", kind: "income" },
  { id: "benefits", name: "קצבאות ומלגות", icon: "🎓", color: "#7a9a5a", kind: "income" },
  { id: "other-income", name: "הכנסה אחרת", icon: "💰", color: "#9aa86a", kind: "income" },
  // fixed
  { id: "rent", name: "שכירות / משכנתא", icon: "🏠", color: "#1f4e46", kind: "fixed" },
  { id: "arnona", name: "ארנונה", icon: "🏛️", color: "#5b6b8c", kind: "fixed" },
  { id: "electricity", name: "חשמל", icon: "💡", color: "#c08a2d", kind: "fixed" },
  { id: "water", name: "מים", icon: "🚿", color: "#4f86a6", kind: "fixed" },
  { id: "gas", name: "גז", icon: "🔥", color: "#b4613f", kind: "fixed" },
  { id: "internet", name: "אינטרנט וטלפון", icon: "📶", color: "#3f7f8c", kind: "fixed" },
  { id: "insurance", name: "ביטוחים", icon: "🛡️", color: "#6e7a72", kind: "fixed" },
  { id: "subscriptions", name: "מנויים", icon: "📺", color: "#7d5a7a", kind: "fixed" },
  { id: "education", name: "לימודים וחוגים", icon: "📚", color: "#4d6a99", kind: "fixed" },
  { id: "other-fixed", name: "הוצאה קבועה אחרת", icon: "📌", color: "#6b7f78", kind: "fixed" },
  // variable
  { id: "groceries", name: "סופר ומזון", icon: "🛒", color: "#a8742a", kind: "variable" },
  { id: "restaurants", name: "מסעדות ובתי קפה", icon: "🍽️", color: "#a8483a", kind: "variable" },
  { id: "transport", name: "תחבורה ודלק", icon: "🚌", color: "#3c7a78", kind: "variable" },
  { id: "clothing", name: "ביגוד והנעלה", icon: "👗", color: "#9a5a6e", kind: "variable" },
  { id: "health", name: "בריאות ופארם", icon: "💊", color: "#4f8a68", kind: "variable" },
  { id: "fun", name: "בילויים ופנאי", icon: "🎉", color: "#80568f", kind: "variable" },
  { id: "gifts", name: "מתנות ואירועים", icon: "🎁", color: "#b8606a", kind: "variable" },
  { id: "home", name: "לבית", icon: "🛋️", color: "#8a6a45", kind: "variable" },
  { id: "misc", name: "אחר / שונות", icon: "📦", color: "#8a8f88", kind: "variable" },
];

export const PALETTE = ["#1f4e46", "#a8483a", "#c08a2d", "#4f86a6", "#7d5a7a", "#3f8f86", "#8a6a45", "#9a5a6e", "#5b6b8c", "#6e7a72"];

/* ---------- Formatting ---------- */

const currencyFmt = new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 0 });
export function formatCurrency(n) {
  return currencyFmt.format(Math.round(Number(n) || 0));
}

/**
 * Parse what the user typed in an amount box.
 * Supports simple sums so people can add receipts: "120+85.5" → 205.5
 * "" → 0 · invalid → NaN
 */
export function parseAmount(text) {
  const s = String(text ?? "").replace(/[₪,\s]/g, "");
  if (s === "") return 0;
  if (!/^\d+(\.\d+)?(\+\d+(\.\d+)?)*$/.test(s)) return NaN;
  const sum = s.split("+").reduce((a, b) => a + Number(b), 0);
  return Math.round(sum * 100) / 100;
}

/* ---------- Months ---------- */

export function monthKey(date) {
  if (typeof date === "string") return date.slice(0, 7);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function shiftMonth(key, delta) {
  const [y, m] = key.split("-").map(Number);
  return monthKey(new Date(y, m - 1 + delta, 1));
}

/** The `count` month keys ending at `endKey`, oldest first. */
export function monthRange(endKey, count) {
  return Array.from({ length: count }, (_, i) => shiftMonth(endKey, i - count + 1));
}

export function monthLabel(key, opts = { month: "long", year: "numeric" }) {
  const [y, m] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("he-IL", opts).format(new Date(y, m - 1, 1));
}

/* ---------- Totals ---------- */

export function monthTotals(monthData = {}, categories) {
  const t = { income: 0, fixed: 0, variable: 0 };
  for (const c of categories) {
    const v = Number(monthData[c.id]) || 0;
    if (t[c.kind] !== undefined) t[c.kind] += v;
  }
  const expense = t.fixed + t.variable;
  return { ...t, expense, balance: t.income - expense };
}

export function hasData(monthData) {
  return !!monthData && Object.values(monthData).some(v => Number(v) > 0);
}

export function series(state, endKey, count) {
  return monthRange(endKey, count).map(key => ({ key, ...monthTotals(state.months[key], state.categories) }));
}

/** Average of a category across the given months, counting only months that have any data. */
export function categoryAverage(state, catId, keys) {
  const used = keys.filter(k => hasData(state.months[k]));
  if (!used.length) return 0;
  return used.reduce((s, k) => s + (Number(state.months[k][catId]) || 0), 0) / used.length;
}

/** Percentage change, or null when there is nothing to compare with. */
export function pctChange(now, before) {
  if (!before) return null;
  return Math.round(((now - before) / before) * 100);
}

/**
 * Biggest movers this month compared with the average of the previous `lookback` months.
 * Returns expense categories only, sorted by absolute ₪ difference.
 */
export function topChanges(state, key, lookback = 3, limit = 3) {
  const prevKeys = monthRange(shiftMonth(key, -1), lookback);
  const now = state.months[key] ?? {};
  return state.categories
    .filter(c => c.kind !== "income")
    .map(c => {
      const avg = categoryAverage(state, c.id, prevKeys);
      const value = Number(now[c.id]) || 0;
      return { category: c, value, avg, diff: value - avg, pct: pctChange(value, avg) };
    })
    .filter(x => x.avg > 0 && Math.abs(x.diff) >= 20)
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
    .slice(0, limit);
}

export function savingsRate(income, expense) {
  if (income <= 0) return 0;
  return Math.round(((income - expense) / income) * 100);
}

export function budgetStatus(spent, limit) {
  if (!limit || limit <= 0) return { pct: 0, state: "none" };
  const pct = Math.round((spent / limit) * 100);
  return { pct, state: pct > 100 ? "over" : pct >= 80 ? "warn" : "ok" };
}

/* ---------- Export ---------- */

/** Spreadsheet-style CSV: one row per category, one column per month. */
export function toCSV(state, keys) {
  const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const kindName = Object.fromEntries(KINDS.map(k => [k.id, k.name]));
  const header = ["סוג", "קטגוריה", ...keys.map(k => monthLabel(k))];
  const rows = state.categories.map(c => [kindName[c.kind], c.name, ...keys.map(k => state.months[k]?.[c.id] ?? "")]);
  const totalRow = (label, field) => ["", label, ...keys.map(k => monthTotals(state.months[k], state.categories)[field])];
  const all = [header, ...rows, totalRow("סה״כ הכנסות", "income"), totalRow("סה״כ הוצאות", "expense"), totalRow("יתרה", "balance")];
  return "﻿" + all.map(r => r.map(esc).join(",")).join("\n");
}

export function slugify(name) {
  return "c-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/* ---------- Envelopes: individual expenses under a category ---------- */

export function sumItems(items = []) {
  return Math.round(items.reduce((s, i) => s + (Number(i.amount) || 0), 0) * 100) / 100;
}

/**
 * Replace the expense list of one category in one month.
 * The month total for that category is always kept equal to the sum of its items.
 */
export function setItems(state, key, catId, items) {
  const monthItems = { ...(state.items?.[key] ?? {}) };
  if (items.length) monthItems[catId] = items; else delete monthItems[catId];
  const allItems = { ...(state.items ?? {}) };
  if (Object.keys(monthItems).length) allItems[key] = monthItems; else delete allItems[key];

  const m = { ...(state.months[key] ?? {}) };
  const total = sumItems(items);
  if (total > 0) m[catId] = total; else delete m[catId];
  const months = { ...state.months };
  if (Object.keys(m).length) months[key] = m; else delete months[key];
  return { ...state, items: allItems, months };
}

export function daysInMonth(key) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

/** How much can still be spent per day to stay on budget (only meaningful for the current month). */
export function dailyAllowance(remaining, key, today = new Date()) {
  if (remaining <= 0 || monthKey(today) !== key) return null;
  const daysLeft = daysInMonth(key) - today.getDate() + 1;
  return Math.floor(remaining / daysLeft);
}
