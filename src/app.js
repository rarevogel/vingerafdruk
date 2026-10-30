/* Vingerafdruk: the app. Makes a print, explains what is in it, shows overlays, saves PNGs and ten-print cards. */
"use strict";

const $ = (s) => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v; else if (k === "html") e.innerHTML = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, ""); else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
};
const Bridge = window.VAApp || null;
const MM = 25.4 / 500; // one pixel at 500 ppi, the usual resolution for fingerprints
const nl = (x, d = 1) => x.toLocaleString("nl-NL", { minimumFractionDigits: d, maximumFractionDigits: d });

/* ---------- settings ---------- */
const KEY = "vingerafdruk-instellingen";
const S = Object.assign({ pattern: "auto", hand: "auto", finger: "auto", style: "inkt", minutiae: "normaal", veld: false, singulier: true, minutiaeOv: true, telling: true },
  (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } })());
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* ignore */ } };

/* ---------- making a print ---------- */
let cur = null, busy = false;
// the growth leaves more forks than endings; real fingers have rather more endings, so cut some branches near their fork
function balance(plan, v, an) {
  const r = rng(plan.seed ^ 0x2545f491), out = Float32Array.from(v), P = plan.P0;
  for (const m of an.minutiae) {
    if (m.type !== "splitsing" || r() > 0.55) continue;
    const s = r() < 0.5 ? 1 : -1, a = m.angle + s * 0.55;
    const cx = m.x + Math.cos(a) * P * 0.85, cy = m.y + Math.sin(a) * P * 0.85, rad = P * 0.36;
    for (let y = Math.floor(cy - rad); y <= cy + rad; y++) for (let x = Math.floor(cx - rad); x <= cx + rad; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (d < rad) out[y * W + x] = Math.min(out[y * W + x], -0.6 * (1 - d / rad) - 0.2);
    }
  }
  return out;
}
async function generate(opts, growCanvas, onStep) {
  const plan = makePlan(opts);
  let v = await Gabor.grow(plan, growCanvas, onStep);
  let an = analyze(plan, v);
  v = balance(plan, v, an);
  an = analyze(plan, v);
  return { plan, v, an };
}
async function newPrint(seed) {
  if (busy) return;
  busy = true;
  $("#newBtn").disabled = true;
  const opts = { seed: seed ?? Math.floor(Math.random() * 999999) + 1, pattern: S.pattern, hand: S.hand, finger: S.finger, minutiae: S.minutiae };
  $("#seed").value = opts.seed;
  const grow = $("#grow");
  grow.hidden = false; $("#print").classList.add("growing");
  $("#status").textContent = "Riffen groeien…";
  try {
    const res = await generate(opts, grow, (k, n) => { $("#status").textContent = `Riffen groeien… ${Math.round(k / n * 100)}%`; });
    res.style = S.style;
    res.canvas = paint(res.plan, res.v, res.an, S.style);
    cur = res;
    showPrint();
    explain();
    $("#status").textContent = Gabor.gpu ? "" : "Gemaakt zonder grafische versnelling";
  } catch (e) { $("#status").textContent = "Mislukt: " + (e.message || e); }
  grow.hidden = true; $("#print").classList.remove("growing");
  busy = false;
  $("#newBtn").disabled = false;
}
function showPrint() {
  const holder = $("#img");
  holder.replaceChildren(cur.canvas);
  drawOverlays();
}
function drawOverlays() {
  if (!cur) return;
  overlays($("#ov"), cur.plan, cur.an, { veld: S.veld, singulier: S.singulier, minutiae: S.minutiaeOv, telling: S.telling });
}
function restyle(style) {
  S.style = style; save();
  if (!cur) return;
  cur.canvas = paint(cur.plan, cur.v, cur.an, style);
  cur.style = style;
  showPrint();
}

