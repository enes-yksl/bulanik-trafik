/* Bulanık Trafik — arayüz */
(() => {
'use strict';
const B = window.BT, K = B.K;
const $ = id => document.getElementById(id);
const fmt = (v, d = 1) => Number.isFinite(v) ? v.toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d }) : '–';
const mmss = t => { t = Math.floor(t); return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'); };
const CT = Object.fromEntries(B.CONTROLLERS.map(c => [c.id, c]));
const SC = Object.fromEntries(B.SCENARIOS.map(s => [s.id, s]));
const SC_SHORT = { dengeli: 'Dengeli', gece: 'Gece', anayol: 'Ana yol', asim: 'Asimetrik', yuksek: 'Yüksek', doygun: 'Aşırı doygun', dalga: 'Kayan talep', sabah: 'Zirve profili', olay: 'Ani artış' };
const MIX = ['dengeli', 'anayol', 'dalga', 'olay'];
const losBadge = d => `<span class="los los-${B.los(d)}" title="HCM hizmet düzeyi">${B.los(d)}</span>`;

// ---------- Kalıcı durum ----------
const S = { P_fuzzy: B.cloneP(B.DEFAULT_P), P_ga: null, gaInfo: null, Q: null, qInfo: null, fixedG: 30, maxG: 60 };
try {
  const g = JSON.parse(localStorage.getItem('bt.ga') || 'null'); if (g && g.P) { S.P_ga = g.P; S.gaInfo = g.info; }
  const q = JSON.parse(localStorage.getItem('bt.q') || 'null'); if (q && q.Q) { S.Q = Float64Array.from(q.Q); S.qInfo = q.info; }
} catch (e) {}
function save() {
  try {
    if (S.P_ga) localStorage.setItem('bt.ga', JSON.stringify({ P: S.P_ga, info: S.gaInfo })); else localStorage.removeItem('bt.ga');
    if (S.Q) localStorage.setItem('bt.q', JSON.stringify({ Q: Array.from(S.Q), info: S.qInfo })); else localStorage.removeItem('bt.q');
  } catch (e) {}
}
const ctx = () => ({ fixedG: S.fixedG, maxG: S.maxG, P_fuzzy: S.P_fuzzy, P_ga: S.P_ga, Q: S.Q });
const ctxPlain = () => ({ fixedG: S.fixedG, maxG: S.maxG, P_fuzzy: B.cloneP(S.P_fuzzy), P_ga: S.P_ga ? B.cloneP(S.P_ga) : null, Q: S.Q ? Array.from(S.Q) : null });
const trained = id => id === 'fuzzyga' ? !!S.P_ga : id === 'qlearn' ? !!S.Q : true;

// ---------- Renkler ----------
let C = {};
function readColors() {
  const cs = getComputedStyle(document.documentElement), g = n => cs.getPropertyValue(n).trim();
  C = { bg: g('--bg'), panel: g('--panel'), ink: g('--ink'), muted: g('--muted'), line: g('--line'), soft: g('--soft'), accent: g('--accent'), red: g('--red'), amber: g('--amber'), go: g('--go'),
    road: g('--road'), grass: g('--grass'), mark: g('--mark'), s: [g('--s1'), g('--s2'), g('--s3'), g('--s4')], ct: {} };
  for (const c of B.CONTROLLERS) C.ct[c.id] = g('--c-' + c.id);
}
readColors();
try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readColors(); refreshStatic(); }); } catch (e) {}
function rgb(h) { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(x => x + x).join(''); const n = parseInt(h, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
const mix = (a, b, f) => { const A = rgb(a), Bb = rgb(b); return `rgb(${A.map((v, i) => Math.round(v + (Bb[i] - v) * f)).join(',')})`; };
const rgba = (h, a) => { const A = rgb(h); return `rgba(${A[0]},${A[1]},${A[2]},${a})`; };

// ---------- Çizim yardımcıları ----------
const MONO = '"IBM Plex Mono", monospace', SANS = '"IBM Plex Sans", sans-serif';
function prep(cv) {
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth || 300, H = cv.dataset.h === 'sq' ? W : +cv.dataset.h;
  if (cv._W !== W || cv._H !== H || cv._d !== dpr) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.height = H + 'px'; cv._W = W; cv._H = H; cv._d = dpr; }
  const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H); return { ctx: c, W, H };
}
function niceMax(v) { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }
function logTicks(lo, hi) { const out = []; for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) for (const m of [1, 2, 5]) { const v = m * Math.pow(10, e); if (v >= lo * 0.999 && v <= hi * 1.001) out.push(v); } return out; }
const tickFmt = v => v === 0 ? '0' : v >= 1 ? (Number.isInteger(v) ? String(v) : fmt(v)) : fmt(v, v < 0.1 ? 2 : 1);

function yScale(o, ih, pt, vals) {
  if (o.log) {
    let lo = Infinity, hi = 0; for (const v of vals) if (v > 0) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (!Number.isFinite(lo)) { lo = 1; hi = 10; }
    lo = Math.pow(10, Math.floor(Math.log10(lo))); hi = Math.pow(10, Math.ceil(Math.log10(hi * 1.05)));
    const l0 = Math.log10(lo), l1 = Math.log10(hi);
    return { Y: v => pt + (1 - (Math.log10(Math.max(v, lo)) - l0) / (l1 - l0)) * ih, ticks: logTicks(lo, hi), base: lo };
  }
  let hi = o.yMax || 0; for (const v of vals) if (v > hi) hi = v; hi = niceMax(hi * 1.05);
  const ticks = []; for (let k = 0; k <= 4; k++) ticks.push(hi * k / 4);
  return { Y: v => pt + (1 - v / hi) * ih, ticks, base: 0 };
}

