/* Vingerafdruk: the plan of a fingerprint before any ridge exists.
   Shape of the fingertip, the pattern class with its cores and deltas, the ridge orientation field (the zero-pole
   model of Sherlock and Monro, bent along the fingertip at the top) and the ridge spacing. */
"use strict";

const W = 400, H = 520;

// small seeded random generator (mulberry32), so a number always gives the same print
function rng(seed) {
  let a = seed >>> 0;
  const r = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  r.range = (lo, hi) => lo + (hi - lo) * r();
  r.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * r());
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  r.gauss = () => { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  return r;
}

// smooth value noise on a coarse grid, bicubic-ish (smoothstep) interpolation, values about -1..1
function noiseField(r, cell, w = W, h = H) {
  const gw = Math.ceil(w / cell) + 2, gh = Math.ceil(h / cell) + 2, g = new Float32Array(gw * gh);
  for (let i = 0; i < g.length; i++) g[i] = r() * 2 - 1;
  const s = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = x / cell, fy = y / cell, ix = Math.floor(fx), iy = Math.floor(fy), tx = s(fx - ix), ty = s(fy - iy);
    const at = (i, j) => g[Math.min(gh - 1, Math.max(0, j)) * gw + Math.min(gw - 1, Math.max(0, i))];
    const a = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * tx;
    const b = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * tx;
    return a + (b - a) * ty;
  };
}

const PATTERNS = {
  boog: { name: "Boog", group: "boog" },
  tentboog: { name: "Tentboog", group: "boog" },
  lusL: { name: "Lus (opent naar links)", group: "lus" },
  lusR: { name: "Lus (opent naar rechts)", group: "lus" },
  krul: { name: "Krul", group: "krul" },
  dubbel: { name: "Dubbele lus", group: "krul" },
};
const FINGERS = ["duim", "wijsvinger", "middelvinger", "ringvinger", "pink"];
// rough chances per finger used by this app: [arch, tented arch, ulnar loop, radial loop, whorl, double loop]
const FINGER_ODDS = {
  duim: [0.03, 0.01, 0.5, 0.02, 0.34, 0.1],
  wijsvinger: [0.08, 0.07, 0.3, 0.17, 0.3, 0.08],
  middelvinger: [0.05, 0.02, 0.65, 0.02, 0.22, 0.04],
  ringvinger: [0.02, 0.01, 0.48, 0.01, 0.42, 0.06],
  pink: [0.01, 0.01, 0.82, 0.01, 0.13, 0.02],
};
// on the print of a right hand the little-finger side is on the right, so an ulnar loop opens to the right
const loopFor = (hand, kind) => ((hand === "rechts") === (kind === "ulnair") ? "lusR" : "lusL");
function pickPattern(r, hand, finger) {
  const odds = FINGER_ODDS[finger], keys = ["boog", "tentboog", "ulnair", "radiaal", "krul", "dubbel"];
  let x = r() * odds.reduce((a, b) => a + b, 0), k = 0;
  while (x > odds[k] && k < odds.length - 1) x -= odds[k++];
  const key = keys[k];
  return key === "ulnair" || key === "radiaal" ? { pattern: loopFor(hand, key), loopKind: key } : { pattern: key, loopKind: null };
}