/* ---------- explanation ---------- */
const FINGER_NAME = { duim: "duim", wijsvinger: "wijsvinger", middelvinger: "middelvinger", ringvinger: "ringvinger", pink: "pink" };
const handName = (h) => (h === "rechts" ? "rechter" : "linker");
function patternTitle(p) {
  if (p.pattern === "lusL" || p.pattern === "lusR") return `Lus (${p.loopKind})`;
  return PATTERNS[p.pattern].name;
}
const TEXT = {
  boog: "De riffen komen aan de ene kant binnen, buigen in het midden een beetje omhoog en lopen aan de andere kant weer weg. Er is geen kern en geen delta. Bogen zijn het zeldzaamste patroon: ongeveer 5% van alle vingers.",
  tentboog: "Een boog waarvan de riffen in het midden steil omhoog worden geduwd, als door een tentstok. Bovenin zit een kern, vlak daaronder een delta. Tentbogen horen bij de bogen en zijn zeldzaam; je ziet ze het vaakst op wijsvingers.",
  lus: "Riffen komen aan één kant binnen, maken een haarspeldbocht om de kern en gaan aan dezelfde kant weer naar buiten. Er is één kern en één delta; de delta ligt aan de kant tegenover de opening. Lussen zijn het gewoonste patroon: ongeveer 60 tot 65% van alle vingers.",
  krul: "De riffen draaien in cirkels, ovalen of een spiraal rond het midden. Een krul heeft twee delta's, links en rechts onderin. Ongeveer 30 tot 35% van de vingers heeft een krul; op duimen en ringvingers zie je ze het vaakst.",
  dubbel: "Twee lussen die om elkaar heen draaien, zoals de twee helften van een yin-yangteken. Er zijn twee kernen en twee delta's. In de klassieke indeling (Henry) valt de dubbele lus onder de krullen.",
};
const MIN_TEXT = {
  einde: ["Rifeinde", "Een rif houdt gewoon op. Het streepje wijst de kant op waar de rif ophoudt."],
  splitsing: ["Splitsing", "Eén rif splitst zich in twee (bifurcatie). Het streepje wijst de kant op waar de vork opengaat."],
  punt: ["Punt", "Een stukje rif zo kort dat het een stip is."],
  "korte rif": ["Korte rif", "Een los, kort stukje rif tussen de andere riffen (ook wel eilandje)."],
  meertje: ["Meertje", "Een rif splitst zich en komt kort daarna weer samen. Het lege stukje ertussen heet een meertje (enclosure)."],
  kern: ["Kern", "Het binnenste punt van de binnenste bocht van het patroon. Vanaf hier wordt geteld en gemeten."],
  delta: ["Delta", "Hier komen riffen uit drie richtingen samen en ontstaat een driehoekje, zoals de Griekse letter Δ of een riviermonding."],
};
function explain() {
  const { plan, an } = cur, p = plan;
  const count = (t) => an.minutiae.filter((m) => m.type === t).length + an.islands.filter((m) => m.type === t).length + (t === "meertje" ? an.lakes.length : 0);
  const sections = [];
  const sec = (title, ...body) => sections.push(el("section", { class: "card" }, el("h2", {}, title), ...body));
  const fingerTxt = `${handName(p.hand)} ${FINGER_NAME[p.finger]}`;

  // pattern
  const grp = p.pattern === "lusL" || p.pattern === "lusR" ? "lus" : p.pattern;
  const pBody = [el("p", {}, TEXT[grp])];
  if (grp === "lus") {
    const side = p.pattern === "lusR" ? "rechts" : "links";
    pBody.push(el("p", {}, `Deze lus opent naar ${side}. Op een afdruk van de ${handName(p.hand)}hand ligt de pinkkant ${p.hand === "rechts" ? "rechts" : "links"}, dus dit is een `,
      el("b", {}, p.loopKind === "ulnair" ? "ulnaire lus" : "radiale lus"),
      p.loopKind === "ulnair" ? ": hij opent naar de pinkkant, waar de ellepijp (ulna) ligt. Dat is verreweg de gewoonste soort." : ": hij opent naar de duimkant, waar het spaakbeen (radius) ligt. Radiale lussen zijn zeldzaam en komen vooral voor op wijsvingers."));
  }
  sec(`${patternTitle(p)} · ${fingerTxt}`, ...pBody);

  // core and delta
  const cd = [];
  cd.push(el("p", {}, `Kernen: ${p.cores.length || "geen"}. Delta's: ${p.deltas.length || "geen"}. `, p.cores.length ? "De kern is het binnenste punt van het patroon, de delta het driehoekje waar riffen uit drie richtingen samenkomen." : "Een gewone boog heeft geen kern en geen delta; daarom is hij ook niet te tellen."));
  if (an.ridgeCounts.length && (grp === "lus" || grp === "krul" || grp === "dubbel")) {
    const rc = an.ridgeCounts.map((r) => r.count);
    cd.push(el("p", {}, grp === "lus"
      ? `Tussen kern en delta liggen ${rc[0]} riffen. Deze rijtelling (Galton) gebruikten politiediensten om lussen verder in te delen: je trekt een denkbeeldige lijn van delta naar kern en telt de riffen die hij kruist.`
      : `Rijtelling van de kern naar de linker- en rechterdelta: ${rc.join(" en ")} riffen. Bij krullen werd in de Henry-indeling vooral gekeken hoe de rif vanaf de linkerdelta langs de rechterdelta loopt (binnen, buiten of erlangs).`));
  } else if (grp === "tentboog") cd.push(el("p", {}, "Bij een tentboog liggen kern en delta vlak boven elkaar; er liggen (bijna) geen riffen tussen, dus een rijtelling heeft geen betekenis."));
  sec("Kern en delta", ...cd);

  // ridges
  const period = p.P0 * MM, perCm = 10 / period;
  const widthMM = (p.shape.a * 2) * MM, heightMM = (p.shape.bt + p.shape.bb) * MM;
  sec("Riffen",
    el("p", {}, `De riffen liggen gemiddeld ${nl(period, 2)} mm uit elkaar: zo'n ${Math.round(perCm)} riffen per centimeter. Bij volwassenen is dat meestal ongeveer 0,4 tot 0,5 mm; bij kinderen liggen ze dichter op elkaar. Rond de kern liggen ze in deze afdruk iets verder uit elkaar.`),
    el("p", {}, `Het afgedrukte deel is ongeveer ${nl(widthMM, 0)} bij ${nl(heightMM, 0)} mm (bij 500 ppi, de gangbare resolutie voor vingerafdrukken). Riffen zijn verhoogde huidlijsten; ze ontstaan voor de geboorte, rond de tiende tot zestiende week van de zwangerschap, en blijven daarna hetzelfde.`));

  // minutiae
  const rows = [["einde", count("einde")], ["splitsing", count("splitsing")], ["punt", count("punt")], ["korte rif", count("korte rif")], ["meertje", count("meertje")]];
  const total = rows.reduce((a, r) => a + r[1], 0);
  const table = el("table", { class: "mt" }, ...rows.map(([t, n]) => el("tr", {}, el("td", {}, el("span", { class: "sym " + t.replace(" ", "-") })), el("td", {}, MIN_TEXT[t][0]), el("td", {}, String(n)), el("td", { class: "mut" }, MIN_TEXT[t][1]))),
    el("tr", { class: "tot" }, el("td"), el("td", {}, "Totaal"), el("td", {}, String(total)), el("td")));
  sec("Minutiae",
    el("p", {}, "Minutiae zijn de plekken waar een rif ophoudt, splitst of iets anders doet. Patroon en rijtelling zeggen in welke groep een afdruk valt; de minutiae maken hem uniek. Zelfs eeneiige tweelingen hebben verschillende minutiae."),
    table,
    el("p", { class: "mut" }, "Rifeinden en splitsingen zijn veruit het gewoonst. Bij vergelijking kijkt een deskundige naar soort, plek en richting van de minutiae en hoe ze ten opzichte van elkaar liggen. Vroeger eisten veel landen een vast aantal overeenkomende punten (vaak twaalf); nu wordt meestal het geheel beoordeeld. Tik op een teken in de afdruk voor uitleg."));

  // pores
  const ridgeMM = an.skLen * MM;
  sec("Poriën",
    el("p", {}, `Op de riffen zitten ${an.pores.length} zweetporiën: gemiddeld één per ${nl(ridgeMM / Math.max(1, an.pores.length), 2)} mm rif. Ze zijn zichtbaar als witte stipjes in de inkt. Poriën, de vorm van de rifranden en kleine littekens heten het derde niveau van detail. De Franse criminoloog Edmond Locard vergeleek in 1912 al afdrukken op hun poriën (poroscopie); daarvoor is een scherpe afdruk met hoge resolutie nodig.`));

  sec("Over deze afdruk",
    el("p", {}, `Nummer ${p.seed}. Deze afdruk is door de app verzonnen en is van niemand. Eerst wordt een plan gemaakt: de vorm van de vingertop, het patroon met zijn kernen en delta's, de richting van de riffen (het model van Sherlock en Monro) en de rifafstand. Daarna groeien de riffen uit een paar willekeurige stipjes door ze telkens te filteren met een Gabor-filter dat de richting en afstand volgt; dat idee komt van het onderzoeksprogramma SFinGe. Waar twee groeiende rifsystemen elkaar ontmoeten, ontstaan vanzelf rifeinden en splitsingen. Tot slot zoekt de app de minutiae op zoals een programma voor vingerafdrukvergelijking dat doet.`),
    el("p", { class: "mut" }, "Met hetzelfde nummer en dezelfde instellingen krijg je dezelfde afdruk."));
  $("#explain").replaceChildren(...sections);
}

