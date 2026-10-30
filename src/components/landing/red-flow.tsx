"use client";

import { useEffect, useRef } from "react";

// Faint red smoke you can blow away. A small fluid on the GPU:
// - a wind texture: the pointer adds wind where it moves; wind carries itself along and dies down;
// - a smoke texture: carried by the wind plus a slow breeze to the right, and always easing back toward a faint
//   drifting smoke pattern (fbm noise, strongest along the bottom, calm behind the headline), so blown-out areas refill.
// Both run at low resolution; smoke is soft, so it looks the same and costs little.

const VERT = `#version 300 es
layout(location = 0) in vec2 p;
out vec2 uv;
void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

const NOISE = `
// A sin-free hash: sin() of large numbers differs between GPUs, which changed how much smoke each machine showed.
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int k = 0; k < 5; k++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}`;

// Wind: carried along by itself, fading, plus the pointer's push this frame.
const WIND = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 o;
uniform sampler2D wind;
uniform float aspect, dt;
uniform vec4 blow; // pointer position (xy, in units of the screen height) and velocity (zw, heights per second)
void main() {
  vec2 w = texture(wind, uv).xy;
  w = texture(wind, uv - w * dt * vec2(1.0 / aspect, 1.0)).xy * 0.975;
  vec2 d = vec2(uv.x * aspect, uv.y) - blow.xy;
  w += blow.zw * exp(-dot(d, d) * 70.0) * 0.5;
  o = vec4(w, 0.0, 1.0);
}`;

// Smoke: carried by the wind and the breeze, easing back toward the resting pattern.
const SMOKE = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 o;
uniform sampler2D smoke, wind;
uniform float aspect, dt, t, settle;
${NOISE}
float rest(vec2 pos) {
  vec2 q = vec2(fbm(pos * 1.3 + vec2(-t * 0.05, 0.0)), fbm(pos * 1.3 + vec2(5.2, 1.3) + vec2(-t * 0.035, t * 0.01)));
  float f = fbm(pos * 1.5 + 2.4 * q + vec2(-t * 0.07, t * 0.015));
  float v = smoothstep(0.56, 0.95, f) * 0.5;
  v *= mix(1.2, 0.35, smoothstep(0.0, 1.0, pos.y));
  vec2 c = uv - 0.5;
  c.x *= aspect;
  return v * mix(0.45, 1.0, smoothstep(0.1, 0.7, length(c * vec2(0.75, 1.5))));
}
void main() {
  vec2 w = texture(wind, uv).xy + vec2(0.03, 0.0);
  float s = texture(smoke, uv - w * dt * vec2(1.0 / aspect, 1.0)).r;
  o = vec4(mix(s, rest(vec2(uv.x * aspect, uv.y)), settle), 0.0, 0.0, 1.0);
}`;

const SHOW = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 o;
uniform sampler2D smoke;
uniform float t;
${NOISE}
void main() {
  float v = texture(smoke, uv).r;
  vec3 col = vec3(0.02, 0.02, 0.024);
  col = mix(col, vec3(0.3, 0.03, 0.02), smoothstep(0.0, 0.45, v));
  col = mix(col, vec3(0.72, 0.14, 0.1), smoothstep(0.4, 0.9, v));
  col += (hash(gl_FragCoord.xy + fract(t) * 100.0) - 0.5) * 0.01;
  o = vec4(col, 1.0);
}`;

const SIM_HEIGHT = 180;

type Target = { tex: WebGLTexture; fbo: WebGLFramebuffer };

