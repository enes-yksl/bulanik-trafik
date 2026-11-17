/* =====================================================================
   Bulanık Trafik — çok kavşaklı ağ simülasyonu (engine.js'e bağlıdır)
   Her kavşak kendi denetleyicisini çalıştırır. Araçlar rotalarını izler,
   kavşaklarda döner ve önündeki yol doluysa kavşağa girmez (geri taşma).
   ===================================================================== */
(function (root) {
'use strict';
const B = root.BT, K = B.K, PH = B.PH;
const HEAD = [[0, 1], [0, -1], [1, 0], [-1, 0]];   // yön indisi = yaklaşım indisi (0: güneye, 1: kuzeye, 2: doğuya, 3: batıya)
const RIGHT = [3, 2, 0, 1], LEFT = [2, 3, 1, 0];
const BOXW = 2 * K.BOX, ZONE = 90, VPROG = 12;     // kavşak içi geçiş, algılama bölgesi, yeşil dalga hızı (m/s)

const NETWORKS = [
  { id: 'koridor', name: 'Ana arter koridoru (1×3)', short: 'Koridor', cols: [0, 220, 480], rows: [0], ext: 140, main: 14, side: 5,
    desc: 'Batı–doğu yönlü ana arter üzerinde 220 m ve 260 m aralıklı üç ardışık kavşak. Yan sokaklar arteri keser. Yeşil dalga ve kuyruk geri taşması bu ağda en belirgindir.' },
  { id: 'izgara4', name: 'Izgara ağ (2×2)', short: 'Izgara 2×2', cols: [0, 240], rows: [0, 200], ext: 130, main: 9, side: 7,
    desc: 'Dört kavşaklı kapalı bir blok. Dönen araçlar ağ içinde dolaşır ve kavşaklar birbirinin talebini besler.' },
  { id: 'izgara6', name: 'Izgara ağ (2×3)', short: 'Izgara 2×3', cols: [0, 200, 450], rows: [0, 230], ext: 120, main: 11, side: 6,
    desc: 'İki paralel arter ve üç yan sokaktan oluşan altı kavşaklı ağ. Kavşak aralıkları eşit değildir.' },
  { id: 'izgara9', name: 'Izgara ağ (3×3)', short: 'Izgara 3×3', cols: [0, 210, 400], rows: [0, 180, 400], ext: 110, main: 9, side: 6,
    desc: 'Dokuz kavşaklı şehir merkezi ızgarası. Ortadaki kavşak dört yönden de ağ içi trafik alır.' }
];
const NET_CONTROLLERS = [
  { id: 'fixed', name: 'Sabit süreli', short: 'Sabit' },
  { id: 'webster', name: 'Webster (kavşak başına)', short: 'Webster' },
  { id: 'greenwave', name: 'Yeşil dalga (koordineli)', short: 'Yeşil dalga' },
  { id: 'actuated', name: 'Araç tetiklemeli', short: 'Tetiklemeli' },
  { id: 'fuzzy', name: 'Bulanık (Mamdani)', short: 'Bulanık' },
  { id: 'fuzzyga', name: 'Bulanık + GA', short: 'Bulanık+GA' },
  { id: 'qlearn', name: 'Q-öğrenme', short: 'Q-öğrenme' }
];

// ---------- Geometri ----------
function geometry(def) {
  const R = def.rows.length, Cn = def.cols.length, nodes = [], links = [];
  for (let r = 0; r < R; r++) for (let c = 0; c < Cn; c++) nodes.push(new Node(nodes.length, r, c, def.cols[c], def.rows[r]));
  const at = (r, c) => (r >= 0 && r < R && c >= 0 && c < Cn) ? nodes[r * Cn + c] : null;
  const nb = (n, k) => at(n.r + (k === 0 ? 1 : k === 1 ? -1 : 0), n.c + (k === 2 ? 1 : k === 3 ? -1 : 0));
  for (const n of nodes) for (let k = 0; k < 4; k++) {
    const m = nb(n, k), u = HEAD[k];
    const L = m ? Math.hypot(m.x - n.x, m.y - n.y) - 2 * K.BOX : def.ext - K.BOX;
    const lk = { id: links.length, from: n, to: m, head: k, L, x0: n.x + u[0] * K.BOX, y0: n.y + u[1] * K.BOX, cars: [], entry: false };
    links.push(lk); n.outLinks[k] = lk; if (m) m.inLinks[k] = lk;
  }
  for (const n of nodes) for (let k = 0; k < 4; k++) if (!n.inLinks[k]) {
    const u = HEAD[k];
    const lk = { id: links.length, from: null, to: n, head: k, L: def.ext - K.BOX, x0: n.x - u[0] * def.ext, y0: n.y - u[1] * def.ext, cars: [], entry: true, pending: [], arterial: k >= 2 };
    links.push(lk); n.inLinks[k] = lk;
  }
  const xs = def.cols, ys = def.rows;
  const bounds = { x0: Math.min(...xs) - def.ext, x1: Math.max(...xs) + def.ext, y0: Math.min(...ys) - def.ext, y1: Math.max(...ys) + def.ext };
  return { nodes, links, bounds };
}

class Node {
  constructor(id, r, c, x, y) {
    this.id = id; this.r = r; this.c = c; this.x = x; this.y = y;
    this.inLinks = [null, null, null, null]; this.outLinks = [null, null, null, null];
    this.t = 0; this.phase = 0; this.state = 'green'; this.stateT = 0;
    this.epoch = [0, 0, 0, 0]; this.lastDet = [-1e9, -1e9, -1e9, -1e9]; this.switches = 0; this.ctrl = null;
  }
  count(i) { const lk = this.inLinks[i]; let n = lk.entry ? lk.pending.length : 0; const cs = lk.cars;
    for (let k = cs.length - 1; k >= 0; k--) { const s = cs[k].s; if (s >= lk.L) break; if (s > lk.L - ZONE) n++; } return n; }
  phaseCount(p) { let m = 0; for (let i = 0; i < 4; i++) if (PH[i] === p) { const c = this.count(i); if (c > m) m = c; } return m; }
  queued() { let n = 0; for (let i = 0; i < 4; i++) { const lk = this.inLinks[i]; if (lk.entry) n += lk.pending.length; for (const c of lk.cars) if (c.s < lk.L && c.s > lk.L - ZONE && c.v < 1.5) n++; } return n; }
  sig(i) { if (PH[i] !== this.phase) return 'red'; return this.state === 'green' ? 'green' : this.state === 'yellow' ? 'yellow' : 'red'; }
}

// ---------- Talep ve plan ----------
function entryRate(lk, dem, t) {
  const prof = B.PROFILES[dem.profile] || B.PROFILES.sabit;
  return (lk.arterial ? dem.main : dem.side) / 60 * prof.f(t, lk.head) * (dem.scale || 1);
}
// Dönüş oranlarıyla beklenen bağlantı akımları (araç/s); Webster ve yeşil dalga planı için
function linkFlows(G, dem) {
  const pL = dem.left / 100, pR = dem.right / 100, pS = Math.max(0, 1 - pL - pR);
  const mf = [0, 0, 0, 0], prof = B.PROFILES[dem.profile] || B.PROFILES.sabit;
  for (let t = 0; t < 3600; t++) for (let i = 0; i < 4; i++) mf[i] += prof.f(t, i) / 3600;
  let q = new Float64Array(G.links.length);
  for (let it = 0; it < 80; it++) {
    const nq = new Float64Array(G.links.length);
    for (const lk of G.links) if (lk.entry) nq[lk.id] = (lk.arterial ? dem.main : dem.side) / 60 * mf[lk.head] * (dem.scale || 1);
    for (const n of G.nodes) for (let i = 0; i < 4; i++) {
      const f = q[n.inLinks[i].id];
      nq[n.outLinks[i].id] += f * pS; nq[n.outLinks[RIGHT[i]].id] += f * pR; nq[n.outLinks[LEFT[i]].id] += f * pL;
    }
    q = nq;
  }
  return q;
}
function websterY(y) {
  const Y = y[0] + y[1], Lt = 2 * K.LOST;
  let C = Y < 0.95 ? (1.5 * Lt + 5) / (1 - Y) : 150; C = B.clamp(C, 30, 150);
  const G = y.map(v => B.clamp((Y > 0 ? (C - Lt) * v / Y : (C - Lt) / 2) + K.LOST - K.YELLOW - K.ALLRED, K.MING, 120));
  return { C, G, Y };
}
function netPlan(G, dem) {
  const q = linkFlows(G, dem), plans = [];
  for (const n of G.nodes) {
    const y = [0, 0]; for (let i = 0; i < 4; i++) y[PH[i]] = Math.max(y[PH[i]], q[n.inLinks[i].id] / K.SAT);
    plans.push(Object.assign({ y }, websterY(y)));
  }
  // Yeşil dalga: ortak döngü (en kritik kavşak), doğuya giden akış için ofset = x / v
  const Cc = B.clamp(Math.max(...plans.map(p => p.C)), 50, 120), xmin = Math.min(...G.nodes.map(n => n.x));
  const T = K.YELLOW + K.ALLRED;
  const wave = G.nodes.map((n, i) => {
    const p = plans[i], Y = Math.max(1e-6, p.y[0] + p.y[1]), eff = Cc - 2 * T;
    const gEW = B.clamp(eff * p.y[1] / Y, K.MING, eff - K.MING), gNS = eff - gEW;
    return { C: Cc, G: [gNS, gEW], off: ((n.x - xmin) / VPROG) % Cc };
  });
  return { q, plans, wave, Cc };
}
function ctrlCoord(o) {
  const T = K.YELLOW + K.ALLRED;
  return { kind: 'coord', G: o.G, C: o.C, off: o.off, last: null, init() {}, onGreen() {},
    update(s) {
      const tc = (((s.t - this.off) % this.C) + this.C) % this.C, g0 = this.G[0], g1 = this.G[1];
      if (s.stateT < K.MING) return false;
      if (s.phase === 1) { if (tc >= g1) { this.last = { t: s.t, act: `Koordineli plan: B–D yeşili bitti (döngü ${Math.round(this.C)} s)` }; return true; } return false; }
      const inNS = tc >= g1 + T && tc < g1 + T + g0;
      if (!inNS) { this.last = { t: s.t, act: `Koordineli plan: K–G yeşili bitti, ofset ${Math.round(this.off)} s` }; return true; }
      return false;
    } };
}
function nodeCtrl(type, ctx, plan, wave) {
  if (type === 'webster') { const c = B.buildController('fixed', ctx); c.G = plan.G.slice(); return c; }
  if (type === 'greenwave') return ctrlCoord(wave);
  return B.buildController(type, ctx);
}

// ---------- Ağ simülasyonu ----------
class Net {
  constructor(def, seed, dem, type, ctx, opt) {
    opt = opt || {};
    const G = geometry(def);
    this.def = def; this.nodes = G.nodes; this.links = G.links; this.bounds = G.bounds;
    this.dem = dem; this.type = type; this.warm = opt.warm || 0; this.t = 0;
    this.entries = this.links.filter(l => l.entry);
    for (const lk of this.entries) lk.rng = B.mulberry32(((seed * 2654435761) >>> 0) + lk.id * 97531);
    this.plan = netPlan(G, dem);
    this.nodes.forEach((n, i) => { n.ctrl = nodeCtrl(type, ctx, this.plan.plans[i], this.plan.wave[i]); n.ctrl.init(n); });
    this.trips = 0; this.tripsAll = 0; this.sumDelay = 0; this.sumTT = 0; this.sumStops = 0; this.delays = [];
    this.eTrips = 0; this.eDelay = 0; this.eStops = 0;
    this.blocked = 0; this.maxQ = 0; this.sumQ = 0; this.nQ = 0; this.nextQ = 0;
  }
  chooseNext(c, lk) {
    const n = lk.to; if (!n) return null;
    const pL = this.dem.left / 100, pR = this.dem.right / 100, r = c.rng();
    let h = lk.head;
    if (c.hops < 8) { if (r < pL) h = LEFT[h]; else if (r < pL + pR) h = RIGHT[h]; }
    c.turn = h === lk.head ? 0 : h === LEFT[lk.head] ? -1 : 1; if (c.turn) c.east = false;
    return n.outLinks[h];
  }
  step(dt) {
    const t = this.t;
    for (const n of this.nodes) n.t = t;
    // varışlar ve giriş
    for (const lk of this.entries) {
      if (lk.rng() < entryRate(lk, this.dem, t) * dt) lk.pending.push({ tg: t, seed: (lk.rng() * 4294967296) >>> 0 });
      if (lk.pending.length) {
        const last = lk.cars[lk.cars.length - 1];
        if (!last || last.s >= K.JAM + 0.3) {
          const p = lk.pending.shift(), gap = last ? last.s - K.JAM : 1e9, v = Math.min(K.VMAX, Math.sqrt(2 * K.DEC * Math.max(0, gap)));
          const c = { s: 0, v, tg: p.tg, react: 0, stopped: v < 0.1, ep: -1, go: false, stops: v < 0.1 ? 1 : 0, dist: 0, hops: 0, rng: B.mulberry32(p.seed), next: null, turn: 0, fx: 0, fy: 0, east: lk.head === 2 };
          c.next = this.chooseNext(c, lk); lk.cars.push(c);
        }
      }
    }
    // hareket
    for (const lk of this.links) {
      const cars = lk.cars, node = lk.to, green = node ? (node.state === 'green' && PH[lk.head] === node.phase) : true;
      for (let k = 0; k < cars.length; k++) {
        const c = cars[k];
        let lim = k > 0 ? cars[k - 1].s - K.JAM : 1e9;
        if (node && c.s < lk.L) {
          if (!green) {
            if (c.ep !== node.epoch[lk.head]) { c.ep = node.epoch[lk.head]; c.go = (lk.L - c.s) < c.v * c.v / (2 * K.BMAX); }
            if (!c.go) lim = Math.min(lim, lk.L - 0.05);
          } else if (lk.L - c.s < 25) {
            const nl = c.next, tail = nl.cars[nl.cars.length - 1];
            if (tail && tail.s < K.JAM - BOXW + 0.5) { lim = Math.min(lim, lk.L - 0.05); if (c.v < 0.5 && t >= this.warm) this.blocked += dt; }
          }
        }
        const gap = lim - c.s; let v;
        if (gap <= 0.3) { v = 0; c.react = 0; }
        else if (c.stopped) { c.react += dt; if (c.react >= K.REACT - 1e-9) { c.stopped = false; c.react = 0; v = Math.min(K.ACC * dt, Math.sqrt(2 * K.DEC * gap)); } else v = 0; }
        else v = Math.min(c.v + K.ACC * dt, K.VMAX, Math.sqrt(2 * K.DEC * gap));
        if (v < 0.05) { v = 0; if (!c.stopped) { c.stopped = true; c.react = 0; c.stops++; } }
        c.s += Math.min((c.v + v) * 0.5 * dt, Math.max(0, gap)); c.v = v;
        if (node && c.s >= lk.L - K.DET - 1 && c.s - K.CARLEN <= lk.L - K.DET + 1) node.lastDet[lk.head] = t;
      }
    }
    // bağlantılar arası geçiş ve çıkış
    for (const lk of this.links) {
      const cars = lk.cars;
      while (cars.length && cars[0].s >= lk.L) {
        const c = cars.shift();
        if (!lk.to) { // ağdan çıkış
          c.dist += lk.L; this.tripsAll++;
          if (c.tg >= this.warm) { const tt = t + dt - c.tg, d = Math.max(0, tt - c.dist / K.VMAX); this.trips++; this.sumDelay += d; this.sumTT += tt; this.sumStops += c.stops; this.delays.push(d); if (c.east) { this.eTrips++; this.eDelay += d; this.eStops += c.stops; } }
          continue;
        }
        const u = HEAD[lk.head], rn = [-u[1], u[0]];
        c.fx = lk.x0 + u[0] * lk.L + rn[0] * K.LANEW / 2; c.fy = lk.y0 + u[1] * lk.L + rn[1] * K.LANEW / 2;
        c.dist += lk.L + BOXW;
        const nl = c.next, tail = nl.cars[nl.cars.length - 1];
        let ns = c.s - lk.L - BOXW; if (tail && ns > tail.s - K.JAM) ns = tail.s - K.JAM;
        c.s = ns; c.ep = -1; c.go = false; c.hops++;
        c.next = this.chooseNext(c, nl); nl.cars.push(c);
      }
    }
    if (t >= this.nextQ) { this.nextQ += 1; if (t >= this.warm) { const q = this.queued(); if (q > this.maxQ) this.maxQ = q; this.sumQ += q; this.nQ++; } }
    // sinyaller
    for (const n of this.nodes) {
      if (n.ctrl.tick) n.ctrl.tick(n, dt);
      n.stateT += dt;
      if (n.state === 'green') { if (n.ctrl.update(n)) { n.state = 'yellow'; n.stateT = 0; n.switches++; for (let i = 0; i < 4; i++) if (PH[i] === n.phase) n.epoch[i]++; } }
      else if (n.state === 'yellow') { if (n.stateT >= K.YELLOW - 1e-9) { n.state = 'allred'; n.stateT = 0; } }
      else if (n.stateT >= K.ALLRED - 1e-9) { n.state = 'green'; n.stateT = 0; n.phase = 1 - n.phase; n.ctrl.onGreen(n); }
    }
    this.t += dt;
  }
  queued() { let n = 0; for (const lk of this.links) { if (lk.entry) n += lk.pending.length; if (lk.to) for (const c of lk.cars) if (c.s < lk.L && c.v < 1.5) n++; } return n; }
  inNet() { let n = 0; for (const lk of this.links) { n += lk.cars.length; if (lk.entry) n += lk.pending.length; } return n; }
  avgDelay() {
    let tot = this.sumDelay, n = this.trips;
    for (const lk of this.links) {
      for (const c of lk.cars) if (c.tg >= this.warm) { tot += Math.max(0, this.t - c.tg - Math.max(0, c.dist + c.s) / K.VMAX); n++; }
      if (lk.entry) for (const p of lk.pending) if (p.tg >= this.warm) { tot += this.t - p.tg; n++; }
    }
    return n ? tot / n : 0;
  }
  metrics() {
    const span = Math.max(1, this.t - this.warm);
    return { delay: this.avgDelay(), p95: B.percentile(this.delays, 0.95), tt: this.trips ? this.sumTT / this.trips : 0, stops: this.trips ? this.sumStops / this.trips : 0,
      thru: this.trips / span * 3600, maxQ: this.maxQ, meanQ: this.nQ ? this.sumQ / this.nQ : 0, blocked: this.blocked / 60 / span * 3600, inNet: this.inNet(),
      eDelay: this.eTrips ? this.eDelay / this.eTrips : 0, eStops: this.eTrips ? this.eStops / this.eTrips : 0 };
  }
}
function demandFor(def, d) { return { main: d && d.main != null ? d.main : def.main, side: d && d.side != null ? d.side : def.side, left: d ? d.left : 15, right: d ? d.right : 15, profile: d ? d.profile : 'sabit', scale: d && d.scale || 1 }; }
function runNet(def, type, ctx, seed, dur, warm, dt, dem) {
  const net = new Net(def, seed, dem, type, ctx, { warm });
  const n = Math.round(dur / dt); for (let i = 0; i < n; i++) net.step(dt);
  return net.metrics();
}
// Ağ deneyi: ağ × denetleyici × tekrar
function* taskNetLab(cfg) {
  const { networks, controllers, reps, dur, warm, ctx, demand } = cfg, dt = cfg.dt || 0.1;
  const total = networks.length * controllers.length * reps; let done = 0; const res = {};
  for (const nid of networks) {
    const def = NETWORKS.find(n => n.id === nid), dem = demandFor(def, demand); res[nid] = {};
    for (const cid of controllers) {
      const runs = [];
      for (let r = 0; r < reps; r++) {
        runs.push(runNet(def, cid, ctx, 3000 + r * 23, dur, warm, dt, dem));
        done++; yield { progress: done / total, msg: `${def.short} · ${NET_CONTROLLERS.find(c => c.id === cid).short} · tekrar ${r + 1}/${reps}` };
      }
      res[nid][cid] = runs;
    }
  }
  return res;
}

Object.assign(B, { NETWORKS, NET_CONTROLLERS, HEAD, BOXW, Net, netGeometry: geometry, netPlan, demandFor, runNet, taskNetLab });
})(typeof self !== 'undefined' ? self : this);
