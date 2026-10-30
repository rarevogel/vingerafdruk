/* Vingerafdruk: growing the ridges.
   Start with a few random specks and filter them over and over with a Gabor filter that follows the local ridge
   direction and spacing (as in SFinGe, Cappelli, Maio and Maltoni). The specks grow into ridges; where two growing
   ridge systems meet out of step, ridge endings and bifurcations appear by themselves.
   Runs on the GPU with WebGL; a slower CPU version takes over when WebGL is missing. */
"use strict";

const Gabor = (() => {
  const ITER = 34;
  const VERT = "attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }";
  const STEP = `precision highp float;
uniform sampler2D state, field;
uniform vec2 size;
uniform float gain;
void main() {
  vec2 px = gl_FragCoord.xy;
  vec4 f = texture2D(field, px / size);
  float th = 0.5 * atan(f.g * 2.0 - 1.0, f.r * 2.0 - 1.0);
  float P = 4.0 + f.b * 16.0;
  vec2 t = vec2(cos(th), sin(th)), n = vec2(-t.y, t.x);
  float sn = P * 0.40, st = P * 0.55;
  float acc = 0.0, wsum = 0.0;
  for (int j = -6; j <= 6; j++) for (int i = -6; i <= 6; i++) {
    vec2 d = vec2(float(i), float(j));
    float a = dot(d, n), b = dot(d, t);
    float g = exp(-a * a / (2.0 * sn * sn) - b * b / (2.0 * st * st)) * cos(6.2831853 * a / P);
    acc += g * (texture2D(state, (px + d) / size).r * 2.0 - 1.0);
    wsum += abs(g);
  }
  float v = clamp(acc / wsum * gain, -1.0, 1.0);
  gl_FragColor = vec4(v * 0.5 + 0.5, 0.0, 0.0, 1.0);
}`;
  // shows the growing state while the GPU works (flipped, because GL rows run bottom-up)
  const SHOW = `precision mediump float;
uniform sampler2D state; uniform vec2 size;
void main() { vec2 uv = vec2(gl_FragCoord.x / size.x, 1.0 - gl_FragCoord.y / size.y); float v = texture2D(state, uv).r; gl_FragColor = vec4(vec3(1.0 - smoothstep(0.45, 0.7, v) * 0.85), 1.0); }`;

  let gl = null, progs = null, buf = null, cv = null;
  function initGL(canvas) {
    if (gl) return gl;
    cv = canvas;
    gl = canvas.getContext("webgl", { preserveDrawingBuffer: true, antialias: false }) || canvas.getContext("experimental-webgl");
    if (!gl) return null;
    const prog = (fs) => {
      const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
      const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      return p;
    };
    try {
      // some phones only offer mediump; then fall back to the CPU
      const hp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
      if (!hp || hp.precision < 16) throw new Error("geen highp");
      progs = { step: prog(STEP), show: prog(SHOW) };
    } catch (e) { gl = null; return null; }
    buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    return gl;
  }
  function tex(w, h, data) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    return t;
  }
  function draw(p) {
    const loc = gl.getAttribLocation(p, "p");
    gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // the starting specks
  function seeds(plan) {
    const r = plan.r, out = new Float32Array(W * H);
    const n = Math.round(plan.dens * W * H / 1500);
    for (let k = 0; k < n; k++) {
      const x = r.int(4, W - 5), y = r.int(4, H - 5), v = r() < 0.5 ? -1 : 1;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) out[(y + j) * W + x + i] = v;
    }
    for (let i = 0; i < out.length; i++) out[i] += (r() - 0.5) * 0.04 * plan.dens;
    return out;
  }

  // grows the ridges; onStep(k, total) is called as it goes. Returns Float32Array of -1..1 (ridge > 0)
  async function grow(plan, canvas, onStep) {
    const init = seeds(plan);
    if (canvas && initGL(canvas)) return growGPU(plan, init, onStep);
    return growCPU(plan, init, onStep);
  }
  async function growGPU(plan, init, onStep) {
    cv.width = W; cv.height = H;
    const fieldData = new Uint8Array(W * H * 4), st = new Uint8Array(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      fieldData[i * 4] = Math.round((plan.cos2[i] + 1) * 127.5);
      fieldData[i * 4 + 1] = Math.round((plan.sin2[i] + 1) * 127.5);
      fieldData[i * 4 + 2] = Math.round(Math.max(0, Math.min(1, (plan.period[i] - 4) / 16)) * 255);
      fieldData[i * 4 + 3] = 255;
      st[i * 4] = Math.round((Math.max(-1, Math.min(1, init[i])) + 1) * 127.5); st[i * 4 + 3] = 255;
    }
    const field = tex(W, H, fieldData);
    const t = [tex(W, H, st), tex(W, H, null)];
    const fb = gl.createFramebuffer();
    gl.viewport(0, 0, W, H);
    for (let k = 0; k < ITER; k++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t[1], 0);
      gl.useProgram(progs.step);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, t[0]);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, field);
      gl.uniform1i(gl.getUniformLocation(progs.step, "state"), 0);
      gl.uniform1i(gl.getUniformLocation(progs.step, "field"), 1);
      gl.uniform2f(gl.getUniformLocation(progs.step, "size"), W, H);
      gl.uniform1f(gl.getUniformLocation(progs.step, "gain"), k < 4 ? 6 : 3.2);
      draw(progs.step);
      t.reverse();
      if (k % 2 === 1 || k === ITER - 1) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.useProgram(progs.show);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, t[0]);
        gl.uniform1i(gl.getUniformLocation(progs.show, "state"), 0);
        gl.uniform2f(gl.getUniformLocation(progs.show, "size"), W, H);
        draw(progs.show);
        if (onStep) onStep(k + 1, ITER);
        await new Promise((r) => requestAnimationFrame(r));
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t[0], 0);
    const px = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteTexture(field); gl.deleteTexture(t[0]); gl.deleteTexture(t[1]); gl.deleteFramebuffer(fb);
    const out = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) out[i] = px[i * 4] / 127.5 - 1;
    return out;
  }

  // CPU: kernels for 24 directions and 9 spacings, made once
  let kernels = null;
  const NA = 24, PERIODS = [6.5, 7.3, 8.1, 8.9, 9.7, 10.5, 11.3, 12.1, 13], KR = 5;
  function makeKernels() {
    kernels = [];
    for (let a = 0; a < NA; a++) for (const P of PERIODS) {
      const th = (a / NA) * Math.PI, t = [Math.cos(th), Math.sin(th)], n = [-t[1], t[0]];
      const sn = P * 0.4, st = P * 0.55, k = new Float32Array((2 * KR + 1) ** 2);
      let s = 0;
      for (let j = -KR; j <= KR; j++) for (let i = -KR; i <= KR; i++) {
        const A = i * n[0] + j * n[1], B = i * t[0] + j * t[1];
        const g = Math.exp(-A * A / (2 * sn * sn) - B * B / (2 * st * st)) * Math.cos(2 * Math.PI * A / P);
        k[(j + KR) * (2 * KR + 1) + i + KR] = g; s += Math.abs(g);
      }
      for (let q = 0; q < k.length; q++) k[q] /= s;
      kernels.push(k);
    }
  }
  async function growCPU(plan, init, onStep) {
    if (!kernels) makeKernels();
    const idx = new Uint16Array(W * H);
    for (let i = 0; i < W * H; i++) {
      let th = 0.5 * Math.atan2(plan.sin2[i], plan.cos2[i]); if (th < 0) th += Math.PI;
      const a = Math.round(th / Math.PI * NA) % NA;
      let p = 0, best = 99; PERIODS.forEach((v, k) => { const d = Math.abs(v - plan.period[i]); if (d < best) { best = d; p = k; } });
      idx[i] = a * PERIODS.length + p;
    }
    let a = Float32Array.from(init), b = new Float32Array(W * H);
    const S = 2 * KR + 1, iters = 26;
    for (let k = 0; k < iters; k++) {
      const gain = k < 4 ? 6 : 3.2;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const ker = kernels[idx[y * W + x]];
        let acc = 0;
        for (let j = -KR; j <= KR; j++) {
          const yy = Math.min(H - 1, Math.max(0, y + j)) * W, kr = (j + KR) * S + KR;
          for (let i = -KR; i <= KR; i++) acc += ker[kr + i] * a[yy + Math.min(W - 1, Math.max(0, x + i))];
        }
        const v = acc * gain;
        b[y * W + x] = v > 1 ? 1 : v < -1 ? -1 : v;
      }
      [a, b] = [b, a];
      if (onStep) onStep(k + 1, iters, a);
      await new Promise((r) => setTimeout(r, 0));
    }
    return a;
  }
  return { grow, get gpu() { return !!gl; } };
})();