function drawLines(cv, series, o) {
  const { ctx, W, H } = prep(cv); const pl = 44, pr = 14, pt = 12, pb = 28, iw = W - pl - pr, ih = H - pt - pb;
  const vals = []; for (const s of series) { for (const v of s.ys) vals.push(v); if (s.hi) for (const v of s.hi) vals.push(v); } for (const r of (o.refs || [])) vals.push(r.y);
  const ys = yScale(o, ih, pt, vals), Y = ys.Y;
  const xmin = o.xMin, xmax = Math.max(o.xMax, xmin + 1e-6), X = v => pl + (v - xmin) / (xmax - xmin) * iw;
  ctx.font = `11px ${MONO}`; ctx.textBaseline = 'middle'; ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.fillStyle = C.muted;
  for (const v of ys.ticks) { const y = Y(v); ctx.beginPath(); ctx.moveTo(pl, y); ctx.lineTo(W - pr, y); ctx.stroke(); ctx.textAlign = 'right'; ctx.fillText(tickFmt(v), pl - 6, y); }
  ctx.textAlign = 'center';
  for (const tv of o.xTicks) ctx.fillText(o.xFmt(tv), B.clamp(X(tv), pl + 10, W - pr - 16), H - pb + 15);
  if (o.yLabel) { ctx.save(); ctx.translate(11, pt + ih / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(o.yLabel, 0, 0); ctx.restore(); }
  for (const r of (o.refs || [])) { ctx.strokeStyle = r.color; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(pl, Y(r.y)); ctx.lineTo(W - pr, Y(r.y)); ctx.stroke(); ctx.setLineDash([]);
    if (r.label) { ctx.fillStyle = r.color; ctx.textAlign = 'right'; ctx.font = `11px ${SANS}`; ctx.fillText(r.label, W - pr - 4, Y(r.y) - 8); ctx.font = `11px ${MONO}`; } }
  for (const s of series) {
    if (!s.xs.length) continue;
    if (s.lo && s.hi) { ctx.beginPath(); s.xs.forEach((x, i) => { const px = X(x), py = Y(s.hi[i]); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
      for (let i = s.xs.length - 1; i >= 0; i--) ctx.lineTo(X(s.xs[i]), Y(Math.max(s.lo[i], ys.base || 0))); ctx.closePath(); ctx.fillStyle = rgba(s.color, 0.13); ctx.fill(); }
    ctx.strokeStyle = s.color; ctx.lineWidth = s.w || 2; if (s.dash) ctx.setLineDash(s.dash); ctx.beginPath();
    s.xs.forEach((x, i) => { const px = X(x), py = Y(s.ys[i]); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }); ctx.stroke(); ctx.setLineDash([]);
    if (s.dots) { ctx.fillStyle = s.color; s.xs.forEach((x, i) => { ctx.beginPath(); ctx.arc(X(x), Y(s.ys[i]), 2.6, 0, 7); ctx.fill(); }); }
  }
}

function drawBars(cv, groups, series, o) {
  const { ctx, W, H } = prep(cv); const pl = 48, pr = 10, pt = 12, pb = 40, iw = W - pl - pr, ih = H - pt - pb;
  const vals = []; series.forEach(s => s.vals.forEach((v, i) => vals.push(v + (s.errs ? s.errs[i] : 0))));
  const ys = yScale(o, ih, pt, vals), Y = ys.Y;
  ctx.font = `11px ${MONO}`; ctx.textBaseline = 'middle'; ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.fillStyle = C.muted;
  for (const v of ys.ticks) { const y = Y(v); ctx.beginPath(); ctx.moveTo(pl, y); ctx.lineTo(W - pr, y); ctx.stroke(); ctx.textAlign = 'right'; ctx.fillText(tickFmt(v), pl - 6, y); }
  if (o.yLabel) { ctx.save(); ctx.translate(11, pt + ih / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText(o.yLabel, 0, 0); ctx.restore(); }
  const gw = iw / groups.length, bw = Math.min(26, gw * 0.84 / series.length), y0 = Y(ys.base);
  groups.forEach((g, gi) => {
    const x0 = pl + gi * gw + (gw - bw * series.length) / 2;
    series.forEach((s, si) => {
      const v = s.vals[gi]; if (!Number.isFinite(v)) return;
      const x = x0 + si * bw, y = Y(v);
      ctx.fillStyle = s.color; ctx.fillRect(x + 1, Math.min(y, y0), bw - 2, Math.max(1, Math.abs(y0 - y)));
      if (s.errs && s.errs[gi] > 0) { const e = s.errs[gi], ya = Y(v + e), yb = Y(Math.max(v - e, ys.base || 1e-9)), cx = x + bw / 2;
        ctx.strokeStyle = C.ink; ctx.globalAlpha = 0.7; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx, ya); ctx.lineTo(cx, yb); ctx.moveTo(cx - 3, ya); ctx.lineTo(cx + 3, ya); ctx.moveTo(cx - 3, yb); ctx.lineTo(cx + 3, yb); ctx.stroke(); ctx.globalAlpha = 1; }
    });
    ctx.fillStyle = C.ink; ctx.font = `12px ${SANS}`; ctx.textAlign = 'center';
    ctx.fillText(g, pl + gi * gw + gw / 2, H - pb + 16);
  });
}

function drawInter(cv, sim, base) {
  const { ctx, W } = prep(cv); const sc = W / (2 * (K.L + K.BOX)), c = W / 2, hw = K.LANEW * sc, b = K.BOX * sc;
  ctx.fillStyle = C.grass; ctx.fillRect(0, 0, W, W);
  ctx.fillStyle = C.road; ctx.fillRect(c - hw, 0, 2 * hw, W); ctx.fillRect(0, c - hw, W, 2 * hw);
  ctx.strokeStyle = C.mark; ctx.globalAlpha = .55; ctx.lineWidth = 1; ctx.setLineDash([6, 7]);
  ctx.beginPath(); ctx.moveTo(c, 0); ctx.lineTo(c, c - b); ctx.moveTo(c, c + b); ctx.lineTo(c, W); ctx.moveTo(0, c); ctx.lineTo(c - b, c); ctx.moveTo(c + b, c); ctx.lineTo(W, c); ctx.stroke();
  ctx.setLineDash([]); ctx.globalAlpha = 1;
  // dedektör konumu
  ctx.fillStyle = C.mark; ctx.globalAlpha = .25;
  for (let i = 0; i < 4; i++) { const d = B.DIRS[i], rn = [-d[1], d[0]], dd = K.BOX + K.DET;
    const px = c + (-d[0] * dd + rn[0] * K.LANEW / 2) * sc, py = c + (-d[1] * dd + rn[1] * K.LANEW / 2) * sc;
    ctx.save(); ctx.translate(px, py); ctx.rotate(Math.atan2(d[1], d[0])); ctx.strokeStyle = C.mark; ctx.lineWidth = 1; ctx.strokeRect(-1 * sc, -1.6 * sc, 2 * sc, 3.2 * sc); ctx.restore(); }
  ctx.globalAlpha = .18;
  for (let i = 0; i < 4; i++) { const d = B.DIRS[i], rn = [-d[1], d[0]];
    for (let k = -4; k < 4; k++) { const off = (k + 0.5) * 1.25, px = c + (-d[0] * (K.BOX - 3) + rn[0] * off) * sc, py = c + (-d[1] * (K.BOX - 3) + rn[1] * off) * sc;
      ctx.save(); ctx.translate(px, py); ctx.rotate(Math.atan2(d[1], d[0])); ctx.fillRect(-2 * sc, -0.35 * sc, 4 * sc, 0.7 * sc); ctx.restore(); } }
  ctx.globalAlpha = 1;
  ctx.lineWidth = Math.max(2, 0.6 * sc); ctx.strokeStyle = C.mark;
  for (let i = 0; i < 4; i++) { const d = B.DIRS[i], rn = [-d[1], d[0]];
    const x0 = c - d[0] * K.BOX * sc, y0 = c - d[1] * K.BOX * sc;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + rn[0] * K.LANEW * sc, y0 + rn[1] * K.LANEW * sc); ctx.stroke();
    const s = sim.sig(i), col = s === 'green' ? C.go : s === 'yellow' ? C.amber : C.red;
    const lx = c + (-d[0] * (K.BOX + 2) + rn[0] * (K.LANEW + 3)) * sc, ly = c + (-d[1] * (K.BOX + 2) + rn[1] * (K.LANEW + 3)) * sc, r = Math.max(4, 1.9 * sc);
    ctx.fillStyle = '#16181b'; ctx.beginPath(); ctx.arc(lx, ly, r + 2, 0, 7); ctx.fill();
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(lx, ly, r, 0, 7); ctx.fill();
  }
  for (let i = 0; i < 4; i++) { const d = B.DIRS[i], rn = [-d[1], d[0]], ang = Math.atan2(d[1], d[0]), ln = sim.lanes[i];
    for (const car of ln.cars) { const dd = (K.L + K.BOX) - car.s;
      const fx = c + (-d[0] * dd + rn[0] * K.LANEW / 2) * sc, fy = c + (-d[1] * dd + rn[1] * K.LANEW / 2) * sc;
      const wait = car.done ? 0 : Math.max(0, sim.t - car.tg - car.s / K.VMAX);
      ctx.save(); ctx.translate(fx, fy); ctx.rotate(ang); ctx.fillStyle = mix(base, C.red, Math.min(1, wait / 60));
      const x = -K.CARLEN * sc, y = -K.CARW * sc / 2, w = K.CARLEN * sc, h = K.CARW * sc;
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, Math.min(3, h / 2)); ctx.fill(); } else ctx.fillRect(x, y, w, h);
      ctx.restore(); }
    const ex = c + (-d[0] * (K.L + K.BOX - 7) + rn[0] * (K.LANEW + 9)) * sc, ey = c + (-d[1] * (K.L + K.BOX - 7) + rn[1] * (K.LANEW + 9)) * sc;
    ctx.font = `500 ${Math.max(10, Math.round(4.6 * sc))}px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (ln.pending.length) { ctx.fillStyle = C.red; ctx.fillText('+' + ln.pending.length, ex, ey); }
    const ax = c + (-d[0] * (K.L + K.BOX - 4) - rn[0] * (K.LANEW + 9)) * sc, ay = c + (-d[1] * (K.L + K.BOX - 4) - rn[1] * (K.LANEW + 9)) * sc;
    ctx.fillStyle = C.muted; ctx.font = `${Math.max(10, Math.round(4.2 * sc))}px ${SANS}`; ctx.fillText(B.ARM[i], B.clamp(ax, 26, W - 26), ay);
  }
}

function drawMF(cv, centers, names, xMax, x, mus, agg, out) {
  const { ctx, W, H } = prep(cv); const pl = 30, pr = 12, pt = 22, pb = 22, iw = W - pl - pr, ih = H - pt - pb;
  const X = v => pl + v / xMax * iw, Y = m => pt + (1 - m) * ih;
  ctx.font = `11px ${MONO}`; ctx.textBaseline = 'middle'; ctx.strokeStyle = C.line; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(pl, Y(0)); ctx.lineTo(W - pr, Y(0)); ctx.stroke();
  ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(pl, Y(1)); ctx.lineTo(W - pr, Y(1)); ctx.moveTo(pl, Y(.5)); ctx.lineTo(W - pr, Y(.5)); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = C.muted; ctx.textAlign = 'right'; ctx.fillText('1', pl - 6, Y(1)); ctx.fillText('0,5', pl - 6, Y(.5)); ctx.fillText('0', pl - 6, Y(0));
  ctx.textAlign = 'center'; const step = xMax > 15 ? 5 : 3;
  for (let v = 0; v <= xMax + 1e-9; v += step) ctx.fillText(String(v), X(v), H - pb + 12);
  if (agg) { ctx.beginPath(); ctx.moveTo(X(0), Y(0)); for (let j = 0; j < agg.length; j++) ctx.lineTo(X(j * xMax / (agg.length - 1)), Y(agg[j])); ctx.lineTo(X(xMax), Y(0)); ctx.closePath(); ctx.fillStyle = rgba(C.accent, .26); ctx.fill(); }
  const cols = centers.length === 3 ? [C.s[0], C.s[1], C.s[3]] : C.s;
  for (let k = 0; k < centers.length; k++) {
    ctx.strokeStyle = cols[k]; ctx.lineWidth = 1.8; ctx.beginPath();
    for (let j = 0; j <= 160; j++) { const v = j / 160 * xMax, m = B.ruspini(centers, k, v); j ? ctx.lineTo(X(v), Y(m)) : ctx.moveTo(X(v), Y(m)); }
    ctx.stroke();
    ctx.fillStyle = cols[k]; ctx.font = `500 11.5px ${SANS}`; ctx.textAlign = 'center';
    ctx.fillText(names[k], B.clamp(X(Math.min(centers[k], xMax)), pl + 14, W - pr - 14), pt - 11);
  }
  if (x != null) { const xx = X(Math.min(x, xMax)); ctx.strokeStyle = C.ink; ctx.lineWidth = 1; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(xx, Y(0)); ctx.lineTo(xx, Y(1.04)); ctx.stroke(); ctx.setLineDash([]);
    for (let k = 0; k < mus.length; k++) if (mus[k] > 0) { ctx.fillStyle = cols[k]; ctx.beginPath(); ctx.arc(xx, Y(mus[k]), 4, 0, 7); ctx.fill(); ctx.strokeStyle = C.panel; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = C.ink; ctx.font = `11px ${MONO}`; const rt = xx > W - 70; ctx.textAlign = rt ? 'right' : 'left'; ctx.fillText(fmt(mus[k], 2), xx + (rt ? -8 : 8), Y(mus[k])); } }
  if (out != null) { const xo = X(out); ctx.strokeStyle = C.accent; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(xo, Y(0)); ctx.lineTo(xo, Y(1.04)); ctx.stroke();
    ctx.fillStyle = C.accent; ctx.font = `500 11.5px ${MONO}`; const rt = xo > W - 90; ctx.textAlign = rt ? 'right' : 'left'; ctx.fillText(`e* = ${fmt(out)} s`, xo + (rt ? -6 : 6), Y(0.72)); }
}

function drawPolicy(cv, Q, tb) {
  const { ctx, W, H } = prep(cv); const pl = 64, pr = 10, pt = 10, pb = 44, n = 6;
  const cw = (W - pl - pr) / n, ch = (H - pt - pb) / n;
  let mx = 0; for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) { const k = B.qIndex(g, r, tb); mx = Math.max(mx, Math.abs(Q[k * 2 + 1] - Q[k * 2])); }
  ctx.font = `11px ${MONO}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) {
    const k = B.qIndex(g, r, tb), q0 = Q[k * 2], q1 = Q[k * 2 + 1], x = pl + r * cw, y = pt + (n - 1 - g) * ch;
    let col = C.soft, a = 1, lab = '';
    if (q0 !== 0 || q1 !== 0) { const sw = q1 > q0; col = sw ? C.ct.fixed : C.ct.fuzzyga; a = 0.35 + 0.65 * (mx > 0 ? Math.abs(q1 - q0) / mx : 0); lab = sw ? 'D' : 'S'; }
    ctx.fillStyle = col === C.soft ? C.soft : rgba(col, a); ctx.fillRect(x + 1.5, y + 1.5, cw - 3, ch - 3);
    if (lab) { ctx.fillStyle = a > 0.6 ? '#fff' : C.ink; ctx.fillText(lab, x + cw / 2, y + ch / 2); }
  }
  ctx.fillStyle = C.muted;
  for (let r = 0; r < n; r++) ctx.fillText(B.QB_LABELS[r], pl + r * cw + cw / 2, H - pb + 12);
  ctx.textAlign = 'right'; for (let g = 0; g < n; g++) ctx.fillText(B.QB_LABELS[g], pl - 8, pt + (n - 1 - g) * ch + ch / 2);
  ctx.textAlign = 'center'; ctx.font = `12px ${SANS}`; ctx.fillText('Kırmızı yöndeki araç sayısı', pl + (W - pl - pr) / 2, H - 10);
  ctx.save(); ctx.translate(13, pt + (H - pt - pb) / 2); ctx.rotate(-Math.PI / 2); ctx.fillText('Yeşil yöndeki araç sayısı', 0, 0); ctx.restore();
}

