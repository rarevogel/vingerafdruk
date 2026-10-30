/* Vingerafdruk: making the ridges look like a real print (ink on a card, a live scanner, or dusted powder)
   and drawing the overlays that explain it. Rendered at twice the working size for smooth ridge edges. */
"use strict";

const STYLES = {
  inkt: { name: "Inkt op kaart" },
  scanner: { name: "Scanner" },
  poeder: { name: "Poeder (sporen)" },
};

function paint(plan, v, an, style, scale = 2) {
  const OW = W * scale, OH = H * scale;
  const cv = document.createElement("canvas");
  cv.width = OW; cv.height = OH;
  const ctx = cv.getContext("2d");
  const img = ctx.createImageData(OW, OH), d = img.data;
  const r = rng(plan.seed * 7 + 3);
  const nPress = noiseFieldR(r, 70), nEdge = noiseFieldR(r, 22), nInk = noiseFieldR(r, 5), nBlot = noiseFieldR(r, 26), nPaper = noiseFieldR(r, 3);
  const bil = (a, x, y) => {
    const x0 = Math.max(0, Math.min(W - 2, Math.floor(x))), y0 = Math.max(0, Math.min(H - 2, Math.floor(y))), tx = Math.min(1, Math.max(0, x - x0)), ty = Math.min(1, Math.max(0, y - y0)), i = y0 * W + x0;
    return (a[i] * (1 - tx) + a[i + 1] * tx) * (1 - ty) + (a[i + W] * (1 - tx) + a[i + W + 1] * tx) * ty;
  };
  const ss = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  // pores as a small stamp map
  const poreMap = new Float32Array(OW * OH);
  for (const p of an.pores) {
    const px = p.x * scale + scale / 2, py = p.y * scale + scale / 2, rad = (style === "scanner" ? 1.0 : 1.25) * p.s * scale * 0.75;
    for (let y = Math.floor(py - rad - 1); y <= py + rad + 1; y++) for (let x = Math.floor(px - rad - 1); x <= px + rad + 1; x++) {
      if (x < 0 || y < 0 || x >= OW || y >= OH) continue;
      const k = 1 - ss(rad - 0.7, rad + 0.7, Math.hypot(x - px, y - py));
      if (k > poreMap[y * OW + x]) poreMap[y * OW + x] = k;
    }
  }
  for (let y = 0; y < OH; y++) for (let x = 0; x < OW; x++) {
    const sx = (x + 0.5) / scale - 0.5, sy = (y + 0.5) / scale - 0.5;
    const val = bil(v, sx, sy), rr = bil(plan.rad, sx, sy);
    // pressure: firm in the middle, lighter towards the edge, with patches
    const press = 0.6 + 0.32 * (1 - Math.pow(Math.min(1, rr), 3)) + 0.2 * nPress(sx, sy);
    const thr = 0.22 - 0.6 * (press - 0.6);
    let cov = ss(thr - 0.2, thr + 0.2, val);
    const e = ss(1.0 + 0.03 * nEdge(sx, sy), 0.86 + 0.05 * nEdge(sx * 1.7, sy * 1.7), rr);
    cov *= e * (1 - poreMap[y * OW + x] * 0.9);
    let R, G, B;
    if (style === "scanner") {
      const k = Math.pow(cov, 0.9) * (0.9 + 0.1 * press);
      R = G = B = 250 - 232 * k;
    } else if (style === "poeder") {
      const grain = 0.55 + 0.45 * (nInk(sx * 3.1, sy * 3.1) * 0.5 + 0.5);
      const smear = 0.75 + 0.25 * nBlot(sx, sy);
      const k = cov * grain * smear;
      const bg = 34 + 6 * nPaper(sx, sy);
      const speck = nInk(sx * 5.3 + 99, sy * 5.3) > 0.82 ? 0.25 * e : 0;
      R = bg + (226 - bg) * Math.min(1, k + speck); G = bg + 2 + (220 - bg) * Math.min(1, k + speck); B = bg + 8 + (204 - bg) * Math.min(1, k + speck);
    } else {
      const ink = 0.78 + 0.22 * (nInk(sx, sy) * 0.5 + 0.5);
      const blot = nBlot(sx, sy) > 0.55 ? 0.15 : 0;
      const k = Math.min(1, cov * ink + blot * cov);
      const pr = 244 + 5 * nPaper(sx, sy), pg = 239 + 5 * nPaper(sx, sy), pb = 226 + 5 * nPaper(sx, sy);
      R = pr + (24 - pr) * k; G = pg + (24 - pg) * k; B = pb + (34 - pb) * k;
    }
    const o = (y * OW + x) * 4;
    d[o] = R; d[o + 1] = G; d[o + 2] = B; d[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  if (style !== "scanner") { ctx.filter = "blur(0.6px)"; ctx.drawImage(cv, 0, 0); ctx.filter = "none"; }
  return cv;
}
function noiseFieldR(r, cell) {
  const gw = Math.ceil(W / cell) * 6 + 4, gh = Math.ceil(H / cell) * 6 + 4, g = new Float32Array(gw * gh);
  for (let i = 0; i < g.length; i++) g[i] = r() * 2 - 1;
  const s = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = Math.abs(x) / cell, fy = Math.abs(y) / cell, ix = Math.floor(fx), iy = Math.floor(fy), tx = s(fx - ix), ty = s(fy - iy);
    const at = (i, j) => g[(j % gh) * gw + (i % gw)];
    const a = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * tx, b = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * tx;
    return a + (b - a) * ty;
  };
}

/* ---------- overlays (SVG in print coordinates) ---------- */
const NS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
function overlays(svg, plan, an, show) {
  svg.replaceChildren();
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  if (show.veld) {
    const g = svgEl("g", { class: "ov-veld" });
    for (let y = 10; y < H; y += 18) for (let x = 10; x < W; x += 18) {
      const i = y * W + x;
      if (plan.rad[i] > 0.97) continue;
      const th = 0.5 * Math.atan2(plan.sin2[i], plan.cos2[i]), c = Math.cos(th) * 6, s = Math.sin(th) * 6;
      g.append(svgEl("line", { x1: x - c, y1: y - s, x2: x + c, y2: y + s }));
    }
    svg.append(g);
  }
  if (show.telling) for (const rc of an.ridgeCounts) {
    const g = svgEl("g", { class: "ov-tel" });
    g.append(svgEl("line", { x1: rc.core.x, y1: rc.core.y, x2: rc.delta.x, y2: rc.delta.y }));
    const mx = (rc.core.x + rc.delta.x) / 2, my = (rc.core.y + rc.delta.y) / 2;
    g.append(svgEl("rect", { x: mx - 13, y: my - 10, width: 26, height: 20, rx: 6 }));
    const t = svgEl("text", { x: mx, y: my + 5 }); t.textContent = rc.count; g.append(t);
    svg.append(g);
  }
  if (show.minutiae) {
    const g = svgEl("g", { class: "ov-min" });
    an.minutiae.forEach((m, k) => {
      const tx = m.x + Math.cos(m.angle) * 11, ty = m.y + Math.sin(m.angle) * 11;
      const a = svgEl("g", { class: "m " + (m.type === "einde" ? "einde" : "splitsing"), "data-k": "m" + k });
      a.append(svgEl("line", { x1: m.x, y1: m.y, x2: tx, y2: ty }));
      a.append(m.type === "einde" ? svgEl("circle", { cx: m.x, cy: m.y, r: 4.2 }) : svgEl("rect", { x: m.x - 4, y: m.y - 4, width: 8, height: 8 }));
      a.append(svgEl("circle", { cx: m.x, cy: m.y, r: 11, class: "hit" }));
      g.append(a);
    });
    an.islands.forEach((m, k) => { const a = svgEl("g", { class: "m eiland", "data-k": "i" + k }); a.append(svgEl("path", { d: `M${m.x} ${m.y - 6} L${m.x + 6} ${m.y} L${m.x} ${m.y + 6} L${m.x - 6} ${m.y} Z` })); a.append(svgEl("circle", { cx: m.x, cy: m.y, r: 11, class: "hit" })); g.append(a); });
    an.lakes.forEach((m, k) => { const a = svgEl("g", { class: "m meer", "data-k": "l" + k }); a.append(svgEl("ellipse", { cx: m.x, cy: m.y, rx: 7, ry: 7 })); a.append(svgEl("circle", { cx: m.x, cy: m.y, r: 11, class: "hit" })); g.append(a); });
    svg.append(g);
  }
  if (show.singulier) {
    const g = svgEl("g", { class: "ov-sing" });
    plan.cores.forEach((c, k) => { const a = svgEl("g", { class: "m kern", "data-k": "c" + k }); a.append(svgEl("circle", { cx: c.x, cy: c.y, r: 9 })); a.append(svgEl("circle", { cx: c.x, cy: c.y, r: 2.2, class: "dot" })); a.append(svgEl("circle", { cx: c.x, cy: c.y, r: 14, class: "hit" })); g.append(a); });
    plan.deltas.forEach((dl, k) => { const a = svgEl("g", { class: "m delta", "data-k": "d" + k }); a.append(svgEl("path", { d: `M${dl.x} ${dl.y - 10} L${dl.x + 9} ${dl.y + 6} L${dl.x - 9} ${dl.y + 6} Z` })); a.append(svgEl("circle", { cx: dl.x, cy: dl.y, r: 14, class: "hit" })); g.append(a); });
    svg.append(g);
  }
}
