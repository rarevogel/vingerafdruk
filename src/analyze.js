/* Vingerafdruk: reading the finished print like an examiner would.
   Thins the ridges to one-pixel lines (Zhang-Suen), finds minutiae with the crossing number (1 = ridge ending,
   3 = bifurcation), removes the usual false ones (spurs, bridges, broken ridges), recognises dots, short ridges and
   enclosures, counts the ridges between core and delta, and places sweat pores along the ridges. */
"use strict";

function analyze(plan, v) {
  const N = W * H, inside = new Uint8Array(N), bin = new Uint8Array(N);
  for (let i = 0; i < N; i++) { inside[i] = plan.rad[i] < 0.97 ? 1 : 0; bin[i] = inside[i] && v[i] > 0 ? 1 : 0; }
  // distance (in pixels, roughly) from the edge of the print, to ignore minutiae made by the cut-off border
  const edge = new Float32Array(N);
  for (let i = 0; i < N; i++) { const r = plan.rad[i]; edge[i] = (1 - r) * 160; }

  /* ---------- thinning ---------- */
  const sk = bin.slice();
  const at = (a, x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : a[y * W + x]);
  let changed = true, guard = 0;
  const del = [];
  while (changed && guard++ < 40) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      del.length = 0;
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (!sk[i]) continue;
        const p2 = sk[i - W], p3 = sk[i - W + 1], p4 = sk[i + 1], p5 = sk[i + W + 1], p6 = sk[i + W], p7 = sk[i + W - 1], p8 = sk[i - 1], p9 = sk[i - W - 1];
        const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (B < 2 || B > 6) continue;
        const A = (!p2 && p3) + (!p3 && p4) + (!p4 && p5) + (!p5 && p6) + (!p6 && p7) + (!p7 && p8) + (!p8 && p9) + (!p9 && p2);
        if (A !== 1) continue;
        if (pass === 0 ? (p2 * p4 * p6 || p4 * p6 * p8) : (p2 * p4 * p8 || p2 * p6 * p8)) continue;
        del.push(i);
      }
      if (del.length) { changed = true; for (const i of del) sk[i] = 0; }
    }
  }

  /* ---------- crossing number ---------- */
  const NB = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
  const cn = (x, y) => { let c = 0; for (let k = 0; k < 8; k++) { const a = at(sk, x + NB[k][0], y + NB[k][1]), b = at(sk, x + NB[(k + 1) % 8][0], y + NB[(k + 1) % 8][1]); if (!a && b) c++; } return c; };
  const nbrs = (x, y) => { const o = []; for (const [dx, dy] of NB) if (at(sk, x + dx, y + dy)) o.push([x + dx, y + dy]); return o; };
  let raw = [];
  const dots = [];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    if (!sk[i]) continue;
    const c = cn(x, y);
    if (c === 1 || c === 3) raw.push({ x, y, type: c === 1 ? "einde" : "splitsing", edge: edge[i] });
    else if (c === 0 && edge[i] > 14 && !nbrs(x, y).length) dots.push({ x, y, type: "punt", len: 1 });
  }
  // follows the skeleton from (x,y) for up to n steps; returns the path
  function trace(x, y, n, avoid) {
    const path = [[x, y]], seen = new Set([y * W + x]);
    if (avoid) for (const a of avoid) seen.add(a);
    let cx = x, cy = y;
    for (let s = 0; s < n; s++) {
      const next = nbrs(cx, cy).filter(([a, b]) => !seen.has(b * W + a));
      if (next.length !== 1) { path.stop = next.length ? "splitsing" : "einde"; break; }
      [cx, cy] = next[0]; seen.add(cy * W + cx); path.push([cx, cy]);
    }
    return path;
  }
  const key = (m) => m.y * W + m.x;
  const byKey = new Map(raw.map((m) => [key(m), m]));
  const drop = new Set();
  const P = plan.P0;
  // spurs: an ending that reaches a bifurcation within a short distance
  for (const m of raw) if (m.type === "einde") {
    const p = trace(m.x, m.y, Math.round(P * 0.9));
    const end = p[p.length - 1];
    if (p.stop === "splitsing" || cn(end[0], end[1]) === 3) {
      drop.add(key(m));
      for (const [dx, dy] of [[0, 0], ...NB]) { const k = (end[1] + dy) * W + end[0] + dx; if (byKey.has(k) && byKey.get(k).type === "splitsing") drop.add(k); }
    }
  }
  // bridges and skeleton knots: bifurcations that sit almost on top of each other
  const bif = raw.filter((m) => m.type === "splitsing");
  for (let i = 0; i < bif.length; i++) for (let j = i + 1; j < bif.length; j++) if (Math.hypot(bif[i].x - bif[j].x, bif[i].y - bif[j].y) < P * 0.45) { drop.add(key(bif[i])); drop.add(key(bif[j])); }
  // short pieces of ridge: dots and short ridges (both ends within a short trace)
  const islands = dots.slice();
  const seenIsland = new Set();
  for (const m of raw) if (m.type === "einde" && !drop.has(key(m)) && !seenIsland.has(key(m))) {
    const p = trace(m.x, m.y, Math.round(P * 3.2));
    if (p.stop === "einde") {
      const e = p[p.length - 1], k2 = e[1] * W + e[0];
      seenIsland.add(key(m)); seenIsland.add(k2);
      drop.add(key(m)); drop.add(k2);
      const len = p.length, mid = p[Math.floor(len / 2)];
      if (m.edge > P * 1.5) islands.push({ x: mid[0], y: mid[1], type: len < P * 0.9 ? "punt" : "korte rif", len, path: p });
    }
  }
  let minutiae = raw.filter((m) => !drop.has(key(m)) && m.edge > P * 1.6);
  // ridge breaks: two endings facing each other a short distance apart are one interrupted ridge, not two endings
  const ends = minutiae.filter((m) => m.type === "einde");
  const brk = new Set();
  for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) if (Math.hypot(ends[i].x - ends[j].x, ends[i].y - ends[j].y) < P * 0.55) { brk.add(ends[i]); brk.add(ends[j]); }
  minutiae = minutiae.filter((m) => !brk.has(m));
  // direction: along the ridge, pointing away from the ridge for endings
  for (const m of minutiae) {
    let th = 0.5 * Math.atan2(plan.sin2[key(m)], plan.cos2[key(m)]);
    if (m.type === "einde") {
      const p = trace(m.x, m.y, 8), e = p[p.length - 1];
      if (p.length > 3) th = Math.atan2(m.y - e[1], m.x - e[0]);
    } else {
      // the direction in which the fork opens
      const branches = nbrs(m.x, m.y).map(([a, b]) => trace(a, b, 8, [key(m)])).filter((p) => p.length > 3).map((p) => { const e = p[p.length - 1]; return Math.atan2(e[1] - m.y, e[0] - m.x); });
      if (branches.length >= 2) {
        // the stem is the branch most opposite the other two; the fork opens away from the stem
        let best = 0, bs = -9;
        branches.forEach((a, k) => { let s = 0; branches.forEach((b, l) => { if (l !== k) s -= Math.cos(a - b); }); if (s > bs) { bs = s; best = k; } });
        th = branches[best] + Math.PI;
      }
    }
    m.angle = th;
  }
  // enclosures (lakes): small valleys completely surrounded by ridge
  const lakes = [];
  const lab = new Int32Array(N);
  let id = 0;
  for (let i = 0; i < N; i++) {
    if (!inside[i] || bin[i] || lab[i]) continue;
    id++;
    const st = [i]; lab[i] = id;
    let n = 0, sx = 0, sy = 0, open = false;
    while (st.length) {
      const k = st.pop(), x = k % W, y = (k - x) / W;
      n++; sx += x; sy += y;
      if (edge[k] < P * 1.2) open = true;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) { open = true; continue; }
        const q = yy * W + xx;
        if (!inside[q]) { open = true; continue; }
        if (!bin[q] && !lab[q]) { lab[q] = id; st.push(q); }
      }
      if (n > 4000) open = true;
    }
    if (!open && n < P * P * 3.5 && n > 6) lakes.push({ x: sx / n, y: sy / n, type: "meertje", area: n });
  }
  // a lake leaves two bifurcations on the skeleton; leave those out so they are not counted twice
  for (const l of lakes) minutiae = minutiae.filter((m) => !(m.type === "splitsing" && Math.hypot(m.x - l.x, m.y - l.y) < P * 1.1));

  /* ---------- ridge count between core and delta (Galton) ---------- */
  const counts = [];
  for (const c of plan.cores) for (const d of plan.deltas) {
    const n = Math.ceil(Math.hypot(d.x - c.x, d.y - c.y));
    let cnt = 0, prev = null, run = 0;
    for (let s = 0; s <= n; s++) {
      const x = Math.round(c.x + (d.x - c.x) * s / n), y = Math.round(c.y + (d.y - c.y) * s / n);
      const b = at(bin, x, y);
      if (b === prev) run++; else { if (prev === 1 && run >= 2 && s > 3) cnt++; prev = b; run = 1; }
    }
    counts.push({ core: c, delta: d, count: Math.max(0, cnt - 1) });
  }
  // for loops only one count matters: the nearest core to the delta
  const ridgeCounts = plan.pattern === "krul" || plan.pattern === "dubbel" ? counts.filter((c, k, all) => all.filter((o) => o.delta === c.delta).every((o) => Math.hypot(o.core.x - o.delta.x, o.core.y - o.delta.y) >= Math.hypot(c.core.x - c.delta.x, c.core.y - c.delta.y))) : counts;

  /* ---------- sweat pores along the ridges ---------- */
  const pores = [];
  const r = rng(plan.seed ^ 0x5bd1e995);
  let skLen = 0;
  for (let y = 2; y < H - 2; y += 1) for (let x = 2; x < W - 2; x++) {
    const i = y * W + x;
    if (!sk[i] || edge[i] < 6) continue;
    skLen++;
    if (r() < 1 / 13) pores.push({ x: x + (r() - 0.5) * 0.8, y: y + (r() - 0.5) * 0.8, s: 0.7 + r() * 0.6 });
  }
  // thin out pores that crowd together
  const kept = [];
  const grid = new Map();
  for (const p of pores) {
    const gx = Math.floor(p.x / 6), gy = Math.floor(p.y / 6);
    let ok = true;
    for (let j = -1; j <= 1 && ok; j++) for (let i = -1; i <= 1 && ok; i++) for (const q of grid.get((gx + i) + "," + (gy + j)) || []) if (Math.hypot(q.x - p.x, q.y - p.y) < 6) { ok = false; break; }
    if (ok) { kept.push(p); const k = gx + "," + gy; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(p); }
  }

  // ridge spacing measured on the finished print: ridges crossed per unit length along many short lines
  let area = 0; for (let i = 0; i < N; i++) area += inside[i];
  const ridgeArea = bin.reduce((a, b) => a + b, 0);
  return { bin, sk, minutiae, islands, lakes, ridgeCounts, pores: kept, skLen, area, ridgeArea };
}
