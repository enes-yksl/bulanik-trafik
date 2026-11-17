/* =====================================================================
   Bulanık Trafik — simülasyon motoru (DOM içermez; sayfada ve Web
   Worker içinde ortak kullanılır).
   ===================================================================== */
(function (root) {
'use strict';

// ---------- Model sabitleri ----------
const K = {
  VMAX: 13.9,   // m/s (50 km/sa)
  ACC: 2.0,     // m/s² ivmelenme
  DEC: 3.5,     // m/s² konforlu yavaşlama
  BMAX: 5.0,    // m/s² sarıda durabilme sınırı
  JAM: 7.0,     // m, duran araçlar arası ön tampon mesafesi
  REACT: 1.0,   // s, kalkış tepki süresi
  CARLEN: 4.5, CARW: 2.3,
  L: 90,        // m, dur çizgisine kadar yaklaşım uzunluğu
  BOX: 12,      // m, kavşak merkezinden dur çizgisine
  LANEW: 5,
  YELLOW: 3, ALLRED: 2,
  DET: 40,      // m, araç tetiklemeli kontrol dedektörünün dur çizgisine uzaklığı
  MING: 7,      // s, en kısa yeşil
  SAT: 0.48,    // araç/s/şerit, modelin ölçülen doygun akımı (≈1740 ta/sa, dt = 0,1 s)
  LOST: 5.5     // s, faz başına kayıp zaman (Webster; modelden kalibre: 1,4 s kalkış + 2 s tüm kırmızı + ≈2 s kullanılmayan sarı)
};
K.EXIT = 2 * (K.L + K.BOX) + 6;
K.FF = K.L / K.VMAX;               // serbest akım geçiş süresi
const PH = [0, 0, 1, 1];           // K, G, B, D kollarının fazı
const DIRS = [[0, 1], [0, -1], [1, 0], [-1, 0]];
const ARM = ['Kuzey', 'Güney', 'Batı', 'Doğu'];
const PHASE_NAMES = ['K–G', 'B–D'];

// ---------- Talep profilleri ve senaryolar ----------
const PROFILES = {
  sabit: { name: 'Sabit', f: () => 1 },
  dalga: { name: 'Yönler arası kayan dalga', f: (t, i) => 1 + 0.75 * Math.sin(2 * Math.PI * t / 360 + (PH[i] ? Math.PI : 0)) },
  zirve: { name: 'Zirve saati (30 dk periyot)', f: (t) => { const x = Math.sin(Math.PI * ((t % 1800) / 1800)); return 0.45 + 0.9 * x * x; } },
  olay:  { name: 'Ani talep artışı (Batı kolu)', f: (t, i) => { if (i !== 2) return 1; const m = t % 900; return (m >= 240 && m < 420) ? 3 : 1; } }
};
const SCENARIOS = [
  { id: 'dengeli', name: 'Dengeli, orta yoğunluk', rates: [8, 8, 8, 8], profile: 'sabit', desc: 'Tüm kollarda eşit ve sabit talep. Sabit süreli sinyal için en elverişli koşul.' },
  { id: 'gece',    name: 'Düşük yoğunluk (gece)', rates: [3, 2, 2, 3], profile: 'sabit', desc: 'Seyrek trafik. Boşa harcanan yeşil süresi belirleyici olur.' },
  { id: 'anayol',  name: 'Ana yol – tali yol', rates: [15, 15, 4, 4], profile: 'sabit', desc: 'K–G ana arter, B–D tali yol. Yeşilin bölünmesi önem kazanır.' },
  { id: 'asim',    name: 'Asimetrik akış', rates: [17, 6, 10, 4], profile: 'sabit', desc: 'Her kolun talebi farklı. Aynı fazdaki kollar dengesiz.' },
  { id: 'yuksek',  name: 'Doygunluğa yakın', rates: [12, 12, 12, 12], profile: 'sabit', desc: 'Talep kapasiteye yakın. Kayıp zamanın etkisi büyür.' },
  { id: 'doygun',  name: 'Aşırı doygun', rates: [16, 16, 14, 14], profile: 'sabit', desc: 'Talep kapasiteyi aşar. Kuyruklar süre boyunca büyür.' },
  { id: 'dalga',   name: 'Yönler arası kayan talep', rates: [9, 9, 9, 9], profile: 'dalga', desc: 'Yoğunluk 6 dakikalık periyotla K–G ile B–D arasında yer değiştirir.' },
  { id: 'sabah',   name: 'Zirve saati profili', rates: [10, 10, 7, 7], profile: 'zirve', desc: 'Talep 30 dakikalık periyotla düşük düzeyden zirveye çıkıp geri iner.' },
  { id: 'olay',    name: 'Ani talep artışı (etkinlik)', rates: [7, 7, 7, 7], profile: 'olay', desc: 'Batı kolunda her 15 dakikada bir, 3 dakika boyunca talep 3 katına çıkar.' }
];
const CONTROLLERS = [
  { id: 'fixed',    name: 'Sabit süreli',            short: 'Sabit' },
  { id: 'webster',  name: 'Webster (optimum sabit)', short: 'Webster' },
  { id: 'actuated', name: 'Araç tetiklemeli',        short: 'Tetiklemeli' },
  { id: 'fuzzy',    name: 'Bulanık (Mamdani)',       short: 'Bulanık' },
  { id: 'fuzzyga',  name: 'Bulanık + GA',            short: 'Bulanık+GA' },
  { id: 'qlearn',   name: 'Q-öğrenme',               short: 'Q-öğrenme' }
];

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

function makeDemand(sc, scale) {
  const out = [0, 0, 0, 0], prof = PROFILES[sc.profile] || PROFILES.sabit, k = scale || 1;
  return t => { for (let i = 0; i < 4; i++) out[i] = Math.max(0, sc.rates[i] / 60 * prof.f(t, i) * k); return out; };
}
function meanFactors(sc) {
  const prof = PROFILES[sc.profile] || PROFILES.sabit, m = [0, 0, 0, 0], N = 3600;
  for (let t = 0; t < N; t++) for (let i = 0; i < 4; i++) m[i] += prof.f(t, i) / N;
  return m;
}

// ---------- Bulanık çıkarım (Mamdani) ----------
const IN_MAX = 20, OUT_MAX = 15, NSAMP = 61;
const SETS_IN = ['Az', 'Orta', 'Çok'], SETS_OUT = ['Sıfır', 'Kısa', 'Orta', 'Uzun'];
const DEFAULT_P = { g: [0, 6, 12], r: [0, 6, 12], o: [0, 3, 7, 12], rules: [0, 0, 0, 2, 1, 0, 3, 2, 1] };
const cloneP = p => ({ g: p.g.slice(), r: p.r.slice(), o: p.o.slice(), rules: p.rules.slice() });

function ruspini(c, k, x) {
  const n = c.length;
  if (k === 0) { if (x <= c[0]) return 1; if (x >= c[1]) return 0; return (c[1] - x) / (c[1] - c[0]); }
  if (k === n - 1) { if (x >= c[n - 1]) return 1; if (x <= c[n - 2]) return 0; return (x - c[n - 2]) / (c[n - 1] - c[n - 2]); }
  if (x <= c[k - 1] || x >= c[k + 1]) return 0;
  return x <= c[k] ? (x - c[k - 1]) / (c[k] - c[k - 1]) : (c[k + 1] - x) / (c[k + 1] - c[k]);
}
function infer(P, qG, qR, full) {
  const muG = [0, 1, 2].map(k => ruspini(P.g, k, qG)), muR = [0, 1, 2].map(k => ruspini(P.r, k, qR));
  const fire = new Array(9), agg = new Float64Array(NSAMP);
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
    const w = Math.min(muG[a], muR[b]); fire[a * 3 + b] = w;
    if (w > 0) { const o = P.rules[a * 3 + b];
      for (let j = 0; j < NSAMP; j++) { const x = j * OUT_MAX / (NSAMP - 1); const m = Math.min(w, ruspini(P.o, o, x)); if (m > agg[j]) agg[j] = m; } }
  }
  let num = 0, den = 0;
  for (let j = 0; j < NSAMP; j++) { const x = j * OUT_MAX / (NSAMP - 1); num += x * agg[j]; den += agg[j]; }
  const out = den > 0 ? num / den : 0;
  return full ? { out, muG, muR, fire, agg } : { out };
}

// ---------- Simülasyon ----------
class Sim {
  constructor(seed, demand, ctrl, opt) {
    opt = opt || {};
    this.warm = opt.warm || 0;
    this.t = 0; this.demand = demand; this.ctrl = ctrl;
    this.lanes = [];
    for (let i = 0; i < 4; i++) this.lanes.push({ cars: [], pending: [], rng: mulberry32(((seed * 2654435761) >>> 0) + i * 97531) });
    this.phase = 0; this.state = 'green'; this.stateT = 0;
    this.epoch = [0, 0, 0, 0]; this.lastDet = [-1e9, -1e9, -1e9, -1e9];
    this.crossed = 0; this.crossedAll = 0; this.sumDelay = 0; this.sumStops = 0; this.delays = [];
    this.switches = 0; this.maxQ = 0; this.sumQ = 0; this.nQ = 0; this.nextQ = 0;
    ctrl.init(this);
  }
  green(i) { return this.state === 'green' && PH[i] === this.phase; }
  sig(i) { if (PH[i] !== this.phase) return 'red'; return this.state === 'green' ? 'green' : this.state === 'yellow' ? 'yellow' : 'red'; }
  count(i) { const ln = this.lanes[i]; let n = ln.pending.length; const cs = ln.cars; for (let k = cs.length - 1; k >= 0; k--) { if (cs[k].s < K.L) n++; else break; } return n; }
  phaseCount(p) { let m = 0; for (let i = 0; i < 4; i++) if (PH[i] === p) { const c = this.count(i); if (c > m) m = c; } return m; }
  queued() { let n = 0; for (const ln of this.lanes) { n += ln.pending.length; for (const c of ln.cars) if (c.s < K.L && c.v < 1.5) n++; } return n; }
  step(dt) {
    const rates = this.demand(this.t), t = this.t;
    for (let i = 0; i < 4; i++) {
      const ln = this.lanes[i], cars = ln.cars;
      if (ln.rng() < rates[i] * dt) ln.pending.push(t);
      if (ln.pending.length) {
        const last = cars[cars.length - 1];
        if (!last || last.s >= K.JAM + 0.3) {
          const tg = ln.pending.shift(), gap = last ? last.s - K.JAM : 1e9;
          const v = Math.min(K.VMAX, Math.sqrt(2 * K.DEC * Math.max(0, gap)));
          cars.push({ s: 0, v, tg, react: 0, stopped: v < 0.1, done: false, ep: -1, go: false, stops: v < 0.1 ? 1 : 0 });
        }
      }
      const green = this.green(i);
      for (let k = 0; k < cars.length; k++) {
        const c = cars[k];
        let lim = k > 0 ? cars[k - 1].s - K.JAM : 1e9;
        if (!green && c.s < K.L) {
          if (c.ep !== this.epoch[i]) { c.ep = this.epoch[i]; c.go = (K.L - c.s) < c.v * c.v / (2 * K.BMAX); }
          if (!c.go) lim = Math.min(lim, K.L - 0.05);
        }
        const gap = lim - c.s; let v;
        if (gap <= 0.3) { v = 0; c.react = 0; }
        else if (c.stopped) { c.react += dt; if (c.react >= K.REACT - 1e-9) { c.stopped = false; c.react = 0; v = Math.min(K.ACC * dt, Math.sqrt(2 * K.DEC * gap)); } else v = 0; }
        else v = Math.min(c.v + K.ACC * dt, K.VMAX, Math.sqrt(2 * K.DEC * gap));
        if (v < 0.05) { v = 0; if (!c.stopped) { c.stopped = true; c.react = 0; if (c.s < K.L) c.stops++; } }
        c.s += Math.min((c.v + v) * 0.5 * dt, Math.max(0, gap)); c.v = v;
        if (c.s >= K.L - K.DET - 1 && c.s - K.CARLEN <= K.L - K.DET + 1) this.lastDet[i] = t; // varlık algılama (2 m döngü)
        if (!c.done && c.s >= K.L) {
          c.done = true; this.crossedAll++;
          if (c.tg >= this.warm) { const d = Math.max(0, t + dt - c.tg - K.FF); this.crossed++; this.sumDelay += d; this.sumStops += c.stops; this.delays.push(d); }
        }
      }
      while (cars.length && cars[0].s > K.EXIT) cars.shift();
    }
    if (t >= this.nextQ) { this.nextQ += 1; if (t >= this.warm) { const q = this.queued(); if (q > this.maxQ) this.maxQ = q; this.sumQ += q; this.nQ++; } }
    if (this.ctrl.tick) this.ctrl.tick(this, dt);
    this.stateT += dt;
    if (this.state === 'green') {
      if (this.ctrl.update(this)) { this.state = 'yellow'; this.stateT = 0; this.switches++; for (let i = 0; i < 4; i++) if (PH[i] === this.phase) this.epoch[i]++; }
    } else if (this.state === 'yellow') { if (this.stateT >= K.YELLOW - 1e-9) { this.state = 'allred'; this.stateT = 0; } }
    else if (this.stateT >= K.ALLRED - 1e-9) { this.state = 'green'; this.stateT = 0; this.phase = 1 - this.phase; this.ctrl.onGreen(this); }
    this.t += dt;
  }
  // Araç başına ortalama gecikme: geçen araçların kontrol gecikmesi + henüz geçemeyenlerin o ana kadarki gecikmesi
  avgDelay() {
    let tot = this.sumDelay, n = this.crossed;
    for (const ln of this.lanes) {
      for (const c of ln.cars) if (!c.done && c.tg >= this.warm) { tot += Math.max(0, this.t - c.tg - c.s / K.VMAX); n++; }
      for (const tg of ln.pending) if (tg >= this.warm) { tot += this.t - tg; n++; }
    }
    return n ? tot / n : 0;
  }
  unserved() { let n = 0; for (const ln of this.lanes) { for (const c of ln.cars) if (!c.done && c.tg >= this.warm) n++; for (const tg of ln.pending) if (tg >= this.warm) n++; } return n; }
  metrics() {
    const span = Math.max(1, this.t - this.warm);
    return {
      delay: this.avgDelay(),
      p95: percentile(this.delays, 0.95),
      stops: this.crossed ? this.sumStops / this.crossed : 0,
      thru: this.crossed / span * 3600,
      maxQ: this.maxQ,
      meanQ: this.nQ ? this.sumQ / this.nQ : 0,
      unserved: this.unserved(),
      cycle: this.switches > 1 ? span / (this.switches / 2) : span
    };
  }
}
function percentile(arr, p) { if (!arr.length) return 0; const a = arr.slice().sort((x, y) => x - y); const i = (a.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return a[lo] + (a[hi] - a[lo]) * (i - lo); }

// ---------- Denetleyiciler ----------
function ctrlFixed(G) {
  return { kind: 'fixed', G, last: null, init() {}, onGreen() {}, update(s) { return s.stateT >= this.G[s.phase] - 1e-9; } };
}
function webster(sc, scale) {
  const mf = meanFactors(sc), k = scale || 1, y = [0, 0];
  for (let i = 0; i < 4; i++) { const q = sc.rates[i] / 60 * mf[i] * k; y[PH[i]] = Math.max(y[PH[i]], q / K.SAT); }
  const Y = y[0] + y[1], Lt = 2 * K.LOST;
  let C = Y < 0.95 ? (1.5 * Lt + 5) / (1 - Y) : 150; C = clamp(C, 30, 150);
  const eff = C - Lt;
  const G = y.map(v => clamp((Y > 0 ? eff * v / Y : eff / 2) + K.LOST - K.YELLOW - K.ALLRED, K.MING, 120));
  return { C, G, Y, y };
}
function ctrlActuated(o) {
  return { kind: 'actuated', maxG: o.maxG, last: null, init() {}, onGreen() {},
    update(s) {
      if (s.stateT < o.minG) return false;
      const qR = s.phaseCount(1 - s.phase);
      if (qR === 0) { this.last = { t: s.t, act: 'Karşı yönde talep yok, yeşilde bekliyor' }; return false; }
      if (s.stateT >= this.maxG - 1e-9) { this.last = { t: s.t, act: 'Maksimum yeşil doldu (max-out)' }; return true; }
      let ld = -1e9; for (let i = 0; i < 4; i++) if (PH[i] === s.phase) ld = Math.max(ld, s.lastDet[i]);
      if (s.t - ld > o.gap) { this.last = { t: s.t, act: `Dedektörde ${o.gap} s boşluk (gap-out)` }; return true; }
      return false;
    } };
}
function ctrlFuzzy(o) {
  const minG = K.MING, thr = 1.5;
  return { kind: 'fuzzy', P: o.P, maxG: o.maxG, nextEval: minG, last: null,
    init() { this.nextEval = minG; }, onGreen() { this.nextEval = minG; },
    update(s) {
      if (s.stateT < this.nextEval - 1e-9) return false;
      const qG = s.phaseCount(s.phase), qR = s.phaseCount(1 - s.phase), t = s.t;
      if (qR === 0) { this.nextEval = s.stateT + 1; this.last = { t, qG, qR, act: 'Karşı yönde araç yok, yeşil devam ediyor' }; return false; }
      if (s.stateT >= this.maxG - 1e-9) { this.last = { t, qG, qR, act: 'Maksimum yeşil doldu, faz değişiyor' }; return true; }
      const r = infer(this.P, qG, qR);
      if (r.out < thr) { this.last = { t, qG, qR, out: r.out, act: `Çıktı ${r.out.toFixed(1).replace('.', ',')} s < 1,5 s, faz değişiyor` }; return true; }
      const ext = Math.min(r.out, this.maxG - s.stateT); this.nextEval = s.stateT + ext;
      this.last = { t, qG, qR, out: r.out, act: `Yeşil +${ext.toFixed(1).replace('.', ',')} s uzatıldı` }; return false;
    } };
}
// Q-öğrenme: durum = (yeşil kuyruk sınıfı, kırmızı kuyruk sınıfı, geçen yeşil sınıfı); eylem = {devam, değiştir}
const QBIN = n => n === 0 ? 0 : n <= 2 ? 1 : n <= 5 ? 2 : n <= 9 ? 3 : n <= 14 ? 4 : 5;
const TBIN = t => t < 12 ? 0 : t < 20 ? 1 : t < 35 ? 2 : 3;
const QB_LABELS = ['0', '1–2', '3–5', '6–9', '10–14', '15+'], TB_LABELS = ['< 12 s', '12–20 s', '20–35 s', '≥ 35 s'];
const QSTATES = 6 * 6 * 4;
const qIndex = (qg, qr, tb) => (qg * 6 + qr) * 4 + tb;
function ctrlQ(o) {
  const L = o.learn;
  return { kind: 'qlearn', maxG: o.maxG, Q: o.Q, next: K.MING, prev: -1, prevA: 0, acc: 0, last: null,
    init() { this.next = K.MING; }, onGreen() { this.next = K.MING; },
    tick(s, dt) { if (L) this.acc += s.queued() * dt; },
    update(s) {
      if (s.stateT < this.next - 1e-9) return false;
      const qG = s.phaseCount(s.phase), qR = s.phaseCount(1 - s.phase);
      const st = qIndex(QBIN(qG), QBIN(qR), TBIN(s.stateT));
      let a, why = '';
      if (qR === 0) { a = 0; why = 'karşı yön boş'; }
      else if (s.stateT >= this.maxG - 1e-9) { a = 1; why = 'maks. yeşil'; }
      else if (L && L.rng() < L.eps) { a = L.rng() < 0.5 ? 0 : 1; why = 'keşif'; }
      else { a = o.Q[st * 2 + 1] > o.Q[st * 2] ? 1 : 0; why = 'politika'; }
      if (L) {
        if (this.prev >= 0) { const r = -this.acc / 10, mx = Math.max(o.Q[st * 2], o.Q[st * 2 + 1]), k = this.prev * 2 + this.prevA; o.Q[k] += L.alpha * (r + L.gamma * mx - o.Q[k]); }
        this.prev = st; this.prevA = a; this.acc = 0;
      }
      this.last = { t: s.t, qG, qR, act: (a ? 'Faz değiştiriliyor' : 'Yeşil 2 s sürdürülüyor') + ` (${why})` };
      if (a === 1) return true;
      this.next = s.stateT + 2; return false;
    } };
}
// ctx: { scenario, scale, fixedG, maxG, P_fuzzy, P_ga, Q }
function buildController(type, ctx) {
  switch (type) {
    case 'fixed': return ctrlFixed([ctx.fixedG, ctx.fixedG]);
    case 'webster': return ctrlFixed(webster(ctx.scenario, ctx.scale).G);
    case 'actuated': return ctrlActuated({ minG: K.MING, gap: 3, maxG: ctx.maxG });
    case 'fuzzy': return ctrlFuzzy({ P: ctx.P_fuzzy || DEFAULT_P, maxG: ctx.maxG });
    case 'fuzzyga': return ctrlFuzzy({ P: ctx.P_ga || ctx.P_fuzzy || DEFAULT_P, maxG: ctx.maxG });
    case 'qlearn': return ctrlQ({ Q: ctx.Q || new Float64Array(QSTATES * 2), maxG: ctx.maxG });
  }
  throw new Error('Bilinmeyen denetleyici: ' + type);
}
function runOne(sc, type, ctx, seed, dur, warm, dt, scale) {
  const c = Object.assign({}, ctx, { scenario: sc, scale: scale || 1 });
  const sim = new Sim(seed, makeDemand(sc, scale), buildController(type, c), { warm });
  const n = Math.round(dur / dt);
  for (let i = 0; i < n; i++) sim.step(dt);
  return sim.metrics();
}

// ---------- İstatistik ----------
const mean = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const sd = a => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1)); };
function gammaln(x) { const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5]; let y = x, tmp = x + 5.5; tmp -= (x + 0.5) * Math.log(tmp); let ser = 1.000000000190015; for (let j = 0; j < 6; j++) ser += c[j] / ++y; return -tmp + Math.log(2.5066282746310005 * ser / x); }
function betacf(a, b, x) { const FP = 1e-300; const qab = a + b, qap = a + 1, qam = a - 1; let c = 1, d = 1 - qab * x / qap; if (Math.abs(d) < FP) d = FP; d = 1 / d; let h = d;
  for (let m = 1; m <= 300; m++) { const m2 = 2 * m; let aa = m * (b - m) * x / ((qam + m2) * (a + m2)); d = 1 + aa * d; if (Math.abs(d) < FP) d = FP; c = 1 + aa / c; if (Math.abs(c) < FP) c = FP; d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2)); d = 1 + aa * d; if (Math.abs(d) < FP) d = FP; c = 1 + aa / c; if (Math.abs(c) < FP) c = FP; d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 3e-12) break; } return h; }
