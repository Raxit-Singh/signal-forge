"use client";

import { useEffect, useRef } from "react";

// Backgrounds for the public pages other than the landing. They keep the eclipse's language (a quiet ground, thin red
// light, signals that travel, a pointer that brightens what it's near) but each says its own thing:
// Each product page has its own:
//   pulse    smart monitoring: mentions being heard, rings spreading through a field of dots
//   clusters feedback intelligence: scattered mentions gather into issues; the biggest is lit
//   orbits   competitor tracking: your product at the centre, competitors around it, mentions flying in
//   chart    buzz analytics: a volume line running past, its spikes lit red
//   trace    a signal follows a branching path from the feedback to its cause (unused for now)
//   mcp      Claude: Claude calls the Heardex connector's tools; requests go out red, answers come back
//   lines   docs and policies: ruled lines, a red reading light running along them
//   threads blog: conversations, threads drifting across with signals running along them
//   venn    alternatives: two products side by side, lit red where they overlap
// Colours come from the page's tokens (--ink, --red), so the same scene works in dark and light.

export type SkyKind = "pulse" | "clusters" | "orbits" | "chart" | "trace" | "mcp" | "lines" | "threads" | "venn";

type RGB = [number, number, number];
type Pointer = { x: number; y: number } | null;
type Ctx = { ctx: CanvasRenderingContext2D; w: number; h: number; t: number; p: Pointer; ink: RGB; red: RGB; light: boolean };
type Scene = (c: Ctx) => void;

