// Renders android/res/drawable/icon.png from a generated whorl: node tools/icon.js
const { chromium } = require("playwright"), path = require("path"), fs = require("fs");
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
  const pg = await b.newPage();
  await pg.goto("file://" + path.join(__dirname, "..", "index.html"));
  await pg.waitForFunction(() => document.querySelector("#img canvas"), null, { timeout: 60000 });
  const url = await pg.evaluate(async () => {
    const res = await generate({ seed: 4242, pattern: "krul", hand: "rechts", finger: "duim", minutiae: "normaal" }, document.getElementById("grow"));
    const pic = paint(res.plan, res.v, res.an, "scanner", 2);
    const S = 512, c = document.createElement("canvas"); c.width = c.height = S;
    const x = c.getContext("2d");
    x.fillStyle = "#f3efe6"; x.beginPath(); x.roundRect(16, 16, S - 32, S - 32, 100); x.fill();
    x.save(); x.beginPath(); x.roundRect(16, 16, S - 32, S - 32, 100); x.clip();
    const cx = res.plan.cores[0].x * 2, cy = res.plan.cores[0].y * 2 + 30;
    x.globalCompositeOperation = "multiply";
    x.drawImage(pic, cx - 330, cy - 300, 660, 660, 0, 0, S, S);
    x.globalCompositeOperation = "screen"; x.fillStyle = "#8a2f2a"; x.fillRect(0, 0, S, S);
    x.restore();
    return c.toDataURL("image/png");
  });
  fs.writeFileSync(path.join(__dirname, "..", "android", "res", "drawable", "icon.png"), Buffer.from(url.split(",")[1], "base64"));
  await b.close();
})();