// ---------- Yönlendirme ----------
const VIEWS = ['simulator', 'lab', 'optimize', 'method', 'analyses'];
let view = 'simulator', mathDone = false;
function route() {
  let v = (location.hash || '').slice(1); if (!VIEWS.includes(v)) v = 'simulator';
  const changed = v !== view; view = v;
  VIEWS.forEach(x => $('v-' + x).classList.toggle('on', x === v));
  document.querySelectorAll('#tabs a').forEach(a => a.classList.toggle('on', a.dataset.v === v));
  if (v === 'method') renderMath();
  if (changed) window.scrollTo(0, 0);
  requestAnimationFrame(refreshStatic);
}
function renderMath() {
  if (mathDone) return;
  if (window.renderMathInElement) { window.renderMathInElement($('v-method'), { delimiters: [{ left: '\\[', right: '\\]', display: true }, { left: '\\(', right: '\\)', display: false }], throwOnError: false }); mathDone = true; }
}
window.addEventListener('load', () => { if (view === 'method') renderMath(); });
window.addEventListener('hashchange', route);
document.addEventListener('click', e => {
  const a = e.target.closest('[data-ref]');
  if (a) { e.preventDefault(); const el = $('ref-' + a.dataset.ref); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.style.background = rgba(C.accent, .15); setTimeout(() => el.style.background = '', 1600); } return; }
  const j = e.target.closest('[data-jump]');
  if (j) { e.preventDefault(); const el = $(j.dataset.jump); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
});

// ---------- Arka plan görev yürütücüsü (Worker, yoksa sayfa içi) ----------
class Runner {
  constructor() { this.w = null; this.cancelled = false; }
  run(task, cfg, onProg) {
    this.cancelled = false;
    return new Promise((resolve, reject) => {
      const inline = () => {
        const c = JSON.parse(JSON.stringify(cfg)); if (c.ctx && c.ctx.Q) c.ctx.Q = Float64Array.from(c.ctx.Q);
        const gen = { lab: B.taskLab, sens: B.taskSens, ga: B.taskGA, q: B.taskQ }[task](c);
        const slice = () => {
          if (this.cancelled) return reject(new Error('iptal'));
          const t0 = performance.now();
          try {
            while (performance.now() - t0 < 25) { const r = gen.next(); if (r.done) return resolve(r.value); onProg(r.value); }
          } catch (err) { return reject(err); }
          setTimeout(slice, 0);
        };
        slice();
      };
      let got = false;
      try { this.w = new Worker('js/worker.js'); } catch (e) { this.w = null; }
      if (!this.w) return inline();
      this.w.onmessage = e => { got = true; const m = e.data;
        if (m.progress) onProg(m.progress);
        else if (m.done) { this.terminate(); resolve(m.result); }
        else if (m.error) { this.terminate(); reject(new Error(m.error)); } };
      this.w.onerror = ev => { ev.preventDefault && ev.preventDefault(); this.terminate(); if (!got && !this.cancelled) inline(); else reject(new Error('Worker hatası')); };
      this._reject = reject;
      this.w.postMessage({ id: 1, task, cfg });
    });
  }
  terminate() { if (this.w) { this.w.terminate(); this.w = null; } }
  cancel() { this.cancelled = true; this.terminate(); if (this._reject) this._reject(new Error('iptal')); }
}

// =====================================================================
// SİMÜLATÖR
// =====================================================================
const DT = 0.1;
const live = { sc: { id: 'dengeli', name: '', rates: SC.dengeli.rates.slice(), profile: 'sabit' }, left: 'fuzzy', right: 'fixed', simL: null, simR: null, hist: null, running: true, speed: 4, acc: 0, lastTs: 0, lastRec: 0, seed: 42 };