/* ---------- tapping a feature ---------- */
$("#ov").addEventListener("click", (e) => {
  const g = e.target.closest("[data-k]");
  if (!g || !cur) { $("#tip").hidden = true; return; }
  const k = g.dataset.k, kind = k[0], i = +k.slice(1);
  let item, type;
  if (kind === "m") { item = cur.an.minutiae[i]; type = item.type; }
  else if (kind === "i") { item = cur.an.islands[i]; type = item.type; }
  else if (kind === "l") { item = cur.an.lakes[i]; type = "meertje"; }
  else if (kind === "c") { item = cur.plan.cores[i]; type = "kern"; }
  else { item = cur.plan.deltas[i]; type = "delta"; }
  const [title, text] = MIN_TEXT[type];
  let extra = `Plaats: ${nl((item.x - W / 2) * MM, 1)} mm ${item.x < W / 2 ? "links" : "rechts"} van het midden, ${nl(Math.abs(item.y - H / 2) * MM, 1)} mm ${item.y < H / 2 ? "boven" : "onder"} het midden.`.replace("-", "");
  if (item.angle !== undefined) extra += ` Richting: ${Math.round(((-item.angle * 180 / Math.PI) % 360 + 360) % 360)}°.`;
  if (item.len && type === "korte rif") extra += ` Lengte: ${nl(item.len * MM, 1)} mm.`;
  const tip = $("#tip");
  tip.replaceChildren(el("b", {}, title), el("p", {}, text), el("p", { class: "mut" }, extra));
  tip.hidden = false;
  e.stopPropagation();
});
document.addEventListener("click", (e) => { if (!e.target.closest("#tip") && !e.target.closest("#ov [data-k]")) $("#tip").hidden = true; });