/* Builds the plan. opts: { seed, pattern (or "auto"), hand, finger, minutiae: "weinig"|"normaal"|"veel" } */
function makePlan(opts) {
  const r = rng(opts.seed);
  const hand = opts.hand === "auto" ? r.pick(["links", "rechts"]) : opts.hand;
  const finger = opts.finger === "auto" ? r.pick(FINGERS) : opts.finger;
  let pattern = opts.pattern, loopKind = null;
  if (pattern === "auto") ({ pattern, loopKind } = pickPattern(r, hand, finger));
  else if (pattern === "ulnair" || pattern === "radiaal") { loopKind = pattern; pattern = loopFor(hand, loopKind); }
  else if (pattern === "lusL" || pattern === "lusR") loopKind = (pattern === "lusR") === (hand === "rechts") ? "ulnair" : "radiaal";

  // fingertip outline: rounder at the top, flatter towards the first joint
  const cx = W / 2 + r.range(-8, 8), cy = H * 0.53 + r.range(-6, 6);
  const shape = { cx, cy, a: r.range(150, 172), bt: r.range(212, 240), bb: r.range(175, 205), nt: r.range(2.0, 2.4), nb: r.range(2.8, 3.8) };
  const rad = (x, y) => { const dx = Math.abs(x - shape.cx) / shape.a, dy = y - shape.cy; const b = dy < 0 ? shape.bt : shape.bb, n = dy < 0 ? shape.nt : shape.nb; return Math.pow(Math.pow(dx, n) + Math.pow(Math.abs(dy) / b, n), 1 / n); };

  // singular points
  const cores = [], deltas = [];
  const P = (dx, dy) => ({ x: cx + dx, y: cy + dy });
  if (pattern === "tentboog") {
    const c = P(r.range(-15, 15), r.range(-25, 5));
    cores.push(c); deltas.push({ x: c.x + r.range(-8, 8), y: c.y + r.range(55, 80) });
  } else if (pattern === "lusL" || pattern === "lusR") {
    const s = pattern === "lusR" ? -1 : 1; // the delta lies on the side opposite to the opening
    const c = P(r.range(-18, 18) - s * 15, r.range(-45, -5));
    cores.push(c); deltas.push({ x: c.x + s * r.range(95, 135), y: c.y + r.range(85, 125) });
  } else if (pattern === "krul") {
    const c = P(r.range(-12, 12), r.range(-35, -10));
    cores.push(c, { x: c.x + r.range(-10, 10), y: c.y + r.range(16, 28) });
    deltas.push(P(-r.range(110, 135), r.range(75, 110)), P(r.range(110, 135), r.range(75, 110)));
  } else if (pattern === "dubbel") {
    const s = r() < 0.5 ? 1 : -1, c = P(r.range(-10, 10), r.range(-30, -10)), d = r.range(26, 36);
    cores.push({ x: c.x - s * d * 0.8, y: c.y - d * 0.6 }, { x: c.x + s * d * 0.8, y: c.y + d * 0.6 });
    deltas.push(P(-r.range(110, 135), r.range(80, 115)), P(r.range(110, 135), r.range(80, 115)));
  }

  // orientation field, stored as doubled-angle vectors (cos 2θ, sin 2θ)
  const n1 = noiseField(r, 90), n2 = noiseField(r, 140), n3 = noiseField(r, 70);
  const archA = r.range(55, 85), archW = r.range(95, 130), archY = cy + r.range(-10, 40);
  const cos2 = new Float32Array(W * H), sin2 = new Float32Array(W * H), period = new Float32Array(W * H), mask = new Float32Array(W * H);
  const P0 = r.range(8.4, 10.2);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    let th;
    if (!cores.length) {
      // plain arch: the flow lines are bumps y = c - A exp(-x²/w²), highest in the middle of the finger
      const dx = x - cx, A = archA * Math.exp(-Math.pow((y - archY) / 170, 2));
      th = Math.atan(2 * A * dx / (archW * archW) * Math.exp(-dx * dx / (archW * archW)));
    } else {
      th = 0;
      for (const c of cores) th += 0.5 * Math.atan2(y - c.y, x - c.x);
      for (const d of deltas) th -= 0.5 * Math.atan2(y - d.y, x - d.x);
    }
    th += 0.1 * n1(x, y) + 0.05 * n3(x, y);
    let c2 = Math.cos(2 * th), s2 = Math.sin(2 * th);
    // near the top and sides the ridges follow the round fingertip
    const dx = x - cx, dy = y - cy, rr = rad(x, y);
    const up = Math.min(1, Math.max(0, (-dy / shape.bt + 0.15) / 0.5));
    const wgt = up * Math.min(1, Math.max(0, (rr - 0.5) / 0.4));
    if (wgt > 0) {
      const b = shape.bt, ph = Math.atan2(-dx / (shape.a * shape.a), dy / (b * b));
      const tc = Math.cos(2 * ph), ts = Math.sin(2 * ph);
      c2 = c2 * (1 - wgt) + tc * wgt; s2 = s2 * (1 - wgt) + ts * wgt;
      const l = Math.hypot(c2, s2) || 1; c2 /= l; s2 /= l;
    }
    cos2[i] = c2; sin2[i] = s2;
    // ridge spacing: slightly wider around the core, a little variation everywhere
    let p = P0 + 0.7 * n2(x, y);
    for (const c of cores) p += 0.8 * Math.exp(-((x - c.x) ** 2 + (y - c.y) ** 2) / (2 * 70 * 70));
    period[i] = Math.max(6.5, Math.min(13, p));
    mask[i] = rr;
  }
  const dens = { weinig: 0.6, normaal: 1, veel: 1.8 }[opts.minutiae || "normaal"];
  return { seed: opts.seed, hand, finger, pattern, loopKind, shape, cores, deltas, cos2, sin2, period, rad: mask, P0, dens, r };
}
if (typeof module !== "undefined") module.exports = { W, H, rng, makePlan, PATTERNS, FINGERS, FINGER_ODDS };