function fillCtlSelect(sel, val) {
  sel.innerHTML = B.CONTROLLERS.map(c => `<option value="${c.id}"${trained(c.id) ? '' : ' disabled'}>${c.name}${trained(c.id) ? '' : ' (önce eğitin)'}</option>`).join('');
  if (!trained(val)) val = 'fuzzy'; sel.value = val; return val;
}
function initSimUI() {
  $('scSel').innerHTML = B.SCENARIOS.map(s => `<option value="${s.id}">${s.name}</option>`).join('') + '<option value="ozel" hidden>Özel</option>';
  $('profSel').innerHTML = Object.entries(B.PROFILES).map(([k, p]) => `<option value="${k}">${p.name}</option>`).join('');
  live.left = fillCtlSelect($('ctlL'), live.left); live.right = fillCtlSelect($('ctlR'), live.right);
  const defs = [
    { label: 'Kuzey (araç/dk)', min: 0, max: 25, get: () => live.sc.rates[0], set: v => { live.sc.rates[0] = v; markCustom(); } },
    { label: 'Güney (araç/dk)', min: 0, max: 25, get: () => live.sc.rates[1], set: v => { live.sc.rates[1] = v; markCustom(); } },
    { label: 'Sabit yeşil süresi', min: 8, max: 60, unit: ' s', get: () => S.fixedG, set: v => { S.fixedG = v; for (const [sim, ty] of [[live.simL, live.left], [live.simR, live.right]]) if (ty === 'fixed') sim.ctrl.G = [v, v]; } },
    { label: 'Batı (araç/dk)', min: 0, max: 25, get: () => live.sc.rates[2], set: v => { live.sc.rates[2] = v; markCustom(); } },
    { label: 'Doğu (araç/dk)', min: 0, max: 25, get: () => live.sc.rates[3], set: v => { live.sc.rates[3] = v; markCustom(); } },
    { label: 'Maksimum yeşil', min: 20, max: 90, unit: ' s', get: () => S.maxG, set: v => { S.maxG = v; for (const sim of [live.simL, live.simR]) if ('maxG' in sim.ctrl) sim.ctrl.maxG = v; } }
  ];
  const box = $('sliders');
  for (const d of defs) {
    const w = document.createElement('label'); w.className = 'sl';
    w.innerHTML = `<span>${d.label}</span><input type="range" min="${d.min}" max="${d.max}" step="1"><output></output>`;
    box.appendChild(w);
    const inp = w.querySelector('input'), out = w.querySelector('output');
    d.sync = () => { inp.value = d.get(); out.textContent = d.get() + (d.unit || ''); };
    inp.addEventListener('input', () => { d.set(+inp.value); out.textContent = inp.value + (d.unit || ''); });
    d.sync();
  }
  live.syncSliders = () => defs.forEach(d => d.sync());
  $('scSel').addEventListener('change', e => { const s = SC[e.target.value]; if (!s) return; live.sc = { id: s.id, name: s.name, rates: s.rates.slice(), profile: s.profile }; $('profSel').value = s.profile; live.syncSliders(); liveReset(true); });
  $('profSel').addEventListener('change', e => { live.sc.profile = e.target.value; markCustom(); liveReset(true); });
  $('ctlL').addEventListener('change', e => { live.left = e.target.value; liveReset(false); });
  $('ctlR').addEventListener('change', e => { live.right = e.target.value; liveReset(false); });
  $('play').addEventListener('click', () => { live.running = !live.running; $('play').textContent = live.running ? 'Duraklat' : 'Devam et'; });
  $('reset').addEventListener('click', () => liveReset(true));
  $('speed').addEventListener('change', e => live.speed = +e.target.value);
  $('rulesReset').addEventListener('click', () => { const P = fuzzyTarget().P; Object.assign(P, B.cloneP(P === S.P_ga && S.gaInfo && S.gaInfo.best ? S.gaInfo.best : B.DEFAULT_P)); if (P === S.P_ga) save(); });
  // kural tablosu
  const rt = $('rules');
  rt.innerHTML = `<thead><tr><th class="rh">Yeşil ↓ · Kırmızı →</th>${B.SETS_IN.map(s => `<th>${s}</th>`).join('')}</tr></thead><tbody>${
    B.SETS_IN.map((s, a) => `<tr><th class="rh">${s}</th>${[0, 1, 2].map(b => `<td><button data-k="${a * 3 + b}"><span class="lab"></span><span class="w"></span></button></td>`).join('')}</tr>`).join('')}</tbody>`;
  live.ruleBtns = [...rt.querySelectorAll('button')];
  live.ruleBtns.forEach(bt => bt.addEventListener('click', () => { const P = fuzzyTarget().P; const k = +bt.dataset.k; P.rules[k] = (P.rules[k] + 1) % 4; if (P === S.P_ga) save(); }));
  const mkStats = el => { el.innerHTML = ['Ort. gecikme', 'Geçen araç', 'Kuyrukta', 'Duruş / araç'].map(k => `<div class="tile"><div class="k">${k}</div><div class="v">–</div></div>`).join(''); return [...el.querySelectorAll('.v')]; };
  live.stL = mkStats($('stL')); live.stR = mkStats($('stR'));
}
function markCustom() { $('scSel').value = 'ozel'; live.sc.id = 'ozel'; }
function liveReset(newSeed) {
  if (newSeed) live.seed = (Math.random() * 1e9) | 0;
  const d = B.makeDemand(live.sc), c = Object.assign(ctx(), { scenario: live.sc, scale: 1 });
  live.simL = new B.Sim(live.seed, d, B.buildController(live.left, c));
  live.simR = new B.Sim(live.seed, d, B.buildController(live.right, c));
  live.hist = { t: [], l: [], r: [] }; live.lastRec = -2; recordLive();
  const sc = SC[live.sc.id];
  $('scDesc').textContent = sc ? sc.desc : 'Özel senaryo: talepler kaydırıcılarla belirlendi. Webster planı sıfırlamada yeniden hesaplanır.';
  for (const [side, ty] of [['L', live.left], ['R', live.right]]) {
    $('nm' + side).textContent = CT[ty].name; $('hd' + side).style.background = C.ct[ty]; $('dot' + side).style.background = C.ct[ty];
  }
  $('qLegend').innerHTML = `<span><i style="background:${C.ct[live.left]}"></i>Sol · ${CT[live.left].short}</span><span><i style="background:${C.ct[live.right]}"></i>Sağ · ${CT[live.right].short}</span>`;
}
function recordLive() { const h = live.hist; h.t.push(live.simL.t); h.l.push(live.simL.queued()); h.r.push(live.simR.queued()); if (h.t.length > 301) { h.t.shift(); h.l.shift(); h.r.shift(); } live.lastRec = live.simL.t; }
function fuzzyTarget() {
  const isF = t => t === 'fuzzy' || t === 'fuzzyga';
  if (isF(live.left)) return { sim: live.simL, P: live.simL.ctrl.P, side: 'sol', type: live.left };
  if (isF(live.right)) return { sim: live.simR, P: live.simR.ctrl.P, side: 'sağ', type: live.right };
  return { sim: live.simL, P: S.P_fuzzy, side: null, type: 'fuzzy' };
}
function phaseHTML(sim) {
  const st = sim.state === 'green' ? 'yeşil' : sim.state === 'yellow' ? 'sarı' : 'tüm yönler kırmızı';
  const col = sim.state === 'green' ? C.go : sim.state === 'yellow' ? C.amber : C.red;
  return `<span class="lamp" style="background:${col}"></span>${B.PHASE_NAMES[sim.phase]} ${st} · ${fmt(sim.stateT, 0)} s`;
}
function decisionHTML(sim, type) {
  const c = sim.ctrl;
  if (type === 'fixed') return `Sabit plan: her faz <b>${c.G[0]} s</b> yeşil + ${K.YELLOW} s sarı + ${K.ALLRED} s tüm kırmızı. Döngü ${2 * (c.G[0] + K.YELLOW + K.ALLRED)} s.`;
  if (type === 'webster') { const w = B.webster(live.sc); return `Webster planı: K–G <b>${fmt(c.G[0], 0)} s</b>, B–D <b>${fmt(c.G[1], 0)} s</b> yeşil. Döngü ${fmt(c.G[0] + c.G[1] + 2 * (K.YELLOW + K.ALLRED), 0)} s (Y = ${fmt(w.Y, 2)}).`; }
  const L = c.last; if (!L) return 'İlk karar en kısa yeşil süresi (7 s) dolduktan sonra verilir.';
  const q = L.qG != null ? `yeşil yönde <b>${L.qG}</b>, kırmızı yönde <b>${L.qR}</b> araç → ` : '';
  return `Son karar (${mmss(L.t)}): ${q}<b>${L.act}</b>`;
}
function fillStats(t, sim) {
  const d = sim.avgDelay();
  t[0].innerHTML = `${fmt(d)} <small>s</small> ${sim.t > 60 ? losBadge(d) : ''}`;
  t[1].textContent = sim.crossed; t[2].textContent = sim.queued(); t[3].textContent = sim.crossed ? fmt(sim.sumStops / sim.crossed, 2) : '–';
}
function renderSim() {
  const L = live.simL, R = live.simR;
  drawInter($('cvL'), L, C.ct[live.left]); drawInter($('cvR'), R, C.ct[live.right]);
  $('phL').innerHTML = phaseHTML(L); $('phR').innerHTML = phaseHTML(R);
  fillStats(live.stL, L); fillStats(live.stR, R);
  $('decL').innerHTML = decisionHTML(L, live.left); $('decR').innerHTML = decisionHTML(R, live.right);
  $('clock').textContent = mmss(L.t);
  const dl = L.avgDelay(), dr = R.avgDelay();
  if (L.t < 90 || (dl <= 0 && dr <= 0)) $('verdict').innerHTML = 'Simülasyon ısınıyor… Karşılaştırma 1,5 dakika sonra görünür.';
  else if (live.left === live.right) $('verdict').innerHTML = 'İki kavşakta aynı denetleyici çalışıyor. Karşılaştırma için farklı denetleyiciler seçin.';
  else {
    const better = dl <= dr ? 'L' : 'R', bt = better === 'L' ? live.left : live.right, wt = better === 'L' ? live.right : live.left;
    const pct = Math.abs(dr - dl) / Math.max(dl, dr) * 100;
    $('verdict').innerHTML = `Bu akışta <b style="color:${C.ct[bt]}">${CT[bt].name}</b>, ${CT[wt].name} denetleyicisine göre araç başına ortalama gecikmeyi <b>%${fmt(pct, 0)}</b> daha düşük tutuyor (${fmt(Math.min(dl, dr))} s / ${fmt(Math.max(dl, dr))} s). Tek bir koşu istatistiksel kanıt değildir. Anlamlılık için Deney Laboratuvarı'nı kullanın.`;
  }
  // bulanık panel
  const F = fuzzyTarget(), sim = F.sim, qG = sim.phaseCount(sim.phase), qR = sim.phaseCount(1 - sim.phase), r = B.infer(F.P, qG, qR, true);
  $('fzSrc').textContent = F.side ? `${F.side} kavşaktaki ${CT[F.type].name} denetleyicisi izleniyor` : 'İki kavşakta da bulanık denetleyici yok; girdiler sol kavşaktan alınıyor';
  $('vG').textContent = `= ${qG} (${B.PHASE_NAMES[sim.phase]})`; $('vR').textContent = `= ${qR} (${B.PHASE_NAMES[1 - sim.phase]})`; $('vO').textContent = `= ${fmt(r.out)} s`;
  drawMF($('mfG'), F.P.g, B.SETS_IN, B.IN_MAX, Math.min(qG, B.IN_MAX), r.muG);
  drawMF($('mfR'), F.P.r, B.SETS_IN, B.IN_MAX, Math.min(qR, B.IN_MAX), r.muR);
  drawMF($('mfO'), F.P.o, B.SETS_OUT, B.OUT_MAX, null, [], r.agg, r.out);
  live.ruleBtns.forEach((bt, k) => { const f = r.fire[k]; bt.querySelector('.lab').textContent = B.SETS_OUT[F.P.rules[k]]; const w = bt.querySelector('.w'); w.textContent = 'μ = ' + fmt(f, 2);
    bt.style.background = rgba(C.accent, 0.06 + 0.6 * f); bt.style.borderColor = f > 0 ? C.accent : C.line; bt.style.color = f > 0.55 ? C.panel : C.ink; w.style.color = f > 0.55 ? C.panel : C.muted; });
  const h = live.hist, t1 = Math.max(600, h.t[h.t.length - 1] || 0), t0 = t1 - 600, ticks = []; for (let v = Math.ceil(t0 / 120) * 120; v <= t1; v += 120) ticks.push(v);
  drawLines($('cvQ'), [{ xs: h.t, ys: h.r, color: C.ct[live.right] }, { xs: h.t, ys: h.l, color: C.ct[live.left] }], { xMin: t0, xMax: t1, xTicks: ticks, xFmt: mmss, yMax: 5 });
}
function frame(ts) {
  const rdt = live.lastTs ? Math.min(0.1, (ts - live.lastTs) / 1000) : 0; live.lastTs = ts;
  if (view === 'simulator') {
    if (live.running) { live.acc += rdt * live.speed; let n = 0;
      while (live.acc >= DT && n < 600) { live.simL.step(DT); live.simR.step(DT); live.acc -= DT; n++; if (live.simL.t - live.lastRec >= 2 - 1e-9) recordLive(); } }
    renderSim();
  }
  requestAnimationFrame(frame);
}

