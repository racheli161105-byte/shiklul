import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CATEGORIES, parseAmount, monthKey, shiftMonth, monthRange, monthTotals, hasData, series,
  categoryAverage, pctChange, topChanges, savingsRate, budgetStatus, toCSV, escapeHTML,
} from "./utils.js";
import { normalize, demoState, emptyState } from "./store.js";

const cats = DEFAULT_CATEGORIES;
const state = {
  ...emptyState(),
  months: {
    "2026-09": { salary: 9000, rent: 3500, groceries: 1500, restaurants: 300 },
    "2026-10": { salary: 9000, rent: 3500, groceries: 1700, restaurants: 500 },
    "2026-11": { salary: 9500, business: 1000, rent: 3500, electricity: 400, groceries: 1600, restaurants: 1100 },
  },
};

test("parseAmount handles plain numbers, sums and junk", () => {
  assert.equal(parseAmount("250"), 250);
  assert.equal(parseAmount("120+85.5"), 205.5);
  assert.equal(parseAmount(" 1,200 ₪"), 1200);
  assert.equal(parseAmount(""), 0);
  assert.ok(Number.isNaN(parseAmount("abc")));
  assert.ok(Number.isNaN(parseAmount("10++5")));
  assert.ok(Number.isNaN(parseAmount("-5")));
});

test("month helpers cross year boundaries", () => {
  assert.equal(monthKey("2026-11-23"), "2026-11");
  assert.equal(monthKey(new Date(2026, 0, 5)), "2026-01");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.deepEqual(monthRange("2026-02", 3), ["2025-12", "2026-01", "2026-02"]);
});

test("monthTotals splits income, fixed and variable", () => {
  assert.deepEqual(monthTotals(state.months["2026-11"], cats), {
    income: 10500, fixed: 3900, variable: 2700, expense: 6600, balance: 3900,
  });
  assert.deepEqual(monthTotals(undefined, cats), { income: 0, fixed: 0, variable: 0, expense: 0, balance: 0 });
});

test("hasData ignores empty months", () => {
  assert.equal(hasData({}), false);
  assert.equal(hasData(undefined), false);
  assert.equal(hasData({ rent: 1 }), true);
});

test("series is oldest → newest and zero-fills missing months", () => {
  const s = series(state, "2026-11", 4);
  assert.deepEqual(s.map(x => x.key), ["2026-08", "2026-09", "2026-10", "2026-11"]);
  assert.equal(s[0].expense, 0);
  assert.equal(s[3].income, 10500);
});

test("categoryAverage counts only months with data", () => {
  const keys = monthRange("2026-11", 6);
  assert.equal(categoryAverage(state, "groceries", keys), 1600);
  assert.equal(categoryAverage(state, "electricity", keys), 400 / 3);
});

test("pctChange returns null without a baseline", () => {
  assert.equal(pctChange(150, 100), 50);
  assert.equal(pctChange(50, 0), null);
});

test("topChanges finds the biggest jump vs. the recent average", () => {
  const top = topChanges(state, "2026-11", 2, 3);
  assert.equal(top[0].category.id, "restaurants");
  assert.equal(top[0].avg, 400);
  assert.equal(top[0].diff, 700);
  assert.ok(top.every(x => x.category.kind !== "income"));
});

test("savingsRate and budgetStatus", () => {
  assert.equal(savingsRate(10000, 7500), 25);
  assert.equal(savingsRate(0, 500), 0);
  assert.equal(budgetStatus(50, 100).state, "ok");
  assert.equal(budgetStatus(85, 100).state, "warn");
  assert.equal(budgetStatus(120, 100).state, "over");
  assert.equal(budgetStatus(10, 0).state, "none");
});

test("toCSV builds a category × month table with totals", () => {
  const csv = toCSV(state, ["2026-10", "2026-11"]);
  const lines = csv.replace("﻿", "").split("\n");
  assert.ok(csv.startsWith("﻿"));
  assert.equal(lines.length, 1 + cats.length + 3);
  assert.ok(lines.some(l => l.includes('"סה״כ הוצאות","5700","6600"')));
});

test("escapeHTML neutralises markup", () => {
  assert.equal(escapeHTML('<b onclick="x">'), "&lt;b onclick=&quot;x&quot;&gt;");
});