/* ---------- saving ---------- */
function saveCanvas(cv, name) {
  cv.toBlob(async (b) => {
    if (Bridge && Bridge.saveFile) {
      const bytes = new Uint8Array(await b.arrayBuffer());
      let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      Bridge.saveFile(name, "image/png", btoa(s));
      return;
    }
    const a = el("a", { href: URL.createObjectURL(b), download: name });
    document.body.append(a); a.click(); a.remove();
  }, "image/png");
}
window.onSaved = (ok) => toast(ok ? "Opgeslagen" : "Niet opgeslagen");
$("#saveBtn").onclick = () => {
  if (!cur) return;
  // with the overlays when they are on
  const cv = document.createElement("canvas");
  cv.width = cur.canvas.width; cv.height = cur.canvas.height;
  const ctx = cv.getContext("2d");
  ctx.drawImage(cur.canvas, 0, 0);
  const svg = $("#ov").cloneNode(true);
  svg.setAttribute("width", cv.width); svg.setAttribute("height", cv.height);
  const style = el("style"); style.textContent = OV_CSS; svg.prepend(style);
  svg.querySelectorAll(".hit").forEach((h) => h.remove());
  const img = new Image();
  img.onload = () => { ctx.drawImage(img, 0, 0, cv.width, cv.height); saveCanvas(cv, `vingerafdruk-${cur.plan.seed}.png`); };
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(svg));
};
let toastT = 0;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2600); }