const rgba = ([r, g, b]: RGB, a: number) => `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, a))})`;
const gauss = (d: number, s: number) => Math.exp(-(d * d) / (s * s));
const ease = (v: number) => 1 - (1 - Math.min(Math.max(v, 0), 1)) ** 3;
const smooth = (a: number, b: number, v: number) => { const x = Math.min(Math.max((v - a) / (b - a), 0), 1); return x * x * (3 - 2 * x); };
/** A repeatable random number in [0,1) for an integer, so scenes that scroll stay the same where they've been. */
const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
/** A soft dot of light. */
function glowAt(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, c: RGB, a: number) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(c, a));
  g.addColorStop(1, rgba(c, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}
function parse(v: string, fallback: RGB): RGB {
  const s = v.trim();
  const m = /^#?([0-9a-f]{6})$/i.exec(s);
  if (m) { const n = parseInt(m[1]!, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  const r = /rgba?\(([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/.exec(s);
  return r ? [Number(r[1]), Number(r[2]), Number(r[3])] : fallback;
}

/** Rings spread from where a mention was heard; the dots they pass flare red. The pointer starts rings too. */
function pulse(): Scene {
  const rings: Array<{ x: number; y: number; at: number }> = [];
  let next = 0.4, lastPointer = -1;
  const GAP = 26, SPEED = 170, LIFE = 3.4;
  return ({ ctx, w, h, t, p, ink, red, light }) => {
    const enter = ease(t / 1.2);
    if (t > next) {
      // Heard on the right side, mostly, away from the title.
      rings.push({ x: w * (0.45 + Math.random() * 0.5), y: h * (0.15 + Math.random() * 0.7), at: t });
      next = t + 1.1 + Math.random() * 0.9;
    }
    if (p && t - lastPointer > 0.8) { rings.push({ x: p.x, y: p.y, at: t }); lastPointer = t; }
    while (rings.length && t - rings[0]!.at > LIFE) rings.shift();

    // A low red light, like the landing's horizon, where the rings are heard.
    const air = ctx.createRadialGradient(w * 0.72, h * 1.05, 0, w * 0.72, h * 1.05, Math.max(w * 0.55, h));
    air.addColorStop(0, rgba(red, (light ? 0.12 : 0.18) * enter));
    air.addColorStop(1, rgba(red, 0));
    ctx.fillStyle = air;
    ctx.fillRect(0, 0, w, h);

    const base = light ? 0.3 : 0.26;
    for (let y = GAP / 2; y < h; y += GAP) {
      for (let x = GAP / 2; x < w; x += GAP) {
        const fade = gauss(x - w * 0.7, w * 0.55) * gauss(y - h * 0.45, h * 0.75);
        let heat = 0;
        for (const r of rings) {
          const age = t - r.at;
          const d = Math.hypot(x - r.x, y - r.y);
          heat = Math.max(heat, gauss(d - age * SPEED, 22) * (1 - age / LIFE) ** 0.7);
        }
        if (p) heat = Math.max(heat, 0.5 * gauss(Math.hypot(x - p.x, y - p.y), 70));
        const a = (base * fade + heat) * enter;
        if (a < 0.01) continue;
        ctx.fillStyle = heat > 0.08 ? rgba(red, a) : rgba(ink, a);
        const s = 1.6 + heat * 2;
        ctx.fillRect(x - s / 2, y - s / 2, s, s);
      }
    }
    // Where each ring began, a small flash.
    for (const r of rings) {
      const age = t - r.at;
      const a = Math.max(0, 1 - age / 0.9) * enter;
      if (a <= 0) continue;
      const g = ctx.createRadialGradient(r.x, r.y, 0, r.x, r.y, 26);
      g.addColorStop(0, rgba(red, 0.7 * a));
      g.addColorStop(1, rgba(red, 0));
      ctx.fillStyle = g;
      ctx.fillRect(r.x - 26, r.y - 26, 52, 52);
    }
  };
}

/** Mentions drift scattered, then gather into a few issues; the largest is lit red. Then they let go and gather again. */
function clusters(): Scene {
  const N = 110, CYCLE = 10;
  // Issue sizes, largest first: most mentions belong to the top issue.
  const share = [0.36, 0.24, 0.16, 0.12, 0.12];
  const dots = Array.from({ length: N }, (_, i) => {
    let c = 0, acc = share[0]!;
    while (i / N > acc && c < share.length - 1) acc += share[++c]!;
    return { c, a: hash(i * 3.1) * Math.PI * 2, r: Math.sqrt(hash(i * 7.7)), sx: 0, sy: 0, ph: hash(i) * 6.28 };
  });
  let round = -1;
  return ({ ctx, w, h, t, p, ink, red, light }) => {
    const enter = ease(t / 1.2);
    const wide = w > 900;
    const k = Math.floor(t / CYCLE), u = (t % CYCLE) / CYCLE;
    if (k !== round) {
      round = k;
      for (const [i, d] of dots.entries()) { d.sx = hash(i + k * 131) ; d.sy = hash(i * 2.3 + k * 71); }
    }
    // Gather, hold, let go.
    const g = smooth(0.08, 0.42, u) * (1 - smooth(0.78, 0.98, u));
    const x0 = wide ? 0.66 : 0.4, span = wide ? 0.31 : 0.56;
    const centres = [[0.45, 0.5], [0.8, 0.26], [0.82, 0.74], [0.12, 0.2], [0.14, 0.8]].map(([cx, cy]) =>
      ({ x: w * (x0 + cx! * span), y: h * (wide ? 0.08 + cy! * 0.84 : 0.62 + cy! * 0.34) }));
    const radius = (c: number) => Math.sqrt(share[c]! * N) * (wide ? 8 : 5);
    ctx.globalAlpha = wide ? 1 : 0.4;

    // Rings round each issue as it forms; the top issue's is red.
    for (const [c, ctr] of centres.entries()) {
      const R = radius(c) + 12;
      const a = g * enter;
      if (a < 0.02) continue;
      if (c === 0) glowAt(ctx, ctr.x, ctr.y, R * 2.4, red, (light ? 0.12 : 0.18) * a);
      ctx.save();
      if (c === 0) { ctx.shadowColor = rgba(red, 0.9); ctx.shadowBlur = 14; }
      ctx.strokeStyle = c === 0 ? rgba(red, 0.85 * a) : rgba(ink, (light ? 0.22 : 0.18) * a);
      ctx.lineWidth = c === 0 ? 1.6 : 1;
      ctx.beginPath(); ctx.arc(ctr.x, ctr.y, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * smooth(0.25, 0.5, u)); ctx.stroke();
      ctx.restore();
    }
    for (const d of dots) {
      const ctr = centres[d.c]!;
      const fx = w * (x0 - 0.04 + d.sx * (span + 0.06)) + Math.sin(t * 0.4 + d.ph) * 10;
      const fy = h * (wide ? 0.06 + d.sy * 0.88 : 0.58 + d.sy * 0.4) + Math.cos(t * 0.33 + d.ph) * 10;
      const R = radius(d.c);
      const tx = ctr.x + Math.cos(d.a + t * 0.15) * d.r * R, ty = ctr.y + Math.sin(d.a + t * 0.15) * d.r * R;
      let x = fx + (tx - fx) * g, y = fy + (ty - fy) * g;
      if (p) { const dd = Math.hypot(x - p.x, y - p.y); const push = 26 * gauss(dd, 60); if (dd > 0) { x += (x - p.x) / dd * push; y += (y - p.y) / dd * push; } }
      const hot = d.c === 0 ? g : 0;
      ctx.fillStyle = hot > 0.3 ? rgba(red, (0.55 + 0.45 * hot) * enter) : rgba(ink, (light ? 0.5 : 0.42) * enter);
      ctx.beginPath(); ctx.arc(x, y, 1.6 + hot * 0.8, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  };
}

/** Your product at the centre with competitors circling it; mentions fly in from outside to whichever they're about. */
function orbits(): Scene {
  const bodies = [{ ring: 0, sp: 0.16, a: 0.5 }, { ring: 1, sp: -0.1, a: 2.4 }, { ring: 1, sp: -0.1, a: 4.6 }, { ring: 2, sp: 0.06, a: 1.3 }];
  const shots: Array<{ from: number; to: number; at: number }> = [];
  let next = 0.6;
  const FLY = 1.5;
  return ({ ctx, w, h, t, p, ink, red, light }) => {
    const enter = ease(t / 1.4);
    const wide = w > 900;
    const cx = (wide ? w * 0.8 : w * 0.72) + (p ? (p.x / w - 0.5) * 18 : 0);
    const cy = (wide ? h * 0.5 : h * 0.86) + (p ? (p.y / h - 0.5) * 12 : 0);
    const R = Math.min(h * (wide ? 0.44 : 0.3), w * (wide ? 0.17 : 0.3));
    const rings = [0.42, 0.7, 0.98].map((f) => f * R * (0.8 + 0.2 * enter));
    ctx.globalAlpha = wide ? 1 : 0.45;

    glowAt(ctx, cx, cy, R * 0.9, red, (light ? 0.14 : 0.2) * enter);
    for (const r of rings) {
      ctx.strokeStyle = rgba(ink, (light ? 0.34 : 0.26) * enter);
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 6]);
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.setLineDash([]);
    const pos = bodies.map((b) => { const a = b.a + t * b.sp; return { x: cx + Math.cos(a) * rings[b.ring]!, y: cy + Math.sin(a) * rings[b.ring]! }; });
    const target = (i: number) => (i < 0 ? { x: cx, y: cy } : pos[i]!);

    if (t > next) {
      shots.push({ from: hash(Math.floor(t * 10)) * Math.PI * 2, to: hash(Math.floor(t * 7) + 3) < 0.45 ? -1 : Math.floor(hash(Math.floor(t * 13)) * bodies.length), at: t });
      next = t + 0.7 + hash(Math.floor(t * 5)) * 0.8;
    }
    while (shots.length && t - shots[0]!.at > FLY + 0.8) shots.shift();
    let hit = -2;
    for (const s of shots) {
      const u = (t - s.at) / FLY;
      const to = target(s.to);
      const sx = cx + Math.cos(s.from) * R * 1.6, sy = cy + Math.sin(s.from) * R * 1.6;
      if (u >= 1) { if (u < 1.35) hit = s.to; continue; }
      const e = ease(u);
      const x = sx + (to.x - sx) * e, y = sy + (to.y - sy) * e;
      const tail = ease(Math.max(0, u - 0.12));
      const tx = sx + (to.x - sx) * tail, ty = sy + (to.y - sy) * tail;
      const line = ctx.createLinearGradient(tx, ty, x, y);
      line.addColorStop(0, rgba(red, 0));
      line.addColorStop(1, rgba(red, 0.8 * enter));
      ctx.strokeStyle = line; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x, y); ctx.stroke();
      ctx.fillStyle = rgba(light ? red : [255, 220, 210], enter);
      ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2); ctx.fill();
    }
    // The competitors, then you.
    for (const [i, b] of pos.entries()) {
      const near = p ? gauss(Math.hypot(p.x - b.x, p.y - b.y), 50) : 0;
      if (hit === i) glowAt(ctx, b.x, b.y, 22, red, 0.5 * enter);
      ctx.fillStyle = rgba(ink, (0.7 + near * 0.3) * enter);
      ctx.beginPath(); ctx.arc(b.x, b.y, 5 + near * 1.5, 0, Math.PI * 2); ctx.fill();
    }
    if (hit === -1) glowAt(ctx, cx, cy, 36, red, 0.6 * enter);
    ctx.save();
    ctx.shadowColor = rgba(red, 0.9); ctx.shadowBlur = 18;
    ctx.fillStyle = rgba(red, enter);
    ctx.beginPath(); ctx.arc(cx, cy, 6.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  };
}

/** A volume line runs past on a quiet grid; where it spikes it turns red. The pointer reads the value under it. */
function chart(): Scene {
  const SPEED = 46, STEP = 6, SPIKE = 520;
  // Volume at a point of the scrolling world: a slow rhythm plus, now and then, a spike.
  const value = (X: number) => {
    let v = 0.3 + 0.08 * Math.sin(X * 0.006) + 0.05 * Math.sin(X * 0.017 + 1) + 0.03 * Math.sin(X * 0.051);
    const k = Math.floor(X / SPIKE);
    for (const j of [k - 1, k, k + 1]) {
      const at = j * SPIKE + hash(j) * SPIKE * 0.6, size = hash(j + 0.5);
      if (size > 0.35) v += (0.15 + size * 0.45) * gauss(X - at, 26 + size * 20) + 0.08 * size * gauss(X - at - 40, 60);
    }
    return v;
  };
  return ({ ctx, w, h, t, p, ink, red, light }) => {
    const enter = ease(t / 1.2);
    const wide = w > 900;
    const top = h * (wide ? 0.16 : 0.5), bottom = h * (wide ? 0.86 : 0.97);
    const left = wide ? w * 0.6 : 0;
    const yOf = (v: number) => bottom - Math.min(v, 1.05) * (bottom - top);
    const fade = (x: number) => (wide ? smooth(left, left + w * 0.12, x) : 0.45) * enter;
    const X0 = t * SPEED;

    const pts: Array<[number, number, number]> = [];
    for (let x = left - STEP; x <= w + STEP; x += STEP) { const v = value(X0 + x); pts.push([x, yOf(v), v]); }
    // A faint area under the line, faded in from the left (drawn first, on the empty canvas, so the fade erases only it).
    const area = ctx.createLinearGradient(0, top, 0, bottom);
    area.addColorStop(0, rgba(red, light ? 0.1 : 0.14));
    area.addColorStop(1, rgba(red, 0));
    ctx.save();
    ctx.globalAlpha = wide ? enter : 0.5 * enter;
    ctx.beginPath(); ctx.moveTo(pts[0]![0], bottom);
    for (const [x, y] of pts) ctx.lineTo(x, y);
    ctx.lineTo(pts[pts.length - 1]![0], bottom); ctx.closePath();
    ctx.fillStyle = area; ctx.fill();
    if (wide) {
      const cut = ctx.createLinearGradient(left, 0, left + w * 0.12, 0);
      cut.addColorStop(0, "rgba(0,0,0,1)");
      cut.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = cut; ctx.fillRect(left - STEP * 2, top - 2, w * 0.12 + STEP * 2, bottom - top + 4);
    }
    ctx.restore();
    // Grid: a few dotted rules.
    for (let i = 0; i <= 4; i++) {
      const y = top + ((bottom - top) * i) / 4;
      for (let x = left; x < w; x += 8) {
        const a = (light ? 0.2 : 0.16) * fade(x);
        if (a < 0.01) continue;
        ctx.fillStyle = rgba(ink, a);
        ctx.fillRect(x, y, 1.2, 1.2);
      }
    }
    // The line; red where it spikes.
    for (let i = 1; i < pts.length; i++) {
      const [x1, y1, v1] = pts[i - 1]!, [x2, y2, v2] = pts[i]!;
      const hot = smooth(0.48, 0.62, Math.max(v1, v2));
      const a = fade(x2);
      if (a < 0.01) continue;
      ctx.save();
      if (hot > 0.2) { ctx.shadowColor = rgba(red, 0.9); ctx.shadowBlur = 12; }
      ctx.strokeStyle = hot > 0.2 ? rgba(red, (0.5 + 0.5 * hot) * a) : rgba(ink, (light ? 0.55 : 0.45) * a);
      ctx.lineWidth = 1.5 + hot * 0.5;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.restore();
    }
    // Reading under the pointer.
    if (p && p.x > left) {
      const v = value(X0 + p.x), y = yOf(v);
      ctx.strokeStyle = rgba(ink, 0.25 * fade(p.x));
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(p.x + 0.5, top); ctx.lineTo(p.x + 0.5, bottom); ctx.stroke();
      ctx.fillStyle = rgba(v > 0.55 ? red : ink, fade(p.x));
      ctx.beginPath(); ctx.arc(p.x, y, 3, 0, Math.PI * 2); ctx.fill();
    }
  };
}

/** A branching path, like a circuit: a signal starts at the feedback and follows one branch to its cause, which lights up. */
function trace(): Scene {
  type Node = { x: number; y: number; kids: number[]; up: number };
  let nodes: Node[] = [], W = 0, H = 0;
  let leaf = -1, startedAt = 0, path: Array<[number, number]> = [], length = 0;
  const SPEED = 380, HOLD = 1.1, DEPTH = 4;
  const build = (w: number, h: number) => {
    const wide = w > 900;
    const x0 = wide ? w * 0.68 : w * 0.3, x1 = w * (wide ? 0.95 : 0.94);
    const cy = wide ? h * 0.5 : h * 0.74, spread = wide ? h * 0.36 : h * 0.22;
    nodes = [{ x: x0, y: cy, kids: [], up: -1 }];
    let level = [0];
    for (let d = 1; d <= DEPTH; d++) {
      const next: number[] = [];
      for (const i of level) for (const s of [-1, 1]) {
        nodes.push({ x: x0 + ((x1 - x0) * d) / DEPTH, y: nodes[i]!.y + s * spread / 2 ** d, kids: [], up: i });
        nodes[i]!.kids.push(nodes.length - 1);
        next.push(nodes.length - 1);
      }
      level = next;
    }
    W = w; H = h; leaf = -1;
  };
  // Circuit-style route between a node and its child: across, down, across.
  const route = (a: Node, b: Node): Array<[number, number]> => { const mx = (a.x + b.x) / 2; return [[a.x, a.y], [mx, a.y], [mx, b.y], [b.x, b.y]]; };
  const segLen = (pts: Array<[number, number]>) => pts.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - pts[i]![0], q[1] - pts[i]![1]), 0);
  return ({ ctx, w, h, t, p, ink, red, light }) => {
    if (w !== W || h !== H) build(w, h);
    const enter = ease(t / 1.2);
    const wide = w > 900;
    ctx.globalAlpha = wide ? 1 : 0.45;
    const leaves = nodes.map((_, i) => i).filter((i) => nodes[i]!.kids.length === 0);

    // Pick a new branch to follow when the last one has been shown.
    if (leaf < 0 || t - startedAt > length / SPEED + HOLD) {
      leaf = leaves[Math.floor(hash(Math.floor(t * 3.7)) * leaves.length)]!;
      const chain: number[] = [];
      for (let i = leaf; i >= 0; i = nodes[i]!.up) chain.unshift(i);
      path = [];
      for (let k = 1; k < chain.length; k++) path.push(...route(nodes[chain[k - 1]!]!, nodes[chain[k]!]!).slice(k === 1 ? 0 : 1));
      length = segLen(path);
      startedAt = t;
    }
    // The whole tree, quietly.
    ctx.strokeStyle = rgba(ink, (light ? 0.2 : 0.15) * enter);
    ctx.lineWidth = 1;
    for (const n of nodes) for (const k of n.kids) {
      const r = route(n, nodes[k]!);
      ctx.beginPath(); ctx.moveTo(r[0]![0], r[0]![1]); for (const [x, y] of r.slice(1)) ctx.lineTo(x, y); ctx.stroke();
    }
    for (const n of nodes) {
      const near = p ? gauss(Math.hypot(p.x - n.x, p.y - n.y), 40) : 0;
      ctx.fillStyle = rgba(ink, (0.35 + near * 0.5) * enter);
      ctx.fillRect(n.x - 2.5, n.y - 2.5, 5, 5);
    }
    // The signal, lighting its branch as it goes.
    const run = Math.min((t - startedAt) * SPEED, length);
    let left = run, hx = path[0]![0], hy = path[0]![1];
    ctx.save();
    ctx.shadowColor = rgba(red, 0.9); ctx.shadowBlur = 12;
    ctx.strokeStyle = rgba(red, 0.85 * enter); ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(hx, hy);
    for (let i = 1; i < path.length && left > 0; i++) {
      const [ax, ay] = path[i - 1]!, [bx, by] = path[i]!;
      const L = Math.hypot(bx - ax, by - ay), f = Math.min(1, left / (L || 1));
      hx = ax + (bx - ax) * f; hy = ay + (by - ay) * f;
      ctx.lineTo(hx, hy);
      left -= L;
    }
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = rgba(light ? red : [255, 220, 210], enter);
    ctx.beginPath(); ctx.arc(hx, hy, 2.4, 0, Math.PI * 2); ctx.fill();
    glowAt(ctx, nodes[0]!.x, nodes[0]!.y, 40, red, (light ? 0.14 : 0.2) * enter);
    // The cause it found.
    if (run >= length) {
      const a = 1 - smooth(0, HOLD, t - startedAt - length / SPEED);
      const n = nodes[leaf]!;
      glowAt(ctx, n.x, n.y, 34, red, 0.6 * a * enter);
      ctx.fillStyle = rgba(red, enter);
      ctx.fillRect(n.x - 3.5, n.y - 3.5, 7, 7);
    }
    ctx.globalAlpha = 1;
  };
}

/** Claude, on the right, calls the Heardex MCP connector's tools: a request runs out to a tool, its name lights, the answer runs back. */
function mcp(): Scene {
  const TOOLS = [
    "get_product_context", "get_feedback_issues", "get_issue_details", "get_issue_evidence",
    "get_issue_priority", "get_spike_analysis", "get_implementation_context", "submit_investigation_report",
  ];
  const OUT = 0.7, HOLD = 0.45, BACK = 0.7, TOTAL = OUT + HOLD + BACK;
  const calls: Array<{ i: number; at: number }> = [];
  let next = 0.5, lastHover = -1, hoverRow = -1, hubHit = -10;
  const bez = (a: number, b: number, c: number, d: number, u: number) => {
    const v = 1 - u; return v * v * v * a + 3 * v * v * u * b + 3 * v * u * u * c + u * u * u * d;
  };
  return ({ ctx, w, h, t, p, ink, red, light }) => {
    const enter = ease(t / 1.2);
    const wide = w > 900;
    ctx.globalAlpha = wide ? 1 : 0.35;
    const hx = w * (wide ? 0.95 : 0.92), hy = h * 0.5;
    const portX = w * (wide ? 0.83 : 0.74);
    const top = h * 0.24, bottom = h * 0.76;
    const rows = TOOLS.map((_, i) => top + ((bottom - top) * i) / (TOOLS.length - 1));
    const path = (i: number, u: number) => {
      const py = rows[i]!, mx = (hx + portX) / 2;
      return [bez(hx, mx, mx, portX, u), bez(hy, hy, py, py, u)] as const;
    };

    // Calls: on a timer, and for the tool under the pointer.
    const busy = (i: number) => calls.some((c) => c.i === i && t - c.at < TOTAL);
    if (t > next) {
      let i = Math.floor(hash(Math.floor(t * 7.3)) * TOOLS.length);
      for (let k = 0; k < TOOLS.length && busy(i); k++) i = (i + 3) % TOOLS.length;
      if (!busy(i)) calls.push({ i, at: t });
      next = t + 0.8 + hash(Math.floor(t * 3.1)) * 0.6;
    }
    hoverRow = -1;
    if (p && p.x > portX - w * 0.2 && p.x < hx) {
      const near = rows.findIndex((y) => Math.abs(p.y - y) < (bottom - top) / (TOOLS.length - 1) / 2);
      if (near >= 0) { hoverRow = near; if (t - lastHover > 0.6 && !busy(near)) { calls.push({ i: near, at: t }); lastHover = t; } }
    }
    while (calls.length && t - calls[0]!.at > TOTAL + 0.2) calls.shift();

    // Wires and ports.
    for (let i = 0; i < rows.length; i++) {
      ctx.strokeStyle = rgba(ink, (light ? 0.24 : 0.2) * enter);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let k = 0; k <= 24; k++) { const [x, yy] = path(i, k / 24); if (k) ctx.lineTo(x, yy); else ctx.moveTo(x, yy); }
      ctx.stroke();
    }
    // Tool names, right-aligned against their ports; lit while called.
    ctx.font = `${wide ? 14 : 11}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const [i, y] of rows.entries()) {
      const c = calls.find((k) => k.i === i);
      const u = c ? t - c.at : -1;
      const lit = c ? smooth(OUT - 0.1, OUT, u) * (1 - smooth(OUT + HOLD, OUT + HOLD + 0.3, u)) : 0;
      const a = (light ? 0.62 : 0.55) + (hoverRow === i ? 0.3 : 0);
      ctx.fillStyle = lit > 0.05 ? rgba(red, (0.5 + 0.5 * lit) * enter) : rgba(ink, a * enter);
      // On phones the names would sit under the headline; the wires and calls stay.
      if (wide) ctx.fillText(TOOLS[i]!, portX - 16, y);
      if (lit > 0.05) glowAt(ctx, portX, y, 26, red, 0.55 * lit * enter);
      ctx.fillStyle = lit > 0.05 ? rgba(red, enter) : rgba(ink, (0.45 + (hoverRow === i ? 0.3 : 0)) * enter);
      ctx.fillRect(portX - 4, y - 4, 8, 8);
    }
    // Requests out (red, with a trail) and answers back (light).
    for (const c of calls) {
      const u = t - c.at;
      let f = -1, back = false;
      if (u < OUT) f = ease(u / OUT);
      else if (u > OUT + HOLD && u < TOTAL) { f = 1 - ease((u - OUT - HOLD) / BACK); back = true; }
      if (f < 0) { if (u >= TOTAL && u < TOTAL + 0.2) hubHit = t; continue; }
      for (let k = 0; k < 14; k++) {
        const g = back ? f + k * 0.012 : f - k * 0.012;
        if (g < 0 || g > 1) break;
        const [x, y] = path(c.i, g);
        const a = enter * (1 - k / 14);
        ctx.fillStyle = k === 0
          ? rgba(back ? (light ? ink : [255, 235, 228]) : red, a)
          : rgba(back ? ink : red, a * (back ? 0.35 : 0.6));
        ctx.beginPath(); ctx.arc(x, y, k === 0 ? 2.6 : 1.6, 0, Math.PI * 2); ctx.fill();
      }
    }
    // Claude, the client.
    const pulseA = Math.max(0, 1 - (t - hubHit) / 0.6);
    glowAt(ctx, hx, hy, 70 + pulseA * 30, red, ((light ? 0.16 : 0.22) + pulseA * 0.25) * enter);
    ctx.save();
    ctx.shadowColor = rgba(red, 0.9); ctx.shadowBlur = 18;
    ctx.fillStyle = rgba(red, enter);
    ctx.beginPath(); ctx.arc(hx, hy, 8 + pulseA * 2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // Who's who.
    if (!wide) { ctx.globalAlpha = 1; return; }
    ctx.textAlign = "center";
    ctx.fillStyle = rgba(ink, (light ? 0.7 : 0.65) * enter);
    ctx.fillText("Claude", hx, hy + 26);
    ctx.textAlign = "right";
    ctx.fillStyle = rgba(red, 0.85 * enter);
    ctx.fillText("Heardex MCP", portX + 4, top - 32);
    ctx.globalAlpha = 1;
  };
}

/** Ruled lines; a red light reads along one line at a time, left to right, leaving a short glowing trail. */
function lines(): Scene {
  const GAP = 30, SPEED = 320;
  let row = 2, startedAt = 0;
  return ({ ctx, w, h, t, p, ink, red, light }) => {
    const enter = ease(t / 1);
    const rows = Math.max(1, Math.floor(h / GAP));
    const x = (t - startedAt) * SPEED - 120;
    if (x > w + 240) { startedAt = t; row = 1 + Math.floor(Math.random() * Math.max(1, rows - 2)); }
    for (let i = 1; i <= rows; i++) {
      const y = i * GAP + 0.5;
      const near = p ? gauss(p.y - y, 22) : 0;
      ctx.strokeStyle = rgba(ink, ((light ? 0.12 : 0.08) + near * 0.1) * enter);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    // The margin rule, like a notebook's.
    const mx = Math.min(w * 0.08, 96) + 0.5;
    ctx.strokeStyle = rgba(red, 0.22 * enter);
    ctx.beginPath(); ctx.moveTo(mx, 0); ctx.lineTo(mx, h); ctx.stroke();

    const y = row * GAP + 0.5;
    const trail = ctx.createLinearGradient(x - 260, 0, x, 0);
    trail.addColorStop(0, rgba(red, 0));
    trail.addColorStop(1, rgba(red, 0.9 * enter));
    ctx.save();
    ctx.shadowColor = rgba(red, 0.9);
    ctx.shadowBlur = 12;
    ctx.strokeStyle = trail;
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(Math.max(0, x - 260), y); ctx.lineTo(Math.min(w, x), y); ctx.stroke();
    ctx.restore();
    if (x > 0 && x < w) {
      ctx.fillStyle = rgba(light ? red : [255, 220, 210], enter);
      ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill();
    }
    // A soft light above, where the reading is.
    const glow = ctx.createRadialGradient(x, y, 0, x, y, 220);
    glow.addColorStop(0, rgba(red, (light ? 0.07 : 0.1) * enter));
    glow.addColorStop(1, rgba(red, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(x - 220, y - 220, 440, 440);
  };
}

/** Threads of conversation drift across; signals run along them. The pointer bends the threads near it. */
function threads(): Scene {
  const T = Array.from({ length: 6 }, (_, i) => ({ y: 0.22 + i * 0.12, amp: 18 + (i % 3) * 12, k: 0.004 + (i % 2) * 0.002, sp: 0.18 + i * 0.05, at: (i * 0.37) % 1, v: 0.045 + (i % 3) * 0.015 }));
  return ({ ctx, w, h, t, p, ink, red, light }) => {
    const enter = ease(t / 1.4);
    const yAt = (th: (typeof T)[number], x: number) => {
      let y = h * th.y + Math.sin(x * th.k + t * th.sp) * th.amp + Math.sin(x * th.k * 2.3 - t * th.sp * 0.7) * th.amp * 0.35;
      if (p) y += (p.y - y) * 0.25 * gauss(x - p.x, 140) * gauss(p.y - y, 140);
      return y;
    };
    for (const th of T) {
      ctx.strokeStyle = rgba(ink, (light ? 0.18 : 0.2) * enter);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 8) { const y = yAt(th, x); if (x) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
      ctx.stroke();
      // Its signal: a bright point and a fading trail.
      const u = (th.at + t * th.v) % 1;
      for (let k = 0; k < 18; k++) {
        const x = (u - k * 0.006) * w;
        if (x < 0) break;
        const a = enter * (1 - k / 18) * Math.sin(u * Math.PI);
        ctx.fillStyle = k === 0 ? rgba(light ? red : [255, 215, 205], a) : rgba(red, a * 0.65);
        ctx.beginPath(); ctx.arc(x, yAt(th, x), k === 0 ? 2.4 : 1.5, 0, Math.PI * 2); ctx.fill();
      }
    }
  };
}

/** Two rims, side by side and overlapping; where one passes inside the other it is lit red, and the shared lens glows. */
function venn(): Scene {
  return ({ ctx, w, h, t, p, ink, red, light }) => {
    const enter = ease(t / 1.4);
    const wide = w > 900;
    const R = Math.min(h * (wide ? 0.4 : 0.3), w * (wide ? 0.17 : 0.3));
    const cy = h * (wide ? 0.5 : 0.9);
    const mid = wide ? w * 0.72 : w * 0.5;
    const px = p ? (p.x / w - 0.5) * 24 : 0, py = p ? (p.y / h - 0.5) * 16 : 0;
    const apart = R * (0.62 + Math.sin(t * 0.35) * 0.08) * (0.6 + 0.4 * enter);
    const a = { x: mid - apart + px, y: cy + py };
    const b = { x: mid + apart - px * 0.6, y: cy - py * 0.6 };

    // On narrow screens they sit low and quieter, behind the text.
    ctx.globalAlpha = wide ? 1 : 0.5;
    // The lens where they overlap.
    ctx.save();
    ctx.beginPath(); ctx.arc(a.x, a.y, R, 0, Math.PI * 2); ctx.clip();
    const lens = ctx.createRadialGradient(mid, cy, 0, mid, cy, R);
    lens.addColorStop(0, rgba(red, (light ? 0.1 : 0.16) * enter));
    lens.addColorStop(1, rgba(red, 0));
    ctx.beginPath(); ctx.arc(b.x, b.y, R, 0, Math.PI * 2);
    ctx.fillStyle = lens; ctx.fill();
    ctx.restore();

    for (const [c, o] of [[a, b], [b, a]] as const) {
      ctx.strokeStyle = rgba(ink, (light ? 0.2 : 0.16) * enter);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(c.x, c.y, R, 0, Math.PI * 2); ctx.stroke();
      // The part of this rim inside the other circle, lit.
      const d = Math.hypot(o.x - c.x, o.y - c.y);
      if (d < 2 * R) {
        const toward = Math.atan2(o.y - c.y, o.x - c.x);
        const half = Math.acos(d / (2 * R));
        ctx.save();
        ctx.shadowColor = rgba(red, 0.9);
        ctx.shadowBlur = 16;
        ctx.strokeStyle = rgba(red, 0.95 * enter);
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(c.x, c.y, R, toward - half, toward + half); ctx.stroke();
        ctx.restore();
        // A signal running round the lit arc.
        const s = toward - half + ((t * 0.5) % 1) * 2 * half;
        ctx.fillStyle = rgba(light ? red : [255, 220, 210], enter);
        ctx.beginPath(); ctx.arc(c.x + Math.cos(s) * R, c.y + Math.sin(s) * R, 2.2, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  };
}

const SCENES: Record<SkyKind, () => Scene> = { pulse, clusters, orbits, chart, trace, mcp, lines, threads, venn };

export function Sky({ kind, className }: { kind: SkyKind; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current!;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const draw = SCENES[kind]();
    let w = 0, h = 0, ink: RGB = [244, 244, 245], red: RGB = [255, 59, 47], light = false;
    const colours = () => {
      const cs = getComputedStyle(el);
      ink = parse(cs.getPropertyValue("--ink"), ink);
      red = parse(cs.getPropertyValue("--red"), red);
      light = document.documentElement.classList.contains("light");
    };
    const size = () => {
      const dpr = Math.min(window.devicePixelRatio, 2);
      w = el.clientWidth; h = el.clientHeight;
      el.width = Math.round(w * dpr); el.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    colours(); size();
    // On a theme change, take the new colours (and redraw the one frame when still).
    const theme = new MutationObserver(() => { colours(); if (still) { cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); } });
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    window.addEventListener("resize", size);

    let pointer: Pointer = null;
    const onPointer = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      pointer = x >= 0 && y >= 0 && x <= r.width && y <= r.height ? { x, y } : null;
    };
    window.addEventListener("pointermove", onPointer, { passive: true });

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t0 = performance.now();
    let raf = 0, visible = true;
    const frame = (now: number) => {
      ctx.clearRect(0, 0, w, h);
      draw({ ctx, w, h, t: still ? 6 : (now - t0) / 1000, p: still ? null : pointer, ink, red, light });
      if (!still && visible && !document.hidden) raf = requestAnimationFrame(frame);
    };
    // Only animate while on screen.
    const io = new IntersectionObserver(([e]) => {
      visible = !!e?.isIntersecting;
      cancelAnimationFrame(raf);
      if (visible) raf = requestAnimationFrame(frame);
    });
    io.observe(el);
    const onVisible = () => { cancelAnimationFrame(raf); if (!document.hidden && visible) raf = requestAnimationFrame(frame); };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelAnimationFrame(raf); io.disconnect(); theme.disconnect();
      window.removeEventListener("resize", size); window.removeEventListener("pointermove", onPointer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [kind]);

  return <canvas ref={canvas} className={className} data-sky={kind} aria-hidden />;
}
