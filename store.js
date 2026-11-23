/**
 * Persistence: localStorage, schema validation/migration, demo data.
 */
import { DEFAULT_CATEGORIES, monthKey, shiftMonth, slugify, sumItems, daysInMonth } from "./utils.js";

const KEY = "shiklul-state";
const PREV_KEY = "kupa-state-v2"; // name before the rename: migrated once
const OLD_KEY = "kupa-state-v1";

export function emptyState() {
  return { version: 3, categories: DEFAULT_CATEGORIES.map(c => ({ ...c })), months: {}, items: {}, budgets: {}, goals: [], demo: false };
}

// v1 stored individual transactions; map their categories onto the new ones
const V1_MAP = {
  food: "groceries", housing: "rent", transport: "transport", bills: "electricity", fun: "fun",
  shopping: "clothing", health: "health", education: "education", other: "misc",
  salary: "salary", business: "business", gift: "other-income", "other-income": "other-income",
};

/** Validate anything we load (storage or an imported file) and return a clean state. */
export function normalize(raw) {
  const s = emptyState();
  if (!raw || typeof raw !== "object") return s;

  if (Array.isArray(raw.categories) && raw.categories.length) {
    const seen = new Set();
    s.categories = raw.categories
      .filter(c => c && c.id && c.name && ["income", "fixed", "variable"].includes(c.kind) && !seen.has(c.id) && seen.add(c.id))
      .map(c => ({
        id: String(c.id).slice(0, 40), name: String(c.name).slice(0, 30), icon: String(c.icon || "•").slice(0, 4),
        color: DEFAULT_CATEGORIES.find(d => d.id === c.id && !c.custom)?.color ?? (/^#[0-9a-f]{6}$/i.test(c.color) ? c.color : "#6e7a72"),
        kind: c.kind, ...(c.custom ? { custom: true } : {}),
      }))
      // built-in categories always use the current name and icon
      .map(c => { const d = !c.custom && DEFAULT_CATEGORIES.find(x => x.id === c.id); return d ? { ...c, name: d.name, icon: d.icon } : c; });
    // data saved before v3 gets the categories that were added since, right after their section's last built-in one
    if (!(Number(raw.version) >= 3)) {
      for (const d of DEFAULT_CATEGORIES) {
        if (s.categories.some(c => c.id === d.id)) continue;
        const lastSame = s.categories.map(c => c.kind).lastIndexOf(d.kind);
        s.categories.splice(lastSame + 1, 0, { ...d });
      }
    }
  }
  const ids = new Set(s.categories.map(c => c.id));

  if (raw.months && typeof raw.months === "object") {
    for (const [key, data] of Object.entries(raw.months)) {
      if (!/^\d{4}-\d{2}$/.test(key) || !data || typeof data !== "object") continue;
      const clean = {};
      for (const [id, v] of Object.entries(data)) if (ids.has(id) && Number(v) > 0) clean[id] = Math.round(Number(v) * 100) / 100;
      if (Object.keys(clean).length) s.months[key] = clean;
    }
  }

  // individual expenses ("envelopes"); the month total always equals their sum
  if (raw.items && typeof raw.items === "object") {
    for (const [key, byCat] of Object.entries(raw.items)) {
      if (!/^\d{4}-\d{2}$/.test(key) || !byCat || typeof byCat !== "object") continue;
      for (const [id, list] of Object.entries(byCat)) {
        if (!ids.has(id) || !Array.isArray(list)) continue;
        const clean = list.filter(i => i && Number(i.amount) > 0).map(i => ({
          id: String(i.id ?? slugify()), amount: Math.round(Number(i.amount) * 100) / 100,
          note: String(i.note ?? "").slice(0, 40), day: Math.min(31, Math.max(1, parseInt(i.day, 10) || 1)),
        }));
        if (!clean.length) continue;
        (s.items[key] ??= {})[id] = clean;
        (s.months[key] ??= {})[id] = sumItems(clean);
      }
    }
  }

  // migrate v1 transactions → monthly totals
  if (Array.isArray(raw.transactions)) {
    for (const t of raw.transactions) {
      const id = V1_MAP[t?.category];
      if (!id || !(Number(t.amount) > 0) || !t.date) continue;
      const key = monthKey(String(t.date));
      s.months[key] ??= {};
      s.months[key][id] = (s.months[key][id] ?? 0) + Number(t.amount);
    }
  }

  if (raw.budgets && typeof raw.budgets === "object") {
    for (const [k, v] of Object.entries(raw.budgets)) {
      const id = ids.has(k) ? k : V1_MAP[k];
      if (id && ids.has(id) && Number(v) > 0) s.budgets[id] = Number(v);
    }
  }
  if (Array.isArray(raw.goals)) {
    s.goals = raw.goals.filter(g => g && g.name && Number(g.target) > 0).map(g => ({
      id: String(g.id ?? slugify()), name: String(g.name).slice(0, 30), icon: String(g.icon ?? "🎯").slice(0, 4),
      target: Number(g.target), saved: Math.max(0, Number(g.saved) || 0),
    }));
  }
  s.demo = raw.demo === true;
  return s;
}

export function load() {
  try {
    // the first version auto-filled sample data, so anything stored under the old key is discarded
    localStorage.removeItem(OLD_KEY);
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem(PREV_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch { /* storage blocked or corrupted */ }
  return emptyState();
}

export function isFirstVisit() {
  try { return localStorage.getItem(KEY) === null && localStorage.getItem(PREV_KEY) === null; } catch { return true; }
}

export function save(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); localStorage.removeItem(PREV_KEY); return true; } catch { return false; }
}

/* ---------- Demo data (seeded so it looks the same every time) ---------- */

function seeded(seed) {
  return () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
}

export function demoState(today = new Date()) {
  const rnd = seeded(7);
  const around = (base, spread) => Math.round(base + (rnd() - 0.5) * 2 * spread);
  const s = emptyState();
  const end = monthKey(today);
  for (let i = 5; i >= 0; i--) {
    const key = shiftMonth(end, -i);
    const winter = ["12", "01", "02"].includes(key.slice(5));
    const summer = ["06", "07", "08"].includes(key.slice(5));
    const m = {
      salary: 9400, business: around(1700, 800),
      rent: 3600, arnona: key.slice(5) % 2 ? 0 : 640, electricity: around(summer || winter ? 520 : 340, 60), water: around(170, 30), gas: around(70, 20),
      internet: 139, insurance: 240, subscriptions: 95, education: 450,
      groceries: around(1750, 220), restaurants: around(480, 200), transport: around(330, 60), clothing: around(280, 220),
      health: around(140, 90), fun: around(300, 140), gifts: i === 2 ? 650 : around(120, 100), home: around(150, 140), misc: around(90, 60),
    };
    if (i === 2) m.benefits = 500;
    if (i === 0) { m.restaurants = 820; m.clothing = 160; } // makes "this month" interesting
    for (const k of Object.keys(m)) if (!(m[k] > 0)) delete m[k];
    s.months[key] = m;
  }
  // itemised expenses for the current month in the budgeted categories
  const notes = {
    groceries: ["שופרסל", "שוק מחנה יהודה", "מכולת", "רמי לוי", "פירות וירקות"],
    restaurants: ["פיצה עם חברות", "בית קפה", "סושי", "המבורגר", "ארוחת שישי"],
    fun: ["קולנוע", "הופעה", "חדר בריחה", "באולינג"],
    clothing: ["חולצה", "נעלי ספורט"],
    transport: ["רב-קו", "מונית", "דלק"],
  };
  const day = today.getDate();
  for (const [id, list] of Object.entries(notes)) {
    const total = s.months[end][id];
    if (!total) continue;
    const n = Math.min(list.length, Math.max(2, Math.round(total / 250)));
    const items = [];
    let left = total;
    for (let k = 0; k < n; k++) {
      const amount = k === n - 1 ? left : Math.round(total / n * (0.75 + rnd() * 0.4));
      left -= amount;
      items.push({ id: `d-${id}-${k}`, amount, note: list[k], day: Math.max(1, Math.round(((k + 1) / n) * Math.min(day, daysInMonth(end)))) });
    }
    if (left !== 0) items[items.length - 1].amount += left;
    (s.items[end] ??= {})[id] = items;
  }

  s.budgets = { groceries: 1900, restaurants: 600, fun: 400, clothing: 400, transport: 400 };
  s.goals = [
    { id: "g1", name: "קרן חירום", icon: "🛟", target: 20000, saved: 12500 },
    { id: "g2", name: "לפטופ חדש", icon: "💻", target: 6000, saved: 2100 },
    { id: "g3", name: "חופשה", icon: "✈️", target: 8000, saved: 7400 },
  ];
  s.demo = true;
  return s;
}