/* ---------- ten-print card ---------- */
$("#cardBtn").onclick = async () => {
  if (busy) return;
  busy = true;
  const dlg = $("#card");
  const body = $("#cardBody");
  body.replaceChildren(el("p", { class: "mut", id: "cardStatus" }, "Tien afdrukken maken…"));
  dlg.showModal();
  const base = Math.floor(Math.random() * 99999) * 10 + 1;
  const SC = 0.62, bw = W * SC + 24, bh = H * SC + 54;
  const cv = document.createElement("canvas");
  cv.width = bw * 5 + 40; cv.height = bh * 2 + 130;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#f6f1e4"; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = "#222"; ctx.font = "600 26px 'IBM Plex Sans', sans-serif";
  ctx.fillText("Tienvingerkaart", 22, 42);
  ctx.font = "15px 'IBM Plex Sans', sans-serif"; ctx.fillStyle = "#555";
  ctx.fillText(`Verzonnen afdrukken, gemaakt door Vingerafdruk · nummers ${base} t/m ${base + 9}`, 22, 68);
  const list = [];
  let n = 0;
  for (const hand of ["rechts", "links"]) for (const finger of FINGERS) {
    const res = await generate({ seed: base + n, pattern: "auto", hand, finger, minutiae: S.minutiae }, $("#grow"));
    const pic = paint(res.plan, res.v, res.an, S.style, 1);
    const col = n % 5, row = Math.floor(n / 5), x = 20 + col * bw, y = 90 + row * bh;
    ctx.strokeStyle = "#333"; ctx.lineWidth = 1.5; ctx.strokeRect(x, y, bw - 8, bh - 8);
    ctx.fillStyle = "#222"; ctx.font = "600 15px 'IBM Plex Sans', sans-serif";
    ctx.fillText(`${n + 1}. ${hand === "rechts" ? "R" : "L"}. ${finger}`, x + 10, y + 22);
    ctx.drawImage(pic, x + 8, y + 30, W * SC, H * SC);
    ctx.fillStyle = "#555"; ctx.font = "13px 'IBM Plex Sans', sans-serif";
    ctx.fillText(patternTitle(res.plan), x + 10, y + bh - 16);
    list.push(res.plan);
    n++;
    $("#cardStatus").textContent = `Tien afdrukken maken… ${n}/10`;
  }
  const counts = {};
  for (const p of list) { const t = patternTitle(p).replace(/ \(.*/, ""); counts[t] = (counts[t] || 0) + 1; }
  cv.style.width = "100%";
  body.replaceChildren(cv, el("p", { class: "mut" }, "Op deze kaart: " + Object.entries(counts).map(([k, v]) => `${v}× ${k.toLowerCase()}`).join(", ") + ". Het patroon per vinger is gekozen met kansen die per vinger verschillen, zoals bij echte handen: lussen het meest, krullen vaak op duimen en ringvingers, bogen en radiale lussen vooral op wijsvingers."));
  $("#cardSave").onclick = () => saveCanvas(cv, `tienvingerkaart-${base}.png`);
  busy = false;
};
$("#cardClose").onclick = () => $("#card").close();

/* ---------- controls ---------- */
function chips(id, options, get, set) {
  const box = $(id);
  box.replaceChildren(...options.map(([v, label]) => el("button", { class: get() === v ? "on" : "", onclick: () => { set(v); save(); chips(id, options, get, set); } }, label)));
}
function selectBox(id, options, get, set) {
  const s = $(id);
  s.replaceChildren(...options.map(([v, label]) => el("option", { value: v, selected: get() === v }, label)));
  s.onchange = () => { set(s.value); save(); };
}
function buildControls() {
  selectBox("#patSel", [["auto", "Willekeurig (past bij de vinger)"], ["boog", "Boog"], ["tentboog", "Tentboog"], ["ulnair", "Lus, ulnair (naar de pink)"], ["radiaal", "Lus, radiaal (naar de duim)"], ["krul", "Krul"], ["dubbel", "Dubbele lus"]], () => S.pattern, (v) => (S.pattern = v));
  selectBox("#handSel", [["auto", "Elke hand"], ["rechts", "Rechterhand"], ["links", "Linkerhand"]], () => S.hand, (v) => (S.hand = v));
  selectBox("#fingerSel", [["auto", "Elke vinger"], ...FINGERS.map((f) => [f, f[0].toUpperCase() + f.slice(1)])], () => S.finger, (v) => (S.finger = v));
  chips("#styleChips", Object.entries(STYLES).map(([k, s]) => [k, s.name]), () => S.style, (v) => restyle(v));
  chips("#minChips", [["weinig", "Weinig"], ["normaal", "Normaal"], ["veel", "Veel"]], () => S.minutiae, (v) => (S.minutiae = v));
  const ov = $("#ovChips");
  const tog = (label, key) => el("button", { class: S[key] ? "on" : "", onclick: (e) => { S[key] = !S[key]; save(); e.currentTarget.classList.toggle("on", S[key]); drawOverlays(); } }, label);
  ov.replaceChildren(tog("Kern en delta", "singulier"), tog("Minutiae", "minutiaeOv"), tog("Rijtelling", "telling"), tog("Richting van de riffen", "veld"));
}
$("#newBtn").onclick = () => newPrint();
$("#seedGo").onclick = () => { const n = parseInt($("#seed").value, 10); if (n > 0) newPrint(n); };
$("#seed").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#seedGo").click(); });
window.atlasBack = () => {
  if ($("#card").open) { $("#card").close(); return true; }
  if (!$("#tip").hidden) { $("#tip").hidden = true; return true; }
  return false;
};

let OV_CSS = "";
(async () => {
  OV_CSS = [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules]; } catch (e) { return []; } }).map((r) => r.cssText).filter((t) => /\.ov-|\.m |\.hit|\.einde|\.splitsing|\.eiland|\.meer|\.kern|\.delta/.test(t)).join("\n");
  buildControls();
  await new Promise((r) => requestAnimationFrame(r));
  newPrint();
})();