// =====================================================================
// DENEY LABORATUVARI
// =====================================================================
const labRunner = new Runner(), senRunner = new Runner();
let labData = null, senData = null;
const METRICS = { delay: { name: 'Ortalama gecikme', unit: 's/araç', better: -1, d: 1 }, p95: { name: '95. persentil gecikme', unit: 's', better: -1, d: 1 }, stops: { name: 'Duruş / araç', unit: '', better: -1, d: 2 },
  thru: { name: 'Geçen araç', unit: 'ta/sa', better: 1, d: 0 }, maxQ: { name: 'En büyük kuyruk', unit: 'araç', better: -1, d: 0 }, meanQ: { name: 'Ortalama kuyruk', unit: 'araç', better: -1, d: 1 } };

function initLabUI() {
  $('labSc').innerHTML = B.SCENARIOS.map(s => `<label class="check" title="${s.desc}"><input type="checkbox" value="${s.id}" checked> ${s.name}</label>`).join('');
  renderLabControllers();
  document.querySelectorAll('[data-all]').forEach(bt => bt.addEventListener('click', () => { const boxes = [...$(bt.dataset.all).querySelectorAll('input:not(:disabled)')]; const all = boxes.every(b => b.checked); boxes.forEach(b => b.checked = !all); }));
  $('senSc').innerHTML = B.SCENARIOS.map(s => `<option value="${s.id}"${s.id === 'dengeli' ? ' selected' : ''}>${s.name}</option>`).join('');
  $('labRun').addEventListener('click', runLab);
  $('labStop').addEventListener('click', () => labRunner.cancel());
  $('labMetric').addEventListener('change', renderLab); $('labLog').addEventListener('change', () => { renderLab(); renderSens(); });
  $('labRef').addEventListener('change', renderLab);
  $('csvDl').addEventListener('click', () => csvOut(true)); $('csvCp').addEventListener('click', () => csvOut(false));
  $('senRun').addEventListener('click', runSens);
}
function renderLabControllers() {
  const prev = new Set([...$('labCt').querySelectorAll('input:checked')].map(i => i.value));
  const wasOff = new Set([...$('labCt').querySelectorAll('input:disabled')].map(i => i.value));
  const first = !$('labCt').children.length;
  $('labCt').innerHTML = B.CONTROLLERS.map(c => { const ok = trained(c.id), on = ok && (first || prev.has(c.id) || wasOff.has(c.id) || !prev.size);
    return `<label class="check"><input type="checkbox" value="${c.id}"${on ? ' checked' : ''}${ok ? '' : ' disabled'}><span class="dot" style="background:${C.ct[c.id]}"></span>${c.name}${ok ? '' : ' <span class="chip">eğitilmedi</span>'}</label>`; }).join('');
  const missing = B.CONTROLLERS.filter(c => !trained(c.id)).map(c => c.name);
  $('labCtNote').textContent = missing.length ? `${missing.join(' ve ')} denetleyicisini kullanmak için önce Optimizasyon sekmesinden eğitim yapın.` : 'Tüm denetleyiciler kullanılabilir.';
  const ref = $('labRef').value;
  $('labRef').innerHTML = B.CONTROLLERS.filter(c => trained(c.id)).map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  $('labRef').value = (wasOff.has('fuzzyga') && S.P_ga) ? 'fuzzyga' : ref && trained(ref) ? ref : (S.P_ga ? 'fuzzyga' : 'fuzzy');
}
const checked = id => [...$(id).querySelectorAll('input:checked')].map(i => i.value);
async function runLab() {
  const scenarios = checked('labSc'), controllers = checked('labCt');
  if (!scenarios.length || controllers.length < 2) { $('labStatus').textContent = 'En az 1 senaryo ve 2 denetleyici seçin.'; return; }
  const cfg = { scenarios, controllers, reps: +$('labReps').value, dur: +$('labDur').value, warm: +$('labWarm').value, ctx: ctxPlain(), dt: DT };
  $('labRun').disabled = true; $('labStop').disabled = false; const t0 = performance.now();
  try {
    const res = await labRunner.run('lab', cfg, p => { $('labBar').style.width = (p.progress * 100).toFixed(1) + '%'; $('labStatus').textContent = p.msg; });
    labData = { res, cfg, at: new Date() };
    const runs = scenarios.length * controllers.length * cfg.reps;
    $('labStatus').textContent = `Tamamlandı · ${runs} simülasyon (${fmt(runs * cfg.dur / 3600, 0)} saat trafik) · ${fmt((performance.now() - t0) / 1000)} s`;
    if (!controllers.includes($('labRef').value)) $('labRef').value = controllers.includes('fuzzyga') ? 'fuzzyga' : controllers.includes('fuzzy') ? 'fuzzy' : controllers[0];
    renderLab(); renderFindings();
  } catch (e) { $('labStatus').textContent = e.message === 'iptal' ? 'Durduruldu' : 'Hata: ' + e.message; }
  $('labRun').disabled = false; $('labStop').disabled = true;
}
function summarize(runs, m) { const a = runs.map(r => r[m]); return { mean: B.mean(a), ci: B.ci95(a), arr: a }; }
function renderLab() {
  if (!labData) return;
  $('labEmpty').style.display = 'none'; $('labBody').style.display = '';
  const { res, cfg } = labData, m = $('labMetric').value, M = METRICS[m], ref = $('labRef').value;
  const scs = cfg.scenarios, cts = cfg.controllers;
  const T = {}; for (const s of scs) { T[s] = {}; for (const c of cts) T[s][c] = summarize(res[s][c], m); }
  // KPI
  const refIn = cts.includes(ref);
  const bestOf = s => cts.reduce((b, c) => (M.better < 0 ? T[s][c].mean < T[s][b].mean : T[s][c].mean > T[s][b].mean) ? c : b, cts[0]);
  const wins = refIn ? scs.filter(s => bestOf(s) === ref).length : 0;
  const imp = other => { if (!refIn || !cts.includes(other) || other === ref) return null; const v = scs.map(s => (T[s][other].mean - T[s][ref].mean) / T[s][other].mean * 100 * (M.better < 0 ? 1 : -1)); return B.mean(v); };
  const iw = imp('webster'), ia = imp('actuated'), ifx = imp('fixed');
  const kpi = (k, v, d) => `<div class="kpi"><div class="k">${k}</div><div class="v">${v}</div><div class="d">${d}</div></div>`;
  $('labKpis').innerHTML =
    kpi('Referansın en iyi olduğu senaryo', refIn ? `${wins} / ${scs.length}` : '–', `${CT[ref].name} · ${M.name.toLowerCase()}`) +
    kpi('Webster\'e göre ortalama iyileşme', sgn(iw), 'Senaryo ortalaması · + referans daha iyi') +
    kpi('Araç tetiklemeliye göre', sgn(ia), 'Senaryo ortalaması · + referans daha iyi') +
    kpi('Sabit süreliye göre', sgn(ifx), `Sabit yeşil = ${cfg.ctx.fixedG} s · + referans daha iyi`);
  $('labLegend').innerHTML = cts.map(c => `<span><i class="sq" style="background:${C.ct[c]}"></i>${CT[c].name}</span>`).join('');
  drawBars($('cvLab'), scs.map(s => SC_SHORT[s]), cts.map(c => ({ color: C.ct[c], vals: scs.map(s => T[s][c].mean), errs: scs.map(s => T[s][c].ci) })), { log: $('labLog').checked, yLabel: `${M.name}${M.unit ? ' (' + M.unit + ')' : ''}` });
  // Tablo
  let h = `<tr><th>Senaryo</th>${cts.map(c => `<th><span class="dot" style="display:inline-block;background:${C.ct[c]};margin-right:6px;vertical-align:middle"></span>${CT[c].short}</th>`).join('')}</tr>`;
  for (const s of scs) { const b = bestOf(s);
    h += `<tr><td>${SC[s].name}</td>${cts.map(c => { const v = T[s][c]; return `<td class="${c === b ? 'best' : ''}">${fmt(v.mean, M.d)} <span class="ci">± ${fmt(v.ci, M.d)}</span>${m === 'delay' ? losBadge(v.mean) : ''}</td>`; }).join('')}</tr>`; }
  $('labTable').innerHTML = h;
  // Anlamlılık
  if (!refIn) { $('sigTable').innerHTML = ''; $('sigNote').textContent = 'Referans denetleyici bu deneyde yer almıyor.'; return; }
  const rows = [];
  for (const s of scs) for (const c of cts) if (c !== ref) { const pt = B.pairedT(T[s][ref].arr, T[s][c].arr); rows.push({ s, c, pt, d: T[s][c].mean - T[s][ref].mean, pct: (T[s][c].mean - T[s][ref].mean) / T[s][c].mean * 100 }); }
  const adj = B.holm(rows.map(r => r.pt.p)); rows.forEach((r, i) => r.ph = adj[i]);
  $('sigNote').innerHTML = `Referans: <b>${CT[ref].name}</b>. Her satırda, referans ile karşılaştırılan denetleyici aynı ${cfg.reps} tohum üzerinde eşleştirilmiş t-testiyle sınanır. p<sub>Holm</sub>, ${rows.length} karşılaştırmanın tamamı için Holm–Bonferroni düzeltmesidir (α = 0,05). Δ = karşılaştırılan − referans.`;
  let g = `<tr><th>Senaryo</th><th>Karşılaştırılan</th><th>Δ ortalama</th><th>Referans farkı</th><th>t</th><th>p</th><th>p<sub>Holm</sub></th><th>Sonuç</th></tr>`;
  for (const r of rows) {
    const refBetter = M.better < 0 ? r.d > 0 : r.d < 0, sig = r.ph < 0.05;
    const res_ = !sig ? '<span class="ns">Fark anlamlı değil</span>' : refBetter ? '<span class="pos">Referans daha iyi</span>' : '<span class="neg">Referans daha kötü</span>';
    g += `<tr><td>${SC[r.s].name}</td><td>${CT[r.c].name}</td><td>${r.d > 0 ? '+' : ''}${fmt(r.d, M.d)}</td><td>${refBetter ? '%' + fmt(Math.abs(r.pct), 1) + ' daha iyi' : '%' + fmt(Math.abs(r.pct), 1) + ' daha kötü'}</td><td>${Number.isFinite(r.pt.t) ? fmt(r.pt.t, 2) : '∞'}</td><td>${pfmt(r.pt.p)}</td><td>${pfmt(r.ph)}</td><td>${res_}</td></tr>`;
  }
  $('sigTable').innerHTML = g;
}
const sgn = v => v == null ? '–' : `<span class="${v >= 0 ? 'pos' : 'neg'}">${v >= 0 ? '+' : '−'}%${fmt(Math.abs(v), 1)}</span>`;
const pfmt = p => p < 0.001 ? '< 0,001' : fmt(p, 3);
function csvOut(download) {
  if (!labData) return;
  const { res, cfg } = labData, keys = ['delay', 'p95', 'stops', 'thru', 'maxQ', 'meanQ', 'unserved', 'cycle'];
  let s = 'senaryo,denetleyici,tekrar,tohum,' + keys.join(',') + '\n';
  for (const sc of cfg.scenarios) for (const c of cfg.controllers) res[sc][c].forEach((r, i) => { s += [sc, c, i + 1, 1000 + i * 17, ...keys.map(k => (+r[k]).toFixed(4))].join(',') + '\n'; });
  if (download) {
    try { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([s], { type: 'text/csv' })); a.download = 'bulanik-trafik-deney.csv'; document.body.appendChild(a); a.click(); a.remove(); $('labStatus').textContent = 'CSV indirildi'; }
    catch (e) { csvOut(false); }
  } else {
    navigator.clipboard.writeText(s).then(() => $('labStatus').textContent = 'CSV panoya kopyalandı', () => $('labStatus').textContent = 'Panoya kopyalanamadı');
  }
}
async function runSens() {
  const controllers = checked('labCt'); if (controllers.length < 1) { $('senStatus').textContent = 'Yukarıdan en az bir denetleyici seçin.'; return; }
  const cfg = { scenario: $('senSc').value, controllers, factors: [0.3, 0.5, 0.7, 0.9, 1.1, 1.3, 1.5, 1.7], reps: +$('senReps').value, dur: 1200, warm: 240, ctx: ctxPlain(), dt: DT };
  $('senRun').disabled = true;
  try { const res = await senRunner.run('sens', cfg, p => { $('senBar').style.width = (p.progress * 100).toFixed(1) + '%'; $('senStatus').textContent = p.msg; });
    senData = { res, cfg }; $('senStatus').textContent = 'Tamamlandı'; renderSens(); renderFindings();
  } catch (e) { $('senStatus').textContent = 'Hata: ' + e.message; }
  $('senRun').disabled = false;
}
function placeholder(cv, text) { const { ctx, W, H } = prep(cv); ctx.fillStyle = C.muted; ctx.font = `13px ${SANS}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, W / 2, H / 2); }
function renderSens() {
  if (!senData) return placeholder($('cvSen'), 'Analizi çalıştırdığınızda gecikme–talep eğrileri burada görünür.');
  const { res, cfg } = senData, cts = cfg.controllers;
  $('senLegend').innerHTML = cts.map(c => `<span><i style="background:${C.ct[c]}"></i>${CT[c].name}</span>`).join('');
  drawLines($('cvSen'), cts.map(c => ({ xs: res[c].map(p => p.f), ys: res[c].map(p => p.mean), lo: res[c].map(p => p.mean - p.ci), hi: res[c].map(p => p.mean + p.ci), color: C.ct[c], dots: true })),
    { xMin: 0.3, xMax: 1.7, xTicks: cfg.factors, xFmt: v => '×' + fmt(v, 1), log: true, yLabel: 'Ortalama gecikme (s/araç)', refs: [{ y: 55, color: C.ct.fixed, label: 'LOS E sınırı (55 s)' }] });
  const cross = c => { const p = res[c].find(x => x.mean > 55); return p ? '×' + fmt(p.f, 1) : '×1,7\'ye kadar aşmadı'; };
  $('senNote').innerHTML = `${SC[cfg.scenario].name} senaryosunun talep oranları sabit tutularak ölçeklendi. Gölgeli bantlar %95 güven aralığıdır. Gecikmenin 55 s'yi (LOS E) ilk aştığı talep düzeyi: ` + cts.map(c => `<b>${CT[c].short}</b> ${cross(c)}`).join(' · ') + '.';
}
function renderFindings() {
  if (!labData) return;
  const { res, cfg } = labData, ref = cfg.controllers.includes('fuzzyga') ? 'fuzzyga' : cfg.controllers.includes('fuzzy') ? 'fuzzy' : cfg.controllers[0];
  const cts = cfg.controllers, scs = cfg.scenarios, items = [];
  const T = {}; for (const s of scs) { T[s] = {}; for (const c of cts) T[s][c] = summarize(res[s][c], 'delay'); }
  const rows = []; for (const s of scs) for (const c of cts) if (c !== ref) rows.push({ s, c, pt: B.pairedT(T[s][ref].arr, T[s][c].arr) });
  const adj = B.holm(rows.map(r => r.pt.p)); rows.forEach((r, i) => r.ph = adj[i]);
  const tally = c => { const r = rows.filter(x => x.c === c); return { better: r.filter(x => x.ph < 0.05 && x.pt.md > 0).length, worse: r.filter(x => x.ph < 0.05 && x.pt.md < 0).length, ns: r.filter(x => x.ph >= 0.05).length, n: r.length }; };
  items.push(`Deney: ${scs.length} senaryo × ${cts.length} denetleyici × ${cfg.reps} tekrar, ${cfg.dur / 60} dk (${cfg.warm / 60} dk ısınma). Referans: <b>${CT[ref].name}</b>.`);
  for (const c of cts) if (c !== ref) { const t = tally(c); items.push(`<b>${CT[ref].short}</b> ile <b>${CT[c].name}</b> karşılaştırması: ${t.better} senaryoda anlamlı olarak daha düşük gecikme, ${t.worse} senaryoda anlamlı olarak daha yüksek, ${t.ns} senaryoda anlamlı fark yok (Holm, α = 0,05).`); }
  for (const s of scs) { const best = cts.reduce((b, c) => T[s][c].mean < T[s][b].mean ? c : b, cts[0]); items.push(`${SC[s].name}: en düşük gecikme <b>${CT[best].name}</b> (${fmt(T[s][best].mean)} s, LOS ${B.los(T[s][best].mean)}). Referans: ${fmt(T[s][ref].mean)} s, LOS ${B.los(T[s][ref].mean)}.`); }
  if (senData) { const sc = senData.res; const c55 = c => { const p = sc[c].find(x => x.mean > 55); return p ? '×' + fmt(p.f, 1) : '> ×1,7'; }; items.push('Talep duyarlılığı (' + SC[senData.cfg.scenario].name + '): gecikmenin 55 s\'yi aştığı talep düzeyi ' + senData.cfg.controllers.map(c => `${CT[c].short} ${c55(c)}`).join(', ') + '.'); }
  $('findBody').className = ''; $('findBody').innerHTML = `<ul style="margin:0;padding-left:20px">${items.map(i => `<li style="margin:4px 0">${i}</li>`).join('')}</ul><p class="hint">Bu özet otomatik üretilmiştir. Yorumlarken geçerlilik tehditlerini dikkate alın.</p>`;
}

