// Playwright walk-through: node tools/uitest.js <outdir> [phone]
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..", "android", "assets"), out = process.argv[2] || ".";
const srv = http.createServer((q, r) => { let u = decodeURIComponent(q.url.split("?")[0]); if (u === "/") u = "/index.html"; fs.readFile(path.join(root, u), (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { "content-type": u.endsWith(".html") ? "text/html" : u.endsWith(".css") ? "text/css" : "font/woff2" }); r.end(d); } }); }).listen(8769);
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
  const phone = process.argv[3] === "phone";
  const pg = await b.newPage({ viewport: phone ? { width: 412, height: 900 } : { width: 1280, height: 800 }, deviceScaleFactor: 2, acceptDownloads: true });
  const errs = []; pg.on("pageerror", (e) => errs.push(e.message)); pg.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  await pg.goto("http://localhost:8769/");
  await pg.waitForFunction(() => document.querySelector("#img canvas"), null, { timeout: 60000 });
  await pg.waitForTimeout(500);
  await pg.screenshot({ path: out + "/v1.png" });
  await pg.screenshot({ path: out + "/v1full.png", fullPage: true });
  if (process.argv[3] === "phone") { console.log("errors:", errs); await b.close(); srv.close(); return; }
  // tap a minutia
  await pg.evaluate(() => { const g = document.querySelector("#ov .m.splitsing .hit"); g && g.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await pg.waitForTimeout(200);
  console.log("tip:", await pg.textContent("#tip"));
  // whorl in powder with orientation field
  await pg.selectOption("#patSel", "krul"); await pg.click('#styleChips button:text-is("Poeder (sporen)")'); await pg.click('#ovChips button:text-is("Richting van de riffen")');
  await pg.click("#newBtn"); await pg.waitForFunction(() => !document.querySelector("#newBtn").disabled, null, { timeout: 60000 }); await pg.waitForTimeout(300);
  await pg.screenshot({ path: out + "/v2.png" });
  await pg.click('#ovChips button:text-is("Richting van de riffen")'); await pg.selectOption("#patSel", "auto"); await pg.click('#styleChips button:text-is("Inkt op kaart")');
  // reproducible
  const seedA = await pg.inputValue("#seed");
  const [dl] = await Promise.all([pg.waitForEvent("download"), pg.click("#saveBtn")]);
  await dl.saveAs(out + "/save.png");
  // ten-print card
  await pg.click("#cardBtn");
  await pg.waitForFunction(() => document.querySelector("#cardBody canvas"), null, { timeout: 240000 });
  await pg.waitForTimeout(300);
  await pg.screenshot({ path: out + "/v3card.png" });
  console.log("card:", await pg.textContent("#cardBody p"));
  console.log("errors:", errs); await b.close(); srv.close();
})();
