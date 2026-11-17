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
const OPP = [1, 0, 3, 2];                          // karşı yaklaşım
const TC_LEFT = 4.5;                               // s, sinyalli kavşakta izinli sola dönüş kritik aralığı (HCM)
const POCKET = 30, PCAP = 4;                       // m ve araç, sinyalli kavşakta sola dönüş cebi
// Dönel kavşak (göbekli): tek şeritli halka, saat yönünün tersine dolaşım (sağdan trafik)
const RB = { R: 9, ISLAND: 5.2, V: 8, TC: 4.2, TF: 2.2 };   // halka yarıçapı (m), göbek yarıçapı, halka hızı (m/s), kritik aralık ve takip aralığı (s)
RB.P = 2 * Math.PI * RB.R; RB.DEL = Math.asin((K.LANEW / 2) / RB.R);
const ARM_IN = [Math.PI / 2, 3 * Math.PI / 2, Math.PI, 0];   // yaklaşım i'nin kolu (matematik açısı, kuzey yukarı)
const ARM_OUT = [3 * Math.PI / 2, Math.PI / 2, 0, Math.PI];  // çıkış yönü h'nin kolu
const mod = (a, m) => ((a % m) + m) % m;
const rbEntry = i => mod(ARM_IN[i] + RB.DEL, 2 * Math.PI) * RB.R;
const rbExit = h => mod(ARM_OUT[h] - RB.DEL, 2 * Math.PI) * RB.R;

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
  { id: 'qlearn', name: 'Q-öğrenme', short: 'Q-öğrenme' },
  { id: 'roundabout', name: 'Dönel kavşak (göbekli)', short: 'Dönel' }
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
    this.epoch = [0, 0, 0, 0]; this.lastDet = [-1e9, -1e9, -1e9, -1e9]; this.lastThru = [-1e9, -1e9, -1e9, -1e9]; this.switches = 0; this.ctrl = null;
    this.kind = 'signal'; this.ring = []; this.lastEnt = [-1e9, -1e9, -1e9, -1e9];
  }
  count(i) { const lk = this.inLinks[i]; let n = lk.entry ? lk.pending.length : 0; const cs = lk.cars;
    for (let k = cs.length - 1; k >= 0; k--) { const s = cs[k].s; if (s >= lk.L) break; if (s > lk.L - ZONE) n++; } return n; }
  phaseCount(p) { let m = 0; for (let i = 0; i < 4; i++) if (PH[i] === p) { const c = this.count(i); if (c > m) m = c; } return m; }
  queued() { let n = 0; for (let i = 0; i < 4; i++) { const lk = this.inLinks[i]; if (lk.entry) n += lk.pending.length; for (const c of lk.cars) if (c.s < lk.L && c.s > lk.L - ZONE && c.v < 1.5) n++; } return n; }
  sig(i) { if (this.kind === 'round') return 'none'; if (PH[i] !== this.phase) return 'red'; return this.state === 'green' ? 'green' : this.state === 'yellow' ? 'yellow' : 'red'; }
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
  if (type === 'roundabout') return { kind: 'round', last: null, init() {}, onGreen() {}, update() { return false; } };
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
    this.nodes.forEach((n, i) => { n.ctrl = nodeCtrl(type, ctx, this.plan.plans[i], this.plan.wave[i]); n.ctrl.init(n); if (type === 'roundabout') n.kind = 'round'; });
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
  // Sinyalli kavşak: sola dönen araç karşı yönden gelen düz/sağa dönen trafiğe yol verir
  leftBlocked(node, lk, t) {
    const o = OPP[lk.head]; if (t - node.lastThru[o] < 2.0) return true;
    const ol = node.inLinks[o];
    for (let k = 0; k < ol.cars.length; k++) { const c2 = ol.cars[k]; if (c2.s >= ol.L) continue;
      const d = ol.L - c2.s; if (d > 80) break;
      if (c2.pocket) continue;                       // karşı cepte bekleyen sola dönen akışı engellemez
      if (c2.turn === -1) break;                     // cebe giremeyen sola dönen, arkasındakileri tutar
      if (d < 8 || (c2.v > 1 && d / c2.v < TC_LEFT)) return true; }
    return false;
  }
  // Dönel kavşak: girişte halkadaki araca yol ver (kritik aralık) ve halkada yer olsun
  oppMoving(node, lk) { const ol = node.inLinks[OPP[lk.head]];
    for (const c2 of ol.cars) { if (c2.s >= ol.L || c2.pocket) continue; const d = ol.L - c2.s; if (d > 30) break; if (c2.v > 1) return true; } return false; }
  gapOK(node, i, c) {
    if (this.t - node.lastEnt[i] < RB.TF) return false;   // ardışık girişler arası takip aralığı
    const pe = rbEntry(i);
    if (node.ring.length >= Math.floor(RB.P / K.JAM) - 1) return false;
    for (const c of node.ring) {
      const ahead = mod(c.p - pe, RB.P); if (ahead < K.JAM + 0.5) return false;
      const du = mod(pe - c.p, RB.P); if (du < c.rem && du / Math.max(c.v, 2) < RB.TC) return false;
    }
    return true;
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
          const c = { s: 0, v, tg: p.tg, react: 0, stopped: v < 0.1, ep: -1, go: false, stops: v < 0.1 ? 1 : 0, dist: 0, hops: 0, rng: B.mulberry32(p.seed), next: null, turn: 0, fx: 0, fy: 0, fh: -1, east: lk.head === 2, pocket: false, inRing: false, p: 0, rem: 0, nv: 0, ds: 0, ringLen: 0 };
          c.next = this.chooseNext(c, lk); lk.cars.push(c);
        }
      }
    }
    // hareket
    for (const lk of this.links) {
      const cars = lk.cars, node = lk.to, green = node ? (node.state === 'green' && PH[lk.head] === node.phase) : true;
      const sig = node && node.kind === 'signal';
      let lastMain = 1e9, lastPocket = 1e9, nPocket = 0;
      for (let k = 0; k < cars.length; k++) {
        const c = cars[k];
        if (sig && !c.pocket && c.turn === -1 && lk.L - c.s < POCKET && nPocket < PCAP && lastPocket - c.s >= K.JAM - 0.5) c.pocket = true;
        let lim = (c.pocket ? lastPocket : Math.min(lastMain, c.turn === -1 && lk.L - c.s < POCKET + 2 ? lastPocket : 1e9)) - K.JAM;
        if (!sig && k > 0) lim = cars[k - 1].s - K.JAM;
        const pocketFront = c.pocket && nPocket === 0;
        let vmx = K.VMAX;
        if (node && c.s < lk.L) {
          const dl = lk.L - c.s;
          if (node.kind === 'round') {
            if (dl < 35) vmx = RB.V + (K.VMAX - RB.V) * dl / 35;           // girişe yaklaşırken yavaşla
            if (k === 0 && dl < 20 && !this.gapOK(node, lk.head, c)) lim = Math.min(lim, lk.L - 0.05);
          } else if (!green) {
            if (c.ep !== node.epoch[lk.head]) { c.ep = node.epoch[lk.head]; c.go = dl < c.v * c.v / (2 * K.BMAX); }
            // sarıda cepteki ilk araç, karşı akım durmuşsa dönüşünü tamamlar
            if (!c.go && pocketFront && dl < 2 && node.state === 'yellow' && PH[lk.head] === node.phase && !this.oppMoving(node, lk)) c.go = true;
            if (!c.go) lim = Math.min(lim, lk.L - 0.05);
          } else if (dl < 25) {
            const nl = c.next, tail = nl.cars[nl.cars.length - 1];
            if (tail && tail.s < K.JAM - BOXW + 0.5) { lim = Math.min(lim, lk.L - 0.05); if (c.v < 0.5 && t >= this.warm) this.blocked += dt; }
            else if (c.turn === -1 && (c.pocket ? pocketFront : lastMain > 1e8 && lastPocket > 1e8) && this.leftBlocked(node, lk, t)) { lim = Math.min(lim, lk.L - 0.05); if (dl < 15) vmx = Math.min(vmx, 6); }
            else if (c.turn !== 0) vmx = Math.min(vmx, 7 + dl * 0.3);      // dönüşte yavaşla
          }
        }
        const gap = lim - c.s; let v;
        if (gap <= 0.3) { v = 0; c.react = 0; }
        else if (c.stopped) { c.react += dt; if (c.react >= K.REACT - 1e-9) { c.stopped = false; c.react = 0; v = Math.min(K.ACC * dt, Math.sqrt(2 * K.DEC * gap)); } else v = 0; }
        else { let vt = Math.min(c.v + K.ACC * dt, K.VMAX); if (vt > vmx) vt = Math.max(vmx, c.v - K.DEC * dt); v = Math.min(vt, Math.sqrt(2 * K.DEC * gap)); }
        if (v < 0.05) { v = 0; if (!c.stopped) { c.stopped = true; c.react = 0; c.stops++; } }
        c.s += Math.min((c.v + v) * 0.5 * dt, Math.max(0, gap)); c.v = v;
        if (node && c.s >= lk.L - K.DET - 1 && c.s - K.CARLEN <= lk.L - K.DET + 1) node.lastDet[lk.head] = t;
        if (c.pocket) { lastPocket = c.s; nPocket++; } else lastMain = c.s;
      }
      if (sig && nPocket) { for (let k = 1; k < cars.length; k++) if (cars[k].s > cars[k - 1].s) { cars.sort((a, b) => b.s - a.s); break; } }
    }
    // dönel kavşak halkaları
    const ringOut = [];
    for (const n of this.nodes) {
      if (n.kind !== 'round' || !n.ring.length) continue;
      const ring = n.ring;
      for (const c of ring) {
        let gl = 1e9;
        for (const o of ring) if (o !== c) { const d = mod(o.p - c.p, RB.P); if (d > 0.01 && d - K.JAM < gl) gl = d - K.JAM; }
        const nl = c.next, tail = nl.cars[nl.cars.length - 1];
        let gap = gl;
        if (tail && tail.s < K.JAM) { gap = Math.min(gap, c.rem - 0.05); if (c.v < 0.5 && t >= this.warm) this.blocked += dt; }
        let v;
        if (gap <= 0.3) { v = 0; c.react = 0; }
        else if (c.stopped) { c.react += dt; if (c.react >= K.REACT - 1e-9) { c.stopped = false; c.react = 0; v = Math.min(K.ACC * dt, Math.sqrt(2 * K.DEC * gap)); } else v = 0; }
        else v = Math.min(c.v + K.ACC * dt, RB.V, Math.sqrt(2 * K.DEC * gap));
        if (v < 0.05) { v = 0; if (!c.stopped) { c.stopped = true; c.react = 0; c.stops++; } }
        c.nv = v; c.ds = Math.min((c.v + v) * 0.5 * dt, Math.max(0, gap));
      }
      for (let k = ring.length - 1; k >= 0; k--) {
        const c = ring[k]; c.v = c.nv; c.p = mod(c.p + c.ds, RB.P); c.rem -= c.ds;
        if (c.rem <= 0) { ring.splice(k, 1); ringOut.push([n, c]); }
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
        const node = lk.to;
        if (node.kind === 'round') { // halkaya gir
          c.dist += lk.L; c.inRing = true;
          c.p = mod(rbEntry(lk.head) + (c.s - lk.L), RB.P); c.rem = mod(rbExit(c.next.head) - c.p, RB.P); if (c.rem < 1) c.rem += RB.P;
          c.ringLen = c.rem + (K.BOX - RB.R) * 2; c.v = Math.min(c.v, RB.V); c.ep = -1; c.go = false;
          c.pocket = false; node.lastEnt[lk.head] = t; node.ring.push(c); continue;
        }
        const u = HEAD[lk.head], rn = [-u[1], u[0]];
        c.fx = lk.x0 + u[0] * lk.L + rn[0] * K.LANEW / 2; c.fy = lk.y0 + u[1] * lk.L + rn[1] * K.LANEW / 2; c.fh = lk.head;
        if (c.turn !== -1) node.lastThru[lk.head] = t;
        c.dist += lk.L + BOXW;
        const nl = c.next, tail = nl.cars[nl.cars.length - 1];
        let ns = c.s - lk.L - BOXW; if (tail && ns > tail.s - K.JAM) ns = tail.s - K.JAM;
        c.s = ns; c.ep = -1; c.go = false; c.hops++; c.pocket = false;
        c.next = this.chooseNext(c, nl); nl.cars.push(c);
      }
    }
    for (const [n, c] of ringOut) { // halkadan çık
      const nl = c.next, tail = nl.cars[nl.cars.length - 1];
      c.dist += c.ringLen; c.inRing = false; c.hops++;
      let ns = Math.min(-c.rem, 2); if (tail && ns > tail.s - K.JAM) ns = tail.s - K.JAM;
      c.s = ns; c.fh = -1; c.next = this.chooseNext(c, nl); nl.cars.push(c);
    }
    if (t >= this.nextQ) { this.nextQ += 1; if (t >= this.warm) { const q = this.queued(); if (q > this.maxQ) this.maxQ = q; this.sumQ += q; this.nQ++; } }
    // sinyaller
    for (const n of this.nodes) {
      if (n.kind === 'round') continue;
      if (n.ctrl.tick) n.ctrl.tick(n, dt);
      n.stateT += dt;
      if (n.state === 'green') { if (n.ctrl.update(n)) { n.state = 'yellow'; n.stateT = 0; n.switches++; for (let i = 0; i < 4; i++) if (PH[i] === n.phase) n.epoch[i]++; } }
      else if (n.state === 'yellow') { if (n.stateT >= K.YELLOW - 1e-9) { n.state = 'allred'; n.stateT = 0; } }
      else if (n.stateT >= K.ALLRED - 1e-9) { n.state = 'green'; n.stateT = 0; n.phase = 1 - n.phase; n.ctrl.onGreen(n); }
    }
    this.t += dt;
  }
  queued() { let n = 0; for (const lk of this.links) { if (lk.entry) n += lk.pending.length; if (lk.to) for (const c of lk.cars) if (c.s < lk.L && c.v < 1.5) n++; } return n; }
  inNet() { let n = 0; for (const lk of this.links) { n += lk.cars.length; if (lk.entry) n += lk.pending.length; } for (const nd of this.nodes) n += nd.ring.length; return n; }
  avgDelay() {
    let tot = this.sumDelay, n = this.trips;
    for (const lk of this.links) {
      for (const c of lk.cars) if (c.tg >= this.warm) { tot += Math.max(0, this.t - c.tg - Math.max(0, c.dist + c.s) / K.VMAX); n++; }
      if (lk.entry) for (const p of lk.pending) if (p.tg >= this.warm) { tot += this.t - p.tg; n++; }
    }
    for (const nd of this.nodes) for (const c of nd.ring) if (c.tg >= this.warm) { tot += Math.max(0, this.t - c.tg - c.dist / K.VMAX); n++; }
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

Object.assign(B, { NETWORKS, NET_CONTROLLERS, HEAD, BOXW, RB, ARM_IN, ARM_OUT, Net, netGeometry: geometry, netPlan, demandFor, runNet, taskNetLab });
})(typeof self !== 'undefined' ? self : this);