// =====================================================================
// OPTİMİZASYON
// =====================================================================
const gaRunner = new Runner(), qRunner = new Runner();
let gaLast = null, qLast = null;
const scOpts = () => `<option value="mix">Karma: Dengeli, Ana yol, Kayan talep, Ani artış</option>` + B.SCENARIOS.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
const scList = v => v === 'mix' ? MIX : [v];
const scLabel = list => list.length > 1 ? 'karma senaryo' : SC[list[0]].name;
const MODE = { both: 'üyelik + kurallar', mf: 'yalnız üyelik', rules: 'yalnız kurallar' };
function initOptUI() {
  $('gaSc').innerHTML = scOpts(); $('qSc').innerHTML = scOpts();
  $('gaRun').addEventListener('click', runGA); $('gaStop').addEventListener('click', () => gaRunner.cancel());
  $('qRun').addEventListener('click', runQ); $('qStop').addEventListener('click', () => qRunner.cancel());
  $('gaApply').addEventListener('click', () => { if (!gaLast) return; S.P_ga = B.cloneP(gaLast.best); S.gaInfo = { scenarios: gaLast.scenarios, mode: gaLast.mode, test: gaLast.table.find(r => r.id === 'fuzzyga').test, best: B.cloneP(gaLast.best) }; save(); afterTrain(); $('gaStatus').textContent = 'Çözüm uygulandı: "Bulanık + GA" artık her yerde kullanılabilir.'; });
  $('gaClear').addEventListener('click', () => { S.P_ga = null; S.gaInfo = null; save(); if (live.left === 'fuzzyga') live.left = 'fuzzy'; if (live.right === 'fuzzyga') live.right = 'fixed'; afterTrain(); });
  $('qTb').addEventListener('input', renderPolicy);
  renderOptState();
}
function afterTrain() { live.left = fillCtlSelect($('ctlL'), live.left); live.right = fillCtlSelect($('ctlR'), live.right); renderLabControllers(); renderOptState(); liveReset(false); }
function renderOptState() {
  $('gaState').textContent = S.gaInfo ? `Kayıtlı çözüm: ${scLabel(S.gaInfo.scenarios)}, ${MODE[S.gaInfo.mode]}, test gecikmesi ${fmt(S.gaInfo.test)} s` : 'Kayıtlı GA çözümü yok';
  $('qState').textContent = S.qInfo ? `Kayıtlı ajan: ${scLabel(S.qInfo.scenarios)}, ${S.qInfo.episodes} bölüm, test gecikmesi ${fmt(S.qInfo.test)} s` : 'Kayıtlı ajan yok';
  renderPolicy();
}
function resTable(rows, cols) {
  const bestTest = Math.min(...rows.map(r => r.test));
  return `<table class="data"><tr><th>Denetleyici</th>${cols.includes('train') ? '<th>Eğitim (s)</th>' : ''}<th>Test (s)</th><th>LOS</th></tr>` +
    rows.map(r => `<tr><td><span class="dot" style="display:inline-block;background:${C.ct[r.id]};margin-right:6px"></span>${CT[r.id].name}</td>${cols.includes('train') ? `<td>${fmt(r.train)}</td>` : ''}<td class="${r.test === bestTest ? 'best' : ''}">${fmt(r.test)}</td><td>${losBadge(r.test)}</td></tr>`).join('') + '</table>';
}
async function runGA() {
  const scenarios = scList($('gaSc').value), mode = $('gaMode').value, pop = +$('gaPop').value, gens = +$('gaGen').value;
  const cfg = { scenarios, mode, pop, gens, ctx: ctxPlain(), dt: DT, dur: 900, warm: 120, seed: (Math.random() * 1e9) | 0 };
  $('gaRun').disabled = true; $('gaStop').disabled = false; $('gaLearned').style.display = 'none';
  let hist = [];
  const draw = (refs) => { const st = gens > 20 ? 5 : gens > 8 ? 2 : 1, ticks = []; for (let g = 0; g <= gens; g += st) ticks.push(g);
    drawLines($('cvGA'), [{ xs: hist.map((_, i) => i), ys: hist.map(h => h.mean), color: C.muted, w: 1.5 }, { xs: hist.map((_, i) => i), ys: hist.map(h => h.best), color: C.ct.fuzzyga, w: 2.2, dots: true }],
      { xMin: 0, xMax: gens, xTicks: ticks, xFmt: String, refs: refs || [], yLabel: 'Gecikme (s/araç)' }); };
  draw();
  try {
    const t0 = performance.now();
    const r = await gaRunner.run('ga', cfg, p => { $('gaBar').style.width = (p.progress * 100).toFixed(1) + '%'; $('gaStatus').textContent = p.msg; if (p.hist) { hist = p.hist; draw(); } });
    gaLast = r; hist = r.hist;
    const act = r.table.find(x => x.id === 'actuated');
    draw([{ y: act.train, color: C.ct.actuated, label: 'Araç tetiklemeli' }]);
    const ga = r.table.find(x => x.id === 'fuzzyga'), base = r.table.filter(x => x.id !== 'fuzzyga'), bestBase = base.reduce((a, b) => a.test < b.test ? a : b);
    const gen = (ga.train - ga.test) / ga.train * 100;
    $('gaRes').innerHTML = `<div class="fz-title"><b>Eğitim ve test sonuçları</b> · ${scLabel(scenarios)}, ${MODE[mode]}</div>` + resTable(r.table, ['train']) +
      `<p class="hint">Test sütunu, eğitimde kullanılmayan 5 rastgele akışın ortalamasıdır. GA çözümü testte en iyi referans yönteme (${CT[bestBase.id].name}) göre <b>%${fmt((bestBase.test - ga.test) / bestBase.test * 100, 1)}</b> ${ga.test <= bestBase.test ? 'daha düşük' : 'daha yüksek'} gecikme verdi. Eğitim ile test arasındaki fark %${fmt(Math.abs(gen), 1)} ${gen < 0 ? '(testte daha kötü: olası aşırı uyum)' : ''}. Süre: ${fmt((performance.now() - t0) / 1000)} s.</p>`;
    $('gaLearned').style.display = '';
    const P = r.best;
    drawMF($('gaMfG'), P.g, B.SETS_IN, B.IN_MAX, null, []); drawMF($('gaMfR'), P.r, B.SETS_IN, B.IN_MAX, null, []); drawMF($('gaMfO'), P.o, B.SETS_OUT, B.OUT_MAX, null, []);
    const base0 = cfg.ctx.P_fuzzy;
    $('gaRules').innerHTML = `<tr><th class="rh">Yeşil ↓ · Kırmızı →</th>${B.SETS_IN.map(s => `<th>${s}</th>`).join('')}</tr>` + B.SETS_IN.map((s, a) => `<tr><th class="rh">${s}</th>${[0, 1, 2].map(b => { const k = a * 3 + b, ch = P.rules[k] !== base0.rules[k];
      return `<td><div style="${ch ? `background:${rgba(C.accent, .22)};color:${C.ink}` : ''}" title="${ch ? 'Başlangıçta: ' + B.SETS_OUT[base0.rules[k]] : ''}">${B.SETS_OUT[P.rules[k]]}</div></td>`; }).join('')}</tr>`).join('');
    $('gaStatus').textContent = 'Tamamlandı. Çözümü uygulamak için aşağıdaki düğmeyi kullanın.';
  } catch (e) { $('gaStatus').textContent = e.message === 'iptal' ? 'Durduruldu' : 'Hata: ' + e.message; }
  $('gaRun').disabled = false; $('gaStop').disabled = true;
}
async function runQ() {
  const scenarios = scList($('qSc').value), episodes = +$('qEp').value;
  const cfg = { scenarios, episodes, ctx: ctxPlain(), dt: DT, dur: 900, seed: (Math.random() * 1e9) | 0 };
  $('qRun').disabled = true; $('qStop').disabled = false;
  const draw = curve => { const ma = curve.map((_, i) => B.mean(curve.slice(Math.max(0, i - 9), i + 1).map(c => c.delay)));
    const st = episodes > 150 ? 40 : 20, ticks = []; for (let e = 0; e <= episodes; e += st) ticks.push(Math.max(1, e));
    drawLines($('cvQL'), [{ xs: curve.map(c => c.e), ys: curve.map(c => c.delay), color: rgba(C.ct.qlearn, .35), w: 1 }, { xs: curve.map(c => c.e), ys: ma, color: C.ct.qlearn, w: 2.2 }],
      { xMin: 1, xMax: episodes, xTicks: ticks, xFmt: String, yLabel: 'Gecikme (s/araç)' }); };
  try {
    const r = await qRunner.run('q', cfg, p => { $('qBar').style.width = (p.progress * 100).toFixed(1) + '%'; $('qStatus').textContent = p.msg; if (p.curve) draw(p.curve); });
    qLast = r; draw(r.curve);
    S.Q = Float64Array.from(r.Q); S.qInfo = { scenarios, episodes, test: r.table.find(x => x.id === 'qlearn').test }; save(); afterTrain();
    $('qRes').innerHTML = `<div class="fz-title"><b>Test sonuçları</b> · ${scLabel(scenarios)} · 5 görülmemiş akış</div>` + resTable(r.table, []) +
      '<p class="hint">Ajan kaydedildi. "Q-öğrenme" denetleyicisi artık simülatörde ve deney laboratuvarında seçilebilir.</p>';
    $('qStatus').textContent = 'Tamamlandı';
  } catch (e) { $('qStatus').textContent = e.message === 'iptal' ? 'Durduruldu' : 'Hata: ' + e.message; }
  $('qRun').disabled = false; $('qStop').disabled = true;
}
function renderPolicy() {
  const tb = +$('qTb').value; $('qTbLab').textContent = 'geçen yeşil ' + B.TB_LABELS[tb];
  if (!S.Q) { const { ctx, W, H } = prep($('cvPol')); ctx.fillStyle = C.muted; ctx.font = `13px ${SANS}`; ctx.textAlign = 'center'; ctx.fillText('Ajan eğitildiğinde politika haritası burada görünür.', W / 2, H / 2); return; }
  drawPolicy($('cvPol'), S.Q, tb);
}

