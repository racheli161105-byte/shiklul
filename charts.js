/**
 * Tiny dependency-free SVG charts.
 */
import { formatCurrency, escapeHTML } from "./utils.js";

/** Donut chart. segments: [{ label, value, color }] */
export function donut(segments, { centerTitle = "", centerValue = "" } = {}) {
  const size = 220, stroke = 30, r = (size - stroke) / 2, c = 2 * Math.PI * r, mid = size / 2;
  const total = segments.reduce((s, x) => s + x.value, 0);
  const ring = `<circle cx="${mid}" cy="${mid}" r="${r}" fill="none" stroke="var(--track)" stroke-width="${stroke}"/>`;
  if (!total) {
    return `<svg viewBox="0 0 ${size} ${size}" class="donut" role="img" aria-label="אין נתונים">${ring}
      <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" class="donut-empty">עוד אין הוצאות</text></svg>`;
  }
  const gap = segments.length > 1 ? 3 : 0;
  let offset = 0;
  const arcs = segments.map((s, i) => {
    const len = (s.value / total) * c;
    const vis = Math.max(len - gap, 0.5);
    const el = `<circle class="arc" style="--d:${i * 60}ms" cx="${mid}" cy="${mid}" r="${r}" fill="none" stroke="${s.color}"
      stroke-width="${stroke}" stroke-dasharray="${vis} ${c - vis}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${mid} ${mid})">
      <title>${escapeHTML(s.label)}: ${formatCurrency(s.value)} (${Math.round((s.value / total) * 100)}%)</title></circle>`;
    offset += len;
    return el;
  }).join("");
  return `<svg viewBox="0 0 ${size} ${size}" class="donut" role="img" aria-label="התפלגות ההוצאות">${ring}${arcs}
    <text x="50%" y="44%" text-anchor="middle" class="donut-title">${escapeHTML(centerTitle)}</text>
    <text x="50%" y="58%" text-anchor="middle" class="donut-value">${escapeHTML(centerValue)}</text></svg>`;
}

/**
 * Income bar next to a stacked expense bar (fixed + variable), per month.
 * data: [{ label, income, fixed, variable, active }], newest first (drawn from the right).
 */
export function bars(data) {
  const W = 680, H = 270, padL = 10, padR = 52, padT = 14, padB = 34;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const max = niceMax(Math.max(1, ...data.flatMap(d => [d.income, d.fixed + d.variable])));
  const group = innerW / data.length;
  const bw = Math.max(6, Math.min(24, group / 3.4));
  const y = v => padT + innerH - (v / max) * innerH;
  const h = v => (v / max) * innerH;

  let grid = "";
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    grid += `<line x1="${padL}" x2="${padL + innerW}" y1="${y(v)}" y2="${y(v)}" class="grid"/>
      <text x="${W - 4}" y="${y(v) + 4}" text-anchor="end" class="axis">${shortNum(v)}</text>`;
  }

  const cols = data.map((d, i) => {
    // newest on the right, next to the axis, matching right-to-left reading
    const cx = padL + innerW - group * (i + 0.5);
    const exp = d.fixed + d.variable;
    return `<g class="col ${d.active ? "active" : ""}" style="--d:${i * 50}ms">
      <rect class="hit" x="${cx - group / 2}" y="${padT}" width="${group}" height="${innerH}"/>
      <rect class="bar inc" x="${cx + 2}" y="${y(d.income)}" width="${bw}" height="${h(d.income)}" rx="4"/>
      <rect class="bar var" x="${cx - bw - 2}" y="${y(exp)}" width="${bw}" height="${h(d.variable)}" rx="4"/>
      <rect class="bar fix" x="${cx - bw - 2}" y="${y(d.fixed)}" width="${bw}" height="${h(d.fixed)}" rx="4"/>
      <text x="${cx}" y="${H - 10}" text-anchor="middle" class="axis month">${escapeHTML(d.label)}</text>
      <title>${escapeHTML(d.label)}: הכנסות ${formatCurrency(d.income)} · קבועות ${formatCurrency(d.fixed)} · משתנות ${formatCurrency(d.variable)}</title>
    </g>`;
  }).join("");

  return `<svg viewBox="0 0 ${W} ${H}" class="bars" direction="ltr" role="img" aria-label="הכנסות מול הוצאות לפי חודש">${grid}${cols}</svg>`;
}

function niceMax(v) {
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 1.2, 1.6, 2, 2.4, 3.2, 4, 6, 8, 10].find(s => s * p >= v) * p;
}

function shortNum(v) {
  return v >= 1000 ? `${+(v / 1000).toFixed(1)}K` : String(Math.round(v));
}