function ibeta(a, b, x) { if (x <= 0) return 0; if (x >= 1) return 1; const bt = Math.exp(gammaln(a + b) - gammaln(a) - gammaln(b) + a * Math.log(x) + b * Math.log(1 - x)); return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b; }
const tP2 = (t, df) => df > 0 ? ibeta(df / 2, 0.5, df / (df + t * t)) : 1;
function tCrit(df, alpha) { alpha = alpha || 0.05; if (df < 1) return 0; let lo = 0, hi = 100; for (let i = 0; i < 90; i++) { const m = (lo + hi) / 2; if (tP2(m, df) > alpha) lo = m; else hi = m; } return (lo + hi) / 2; }
function ci95(a) { return a.length > 1 ? tCrit(a.length - 1) * sd(a) / Math.sqrt(a.length) : 0; }
function pairedT(a, b) { // H0: ortalama(b - a) = 0
  const d = a.map((x, i) => b[i] - x), n = d.length, m = mean(d), s = sd(d);
  if (n < 2) return { t: 0, p: 1, md: m };
  if (s === 0) return { t: m === 0 ? 0 : Infinity, p: m === 0 ? 1 : 0, md: m };
  const t = m / (s / Math.sqrt(n)); return { t, p: tP2(Math.abs(t), n - 1), md: m };
}
function holm(ps) { const idx = ps.map((p, i) => [p, i]).sort((x, y) => x[0] - y[0]), m = ps.length, out = new Array(m); let run = 0;
  idx.forEach(([p, i], k) => { run = Math.max(run, Math.min(1, (m - k) * p)); out[i] = run; }); return out; }