test("normalize cleans untrusted input and drops unknown categories", () => {
  const s = normalize({
    categories: [...cats, { id: "pets", name: "חיות", icon: "🐶", color: "#123456", kind: "variable", custom: true }, { id: "bad", kind: "nope" }],
    months: { "2026-11": { rent: "3000", pets: 200, ghost: 50, groceries: -4 }, "garbage": { rent: 1 } },
    budgets: { groceries: "900", ghost: 100 },
    goals: [{ name: "Trip", target: 100 }, { name: "", target: 5 }],
  });
  assert.equal(s.categories.length, cats.length + 1);
  assert.deepEqual(s.months, { "2026-11": { rent: 3000, pets: 200 } });
  assert.deepEqual(s.budgets, { groceries: 900 });
  assert.equal(s.goals.length, 1);
  assert.equal(normalize("garbage").categories.length, cats.length);
});

test("normalize migrates v1 transactions into monthly totals", () => {
  const s = normalize({
    transactions: [
      { type: "expense", category: "food", amount: 100, date: "2026-11-02" },
      { type: "expense", category: "food", amount: 50, date: "2026-11-20" },
      { type: "income", category: "salary", amount: 9000, date: "2026-11-01" },
    ],
    budgets: { food: 1500 },
  });
  assert.deepEqual(s.months["2026-11"], { groceries: 150, salary: 9000 });
  assert.deepEqual(s.budgets, { groceries: 1500 });
});

test("demoState has six months of valid data", () => {
  const d = demoState(new Date(2026, 10, 23));
  assert.equal(Object.keys(d.months).length, 6);
  assert.ok(d.demo);
  for (const m of Object.values(d.months)) {
    const t = monthTotals(m, d.categories);
    assert.ok(t.income > 0 && t.fixed > 0 && t.variable > 0);
  }
});

import { setItems, sumItems, dailyAllowance, daysInMonth } from "./utils.js";

test("setItems keeps the month total equal to the sum of the items", () => {
  let s = { ...emptyState(), months: { "2026-11": { rent: 3000 } } };
  s = setItems(s, "2026-11", "fun", [{ id: "a", amount: 120, note: "קולנוע", day: 3 }, { id: "b", amount: 80.5, note: "", day: 9 }]);
  assert.equal(s.months["2026-11"].fun, 200.5);
  assert.equal(s.months["2026-11"].rent, 3000);
  assert.equal(s.items["2026-11"].fun.length, 2);
  s = setItems(s, "2026-11", "fun", []);
  assert.equal(s.months["2026-11"].fun, undefined);
  assert.equal(s.items["2026-11"], undefined);
  assert.equal(sumItems([{ amount: 1.1 }, { amount: 2.2 }]), 3.3);
});

test("dailyAllowance spreads what is left over the remaining days", () => {
  assert.equal(daysInMonth("2026-02"), 28);
  assert.equal(dailyAllowance(300, "2026-11", new Date(2026, 10, 21)), 30); // 10 days left incl. today
  assert.equal(dailyAllowance(-5, "2026-11", new Date(2026, 10, 21)), null);
  assert.equal(dailyAllowance(300, "2026-10", new Date(2026, 10, 21)), null);
});

test("normalize recalculates totals from items", () => {
  const s = normalize({ months: { "2026-11": { fun: 999 } }, items: { "2026-11": { fun: [{ amount: 50 }, { amount: 70, note: "x", day: 40 }], ghost: [{ amount: 5 }] } } });
  assert.equal(s.months["2026-11"].fun, 120);
  assert.equal(s.items["2026-11"].fun[1].day, 31);
  assert.equal(s.items["2026-11"].ghost, undefined);
});

test("demo items add up to the demo totals", () => {
  const d = demoState(new Date(2026, 10, 23));
  for (const [id, list] of Object.entries(d.items["2026-11"])) {
    assert.equal(sumItems(list), d.months["2026-11"][id], id);
    assert.ok(list.every(i => i.amount > 0 && i.day >= 1 && i.day <= 23), id);
  }
});

test("older saved data gets the newer built-in categories", () => {
  const old = DEFAULT_CATEGORIES.filter(c => c.id !== "other-fixed").map(c => ({ ...c, name: c.id === "misc" ? "שונות" : c.name }));
  const s = normalize({ version: 2, categories: [...old, { id: "c-1", name: "וטרינר", icon: "🐶", color: "#123456", kind: "variable", custom: true }] });
  const ids = s.categories.map(c => c.id);
  assert.ok(ids.includes("other-fixed"));
  assert.equal(ids.indexOf("other-fixed"), ids.indexOf("education") + 1);
  assert.equal(s.categories.find(c => c.id === "misc").name, "אחר / שונות");
  assert.equal(s.categories.find(c => c.id === "c-1").name, "וטרינר");
  // a v3 user who removed a built-in category doesn't get it back
  const v3 = normalize({ version: 3, categories: DEFAULT_CATEGORIES.filter(c => c.id !== "gas") });
  assert.ok(!v3.categories.some(c => c.id === "gas"));
});
