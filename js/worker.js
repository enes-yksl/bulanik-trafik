/* Ağır hesaplamalar (toplu deney, duyarlılık, GA, Q-öğrenme) arayüzü dondurmadan burada çalışır. */
const V = (self.location.search.match(/v=([^&]+)/) || [])[1] || '';
importScripts('engine.js?v=' + V, 'net.js?v=' + V);
self.onmessage = (e) => {
  const { id, task, cfg } = e.data;
  if (cfg && cfg.ctx) {
    if (cfg.ctx.Q && !(cfg.ctx.Q instanceof Float64Array)) cfg.ctx.Q = Float64Array.from(cfg.ctx.Q);
  }
  const gen = { lab: BT.taskLab, sens: BT.taskSens, ga: BT.taskGA, q: BT.taskQ, netlab: BT.taskNetLab }[task](cfg);
  let last = 0;
  try {
    for (;;) {
      const r = gen.next();
      if (r.done) { self.postMessage({ id, done: true, result: r.value }); break; }
      const now = Date.now();
      if (now - last > 80 || r.value.hist || r.value.curve) { last = now; self.postMessage({ id, progress: r.value }); }
    }
  } catch (err) { self.postMessage({ id, error: String(err && err.message || err) }); }
};