function los(d) { return d <= 10 ? 'A' : d <= 20 ? 'B' : d <= 35 ? 'C' : d <= 55 ? 'D' : d <= 80 ? 'E' : 'F'; }

// ---------- Genetik algoritma ----------
function fixC(c, max) { const n = c.length; c.sort((a, b) => a - b); for (let k = 0; k < n; k++) c[k] = clamp(c[k], 0, max);
  for (let k = 1; k < n; k++) if (c[k] < c[k - 1] + 0.5) c[k] = c[k - 1] + 0.5;
  if (c[n - 1] > max) { c[n - 1] = max; for (let k = n - 2; k >= 0; k--) if (c[k] > c[k + 1] - 0.5) c[k] = c[k + 1] - 0.5; } return c; }
function randInd(rng, base, mode) {
  const ru = (n, m) => fixC(Array.from({ length: n }, () => rng() * m), m);
  const p = cloneP(base);
  if (mode !== 'rules') { p.g = ru(3, IN_MAX); p.r = ru(3, IN_MAX); p.o = ru(4, OUT_MAX); }
  if (mode !== 'mf') p.rules = Array.from({ length: 9 }, () => Math.floor(rng() * 4));
  return p;
}
function randn(rng) { let u = 0, v = 0; while (!u) u = rng(); while (!v) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function crossover(rng, a, b, mode) {
  const mx = (x, y) => x.map((v, i) => v + (rng() * 1.4 - 0.2) * (y[i] - v));
  const c = cloneP(a);
  if (mode !== 'rules') { c.g = mx(a.g, b.g); c.r = mx(a.r, b.r); c.o = mx(a.o, b.o); }
  if (mode !== 'mf') c.rules = a.rules.map((v, i) => rng() < 0.5 ? v : b.rules[i]);
  return c;
}
function mutate(rng, p, mode) {
  if (mode !== 'rules') { const m = (arr, s) => { for (let i = 0; i < arr.length; i++) if (rng() < 0.3) arr[i] += randn(rng) * s; }; m(p.g, 2); m(p.r, 2); m(p.o, 1.5); }
  if (mode !== 'mf') for (let i = 0; i < 9; i++) if (rng() < 0.12) p.rules[i] = clamp(p.rules[i] + (rng() < 0.5 ? -1 : 1), 0, 3);
  fixC(p.g, IN_MAX); fixC(p.r, IN_MAX); fixC(p.o, OUT_MAX); return p;
}

// ---------- Görev üreteçleri (Worker'da ya da sayfada parça parça çalışır) ----------
// Toplu deney: senaryo × denetleyici × tekrar
function* taskLab(cfg) {
  const { scenarios, controllers, reps, dur, warm, ctx } = cfg, dt = cfg.dt || 0.1;
  const total = scenarios.length * controllers.length * reps; let done = 0;
  const res = {};
  for (const sid of scenarios) {
    const sc = SCENARIOS.find(s => s.id === sid); res[sid] = {};
    for (const cid of controllers) {
      const runs = [];
      for (let r = 0; r < reps; r++) {
        runs.push(runOne(sc, cid, ctx, 1000 + r * 17, dur, warm, dt));
        done++; yield { progress: done / total, msg: `${sc.name} · ${CONTROLLERS.find(c => c.id === cid).short} · tekrar ${r + 1}/${reps}` };
      }
      res[sid][cid] = runs;
    }
  }
  return res;
}
// Talep duyarlılığı: talep çarpanına göre gecikme
function* taskSens(cfg) {
  const { scenario, controllers, factors, reps, dur, warm, ctx } = cfg, dt = cfg.dt || 0.1;
  const sc = SCENARIOS.find(s => s.id === scenario) || scenario;
  const total = factors.length * controllers.length * reps; let done = 0; const res = {};
  for (const cid of controllers) {
    res[cid] = [];
    for (const f of factors) {
      const ds = [];
      for (let r = 0; r < reps; r++) { ds.push(runOne(sc, cid, ctx, 2000 + r * 31, dur, warm, dt, f).delay); done++; yield { progress: done / total, msg: `Talep ×${f.toFixed(2)} · ${CONTROLLERS.find(c => c.id === cid).short}` }; }
      res[cid].push({ f, mean: mean(ds), ci: ci95(ds) });
    }
  }
  return res;
}
// GA: üyelik fonksiyonları ve/veya kural tabanı
function* taskGA(cfg) {
  const { scenarios, pop: popN, gens, mode, ctx } = cfg, dt = cfg.dt || 0.1, dur = cfg.dur || 900, warm = cfg.warm || 120;
  const TRAIN = [101, 202], TEST = [303, 404, 505, 606, 707];
  const rng = mulberry32(cfg.seed || 12345);
  const scs = scenarios.map(id => SCENARIOS.find(s => s.id === id));
  const evalP = (P, seeds) => { let s = 0; for (const sc of scs) for (const sd_ of seeds) s += runOne(sc, 'fuzzy', Object.assign({}, ctx, { P_fuzzy: P }), sd_, dur, warm, dt).delay; return s / (scs.length * seeds.length); };
  const evalC = (cid, seeds) => { let s = 0; for (const sc of scs) for (const sd_ of seeds) s += runOne(sc, cid, ctx, sd_, dur, warm, dt).delay; return s / (scs.length * seeds.length); };
  const total = popN + gens * (popN - 2) + 8; let done = 0;
  const base = cloneP(ctx.P_fuzzy || DEFAULT_P);
  let pop = [cloneP(base), cloneP(DEFAULT_P)]; while (pop.length < popN) pop.push(randInd(rng, base, mode));
  let fit = [];
  for (let i = 0; i < pop.length; i++) { fit.push(evalP(pop[i], TRAIN)); done++; yield { progress: done / total, msg: `Başlangıç popülasyonu ${i + 1}/${popN}` }; }
  const hist = [];
  for (let g = 0; g <= gens; g++) {
    const idx = [...pop.keys()].sort((a, b) => fit[a] - fit[b]); pop = idx.map(i => pop[i]); fit = idx.map(i => fit[i]);
    hist.push({ best: fit[0], mean: mean(fit), worst: fit[fit.length - 1] });
    yield { progress: done / total, msg: `Nesil ${g}/${gens} · en iyi ${fit[0].toFixed(2)} s`, hist: hist.slice() };
    if (g === gens) break;
    const np = [cloneP(pop[0]), cloneP(pop[1])], nf = [fit[0], fit[1]];
    const tour = () => { let b = -1; for (let i = 0; i < 3; i++) { const j = Math.floor(rng() * pop.length); if (b < 0 || fit[j] < fit[b]) b = j; } return pop[b]; };
    while (np.length < popN) { const c = mutate(rng, crossover(rng, tour(), tour(), mode), mode); np.push(c); nf.push(evalP(c, TRAIN)); done++; yield { progress: done / total, msg: `Nesil ${g + 1}/${gens} · birey ${np.length}/${popN}` }; }
    pop = np; fit = nf;
  }
  const best = pop[0];
  yield { progress: done / total, msg: 'Görülmemiş tohumlarla test ediliyor…' };
  const table = [];
  for (const cid of ['fixed', 'webster', 'actuated', 'fuzzy']) { table.push({ id: cid, train: evalC(cid, TRAIN), test: evalC(cid, TEST) }); done++; yield { progress: done / total, msg: 'Test: ' + cid }; }
  table.push({ id: 'fuzzyga', train: fit[0], test: evalP(best, TEST) });
  return { best, hist, table, mode, scenarios };
}
// Q-öğrenme eğitimi
function* taskQ(cfg) {
  const { scenarios, episodes, ctx } = cfg, dt = cfg.dt || 0.1, dur = cfg.dur || 900;
  const rng = mulberry32(cfg.seed || 777);
  const Q = new Float64Array(QSTATES * 2);
  const scs = scenarios.map(id => SCENARIOS.find(s => s.id === id));
  const curve = [];
  for (let e = 0; e < episodes; e++) {
    const eps = Math.max(0.02, 0.35 * (1 - e / (episodes * 0.8)));
    const sc = scs[e % scs.length];
    const ctrl = ctrlQ({ Q, maxG: ctx.maxG, learn: { alpha: 0.1, gamma: 0.9, eps, rng } });
    const sim = new Sim(5000 + e * 13, makeDemand(sc), ctrl, { warm: 60 });
    const n = Math.round(dur / dt); for (let i = 0; i < n; i++) sim.step(dt);
    curve.push({ e: e + 1, delay: sim.avgDelay(), eps });
    yield { progress: (e + 1) / (episodes + 2), msg: `Bölüm ${e + 1}/${episodes} · ε = ${eps.toFixed(2)} · gecikme ${sim.avgDelay().toFixed(1)} s`, curve: curve.slice() };
  }
  const TEST = [303, 404, 505, 606, 707]; const table = [];
  const ev = (cid, c) => { let s = 0; for (const sc of scs) for (const sd_ of TEST) s += runOne(sc, cid, c, sd_, dur, 120, dt).delay; return s / (scs.length * TEST.length); };
  for (const cid of ['fixed', 'webster', 'actuated', 'fuzzy']) table.push({ id: cid, test: ev(cid, ctx) });
  table.push({ id: 'qlearn', test: ev('qlearn', Object.assign({}, ctx, { Q })) });
  yield { progress: 1, msg: 'Tamamlandı' };
  return { Q: Array.from(Q), curve, table, scenarios };
}

const API = { K, PH, DIRS, ARM, PHASE_NAMES, PROFILES, SCENARIOS, CONTROLLERS, IN_MAX, OUT_MAX, NSAMP, SETS_IN, SETS_OUT, DEFAULT_P, QB_LABELS, TB_LABELS, QSTATES,
  cloneP, ruspini, infer, Sim, makeDemand, webster, buildController, runOne, mulberry32, clamp, qIndex,
  mean, sd, ci95, tCrit, pairedT, holm, los, percentile, taskLab, taskSens, taskGA, taskQ };
root.BT = API;
if (typeof module !== 'undefined') module.exports = API;
})(typeof self !== 'undefined' ? self : this);
