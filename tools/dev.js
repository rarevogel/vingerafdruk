const { chromium } = require("playwright"), path = require("path");
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
  const pg = await b.newPage({ viewport: { width: 1250, height: 1070 } });
  pg.on("pageerror", (e) => console.log("ERR", e.message)); pg.on("console", (m) => console.log(m.text()));
  await pg.goto("file://" + path.join(__dirname, process.env.PAGE || "dev.html"));
  const t = Date.now();
  await pg.evaluate((a) => (window.run.length === 1 ? run(a) : run(a[0], a[1])), process.env.PAGE ? JSON.parse(process.argv[3]) : [JSON.parse(process.argv[3] || "[\"boog\",\"tentboog\",\"lusL\",\"lusR\",\"krul\",\"dubbel\"]"), +(process.argv[4] || 1)]);
  console.log("ms", Date.now() - t);
  await pg.screenshot({ path: process.argv[2], fullPage: true });
  await b.close();
})();