export function RedFlow({ className }: { className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current!;
    const gl = el.getContext("webgl2", { antialias: false, alpha: false });
    if (!gl || !gl.getExtension("EXT_color_buffer_float")) return; // the page's own black ground shows instead

    const compile = (frag: string) => {
      const prog = gl.createProgram()!;
      for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, frag]] as const) {
        const s = gl.createShader(type)!;
        gl.shaderSource(s, src);
        gl.compileShader(s);
        gl.attachShader(prog, s);
      }
      gl.linkProgram(prog);
      return gl.getProgramParameter(prog, gl.LINK_STATUS) ? prog : null;
    };
    const wind = compile(WIND), smoke = compile(SMOKE), show = compile(SHOW);
    if (!wind || !smoke || !show) return;
    const u = (prog: WebGLProgram, name: string) => gl.getUniformLocation(prog, name);

    gl.bindVertexArray(gl.createVertexArray());
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // A pair of half-float targets per field, read from one while writing the other.
    const target = (w: number, h: number): Target => {
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return { tex, fbo };
    };
    let windA: Target, windB: Target, smokeA: Target, smokeB: Target;
    let simW = 0, aspect = 1, fresh = true;

    const size = () => {
      const scale = Math.min(window.devicePixelRatio, 2) * 0.5;
      el.width = Math.round(el.clientWidth * scale);
      el.height = Math.round(el.clientHeight * scale);
      aspect = el.clientWidth / Math.max(el.clientHeight, 1);
      simW = Math.max(1, Math.round(SIM_HEIGHT * aspect));
      [windA, windB, smokeA, smokeB] = [target(simW, SIM_HEIGHT), target(simW, SIM_HEIGHT), target(simW, SIM_HEIGHT), target(simW, SIM_HEIGHT)];
      fresh = true; // start the smoke at its resting pattern, not from black
    };
    size();
    window.addEventListener("resize", size);

    // The pointer, in units of the screen height from the bottom-left; compared frame to frame for its velocity.
    let pointer: { x: number; y: number } | null = null;
    let previous: { x: number; y: number } | null = null;
    const onPointer = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      pointer = { x: (e.clientX - rect.left) / rect.height, y: (rect.bottom - e.clientY) / rect.height };
    };
    window.addEventListener("pointermove", onPointer);

    const pass = (prog: WebGLProgram, out: Target | null, bind: Record<string, WebGLTexture>, set: (p: WebGLProgram) => void) => {
      gl.useProgram(prog);
      gl.bindFramebuffer(gl.FRAMEBUFFER, out ? out.fbo : null);
      gl.viewport(0, 0, out ? simW : el.width, out ? SIM_HEIGHT : el.height);
      Object.entries(bind).forEach(([name, tex], i) => {
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(u(prog, name), i);
      });
      set(prog);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t0 = performance.now() - 40_000; // start mid-drift
    let then = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      const dt = Math.min((now - then) / 1000, 1 / 30);
      then = now;
      const t = (now - t0) / 1000;

      let blow = [0, 0, 0, 0];
      if (pointer && previous && dt > 0) {
        let vx = (pointer.x - previous.x) / dt, vy = (pointer.y - previous.y) / dt;
        const speed = Math.hypot(vx, vy);
        if (speed > 4) { vx *= 4 / speed; vy *= 4 / speed; } // a flick blows hard, but does not tear the screen apart
        blow = [pointer.x, pointer.y, vx, vy];
      }
      previous = pointer;

      pass(wind, windB, { wind: windA.tex }, (p) => {
        gl.uniform1f(u(p, "aspect"), aspect);
        gl.uniform1f(u(p, "dt"), dt);
        gl.uniform4fv(u(p, "blow"), blow);
      });
      [windA, windB] = [windB, windA];
      pass(smoke, smokeB, { smoke: smokeA.tex, wind: windA.tex }, (p) => {
        gl.uniform1f(u(p, "aspect"), aspect);
        gl.uniform1f(u(p, "dt"), dt);
        gl.uniform1f(u(p, "t"), t);
        gl.uniform1f(u(p, "settle"), fresh ? 1 : 0.018); // blown-out smoke refills in about a second
      });
      [smokeA, smokeB] = [smokeB, smokeA];
      fresh = false;
      pass(show, null, { smoke: smokeA.tex }, (p) => gl.uniform1f(u(p, "t"), t));

      if (!still) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const onVisible = () => {
      cancelAnimationFrame(raf);
      then = performance.now();
      if (!document.hidden && !still) raf = requestAnimationFrame(frame);
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", size);
      window.removeEventListener("pointermove", onPointer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return <canvas ref={canvas} className={className} aria-hidden />;
}