// ---------- Analizler: hesaplama maliyeti ----------
function measureInfer() {
  const N = 20000, P = B.DEFAULT_P; let x = 0; const t0 = performance.now();
  for (let i = 0; i < N; i++) x += B.infer(P, i % 20, (i * 7) % 20).out;
  const us = (performance.now() - t0) * 1000 / N;
  $('inferCost').textContent = `${fmt(us, 1)} µs/karar (bu cihazda)`; return x;
}

// ---------- Görünüm değişince yeniden çiz ----------
function refreshStatic() {
  if (view === 'lab') { renderLab(); renderSens(); }
  if (view === 'optimize') { renderPolicy(); if (!gaLast && !$('gaRun').disabled) placeholder($('cvGA'), 'Optimizasyon başlatıldığında yakınsama eğrisi burada çizilir.'); if (!qLast && !$('qRun').disabled) placeholder($('cvQL'), 'Eğitim başlatıldığında öğrenme eğrisi burada çizilir.'); if (gaLast && $('gaLearned').style.display !== 'none') { const P = gaLast.best; drawMF($('gaMfG'), P.g, B.SETS_IN, B.IN_MAX, null, []); drawMF($('gaMfR'), P.r, B.SETS_IN, B.IN_MAX, null, []); drawMF($('gaMfO'), P.o, B.SETS_OUT, B.OUT_MAX, null, []); } }
}
let rsT = 0; window.addEventListener('resize', () => { clearTimeout(rsT); rsT = setTimeout(refreshStatic, 120); });

// ---------- Başlat ----------
initSimUI(); initLabUI(); initOptUI();
liveReset(false);
route();
setTimeout(measureInfer, 300);
requestAnimationFrame(frame);
})();
