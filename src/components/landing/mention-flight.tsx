"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { siReddit } from "simple-icons";
import { horizon } from "./backgrounds";
import { HeardexMark } from "./hero";
import { poseDive } from "./dive";
import { Network, rounded, type RedditLink } from "./network";

// One mention's journey, on a loop: typed on Reddit, sent down into Reddit, carried along the wire, risen in Heardex.
const POST = "Is it just me, or does Notewise crash every time I export a PDF?";
const TYPE_AT = 400;
const CHAR_MS = 36;
// Each step starts at this time (ms into the loop); the classes are cumulative, s1 … s9:
// aim, click, charge, sink, at Reddit, across the wire, at Heardex, mention risen, reset.
// The pulse takes 800ms along the wire and Heardex answers the instant it arrives (keep in step with mf-run).
const STEPS = [0, 2900, 3600, 3800, 4400, 5200, 5700, 6500, 6650, 10600] as const;
const LOOP = 11200;
// Along the scene's track, in screen heights: the logo is down, the turn starts, the turn is done.
const LAND_AT = 0.9;
const FLOOR_TILT = 58; // degrees, keep in step with landing.css
const FLOOR_TURN = 35;

const TURN_FROM = 1.5;
const TURN_TO = 2.7;
const GROW_FROM = TURN_FROM; // the wires grow out of Heardex to every platform from the start of the turn
const GROW_TO = 3.9;
// Then the camera flies into Heardex, down onto the road between its two rows of tiles and along it (dive.tsx), until
// all is black (process.tsx brings the feed up out of the black).
export const DIVE_FROM = 4.3;
export const DIVE_TO = 5.8;
const FOLLOW_MS = 260; // how softly the logo follows the scroll
const LAND_BEAT = 700; // after the logo lands, before the post starts
const HUB = 0.13; // Heardex's width in the network, a share of the screen's shorter side
const LAYERS = 9; // slices that give the coin and the mark their thickness

const clamp = (v: number) => Math.min(1, Math.max(0, v));
/** 0 before `from`, 1 after `to`, eased between. */
const smooth = (from: number, to: number, v: number) => {
  const t = clamp((v - from) / (to - from));
  return t * t * (3 - 2 * t);
};
const easeInOut = (t: number) => 0.5 - Math.cos(Math.PI * t) / 2;

function Mark({ path, className }: { path: string; className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} aria-hidden><path d={path} fill="currentColor" /></svg>;
}

function Slices({ children, fine = false }: { children: (top: boolean) => React.ReactNode; fine?: boolean }) {
  // Seen big (the logo in flight), twice the slices at half the spacing, so its sides read as solid.
  const layers = fine ? LAYERS * 2 - 1 : LAYERS;
  return Array.from({ length: layers }, (_, i) => (
    <span key={i} className={`mf-slice${i === layers - 1 ? " is-top" : ""}`} style={{ ["--z" as string]: fine ? i / 2 : i }}>
      {children(i === layers - 1)}
    </span>
  ));
}

/**
 * The ring around the Heardex mark's silhouette: the mark grown outward (its tiles merge into one shape) less the mark
 * grown a little less. Defined once as a mask; `Ring` paints it.
 */
function OutlineMask({ id }: { id: string }) {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden>
      <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="2000" height="2000">
        <g color="#fff" stroke="#fff" strokeWidth="170" strokeLinejoin="round"><HeardexMark className="overflow-visible" /></g>
        <g color="#000" stroke="#000" strokeWidth="128" strokeLinejoin="round"><HeardexMark className="overflow-visible" /></g>
      </mask>
    </svg>
  );
}

function Ring({ id }: { id: string }) {
  return (
    <svg viewBox="423 403 1085 1126" className="mf-ring-shape" aria-hidden>
      <rect x="0" y="0" width="2000" height="2000" mask={`url(#${id})`} />
    </svg>
  );
}

/**
 * Where Reddit and Heardex lie on the floor and the wire between them, taken from the network the scene turns into
 * (network.tsx) so the one becomes the other: its route, from Heardex's centre in screen pixels, scaled to the floor.
 * In cqw: a screen pixel there is 21 / (side × HUB) cqw here (Heardex is 21cqw wide here, side × HUB px there). Both
 * have to fit on the floor (100 × 70), so a far Reddit is brought in.
 */
function placeLink(link: RedditLink | null) {
  if (!link) return { hx: 64, hy: 36, vx: -46, vy: -10, d: "" };
  let k = 21 / (link.side * HUB);
  const end = link.route[0]!;
  k *= Math.min(1, 52 / Math.abs(end.x * k || 1), 36 / Math.abs(end.y * k || 1));
  const pts = link.route.map((q) => ({ x: q.x * k, y: q.y * k }));
  const vx = end.x * k, vy = end.y * k;
  // Centred on the floor between the two.
  return { hx: 50 - vx / 2, hy: 35 - vy / 2, vx, vy, d: rounded(pts, 3) };
}

/**
 * The scenario, shown. The Heardex mark arrives first: the bar's logo flies down with the scroll and lands in the
 * tray, and only then does the story play. A post is written and sent; it folds down into the Reddit coin on the floor, a pulse runs
 * along the wire, and the mention rises out of the Heardex mark in its tray. Plays only while in view; with reduced
 * motion it shows the risen mention, still.
 */
export function MentionFlight() {
  const root = useRef<HTMLDivElement>(null);
  const outline = `mf-outline-${useId().replace(/[^a-z0-9]/gi, "")}`;
  const stage = useRef<HTMLDivElement>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const mover = useRef<HTMLDivElement>(null);
  const spin = useRef<HTMLDivElement>(null);
  const net = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [chars, setChars] = useState(0);
  const [landed, setLanded] = useState(false);
  const [link, setLink] = useState<RedditLink | null>(null);
  // Heardex answers a mention arriving down a wire: the ripple and flash play once, from the start, each time.
  const heardex = useRef<HTMLDivElement>(null);
  const arrive = useCallback(() => {
    const el = heardex.current;
    if (!el || root.current?.classList.contains("is-diving")) return; // not while the camera flies into it
    el.classList.remove("is-hit");
    void el.offsetWidth;
    el.classList.add("is-hit");
  }, []);
  const place = placeLink(link);

  useEffect(() => {
    const el = root.current!;
    const st = stage.current!;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let start = 0;
    let visible = false;
    let down = false; // the logo is in the tray
    const tick = (now: number) => {
      const t = Math.max(0, now - start) % LOOP;
      let s = 0;
      while (s + 1 < STEPS.length && t >= STEPS[s + 1]!) s++;
      setStep(s);
      setChars(Math.max(0, Math.min(POST.length, Math.floor((t - TYPE_AT) / CHAR_MS))));
      frame = requestAnimationFrame(tick);
    };
    // The loop plays while the logo is down in the tray and the scene is in view; it starts a beat after the landing.
    let turned = false; // once the scene turns, the story rests and the network takes over
    const sync = (justLanded: boolean) => {
      cancelAnimationFrame(frame);
      if (down && visible && !turned) {
        start = performance.now() + (justLanded ? LAND_BEAT : 0);
        frame = requestAnimationFrame(tick);
      } else if (!down) {
        setStep(0);
        setChars(0);
      }
    };

    const io = new IntersectionObserver(([entry]) => {
      if (still) {
        setLanded(true);
        setStep(8);
        setChars(POST.length);
        return;
      }
      visible = Boolean(entry?.isIntersecting);
      sync(false);
    }, { threshold: 0.3 });
    io.observe(el);
    if (still) return () => io.disconnect();

    // The logo's flight: from the bar on the first screen, popped out in 3D, carried down with the scroll, into the
    // tray. The copy flies in a stage laid exactly over the scene's, so at the end it sits where the scene's mark is.
    const source = document.querySelector<HTMLElement>("[data-flight-source]");
    const floor = st.querySelector<HTMLElement>(".mf-floor")!;
    const base = st.querySelector<HTMLElement>(".mf-base.is-heardex")!;
    const mark = base.querySelector<HTMLElement>(".mf-hx")!;
    // The flight is scrubbed by the scroll, in two parts. First the page holds (the first screen is pinned on its
    // track): the bar's logo turns 3D, pops out and comes at you from far off, bigger and bigger, while the planet
    // rises to fill the screen. Then the page moves on and the logo comes down into the tray (the scene pinned on
    // its track). The logo eases after the scroll rather than jumping with it, and floats while it hangs.
    const heroTrack = document.querySelector<HTMLElement>("[data-hero-track]");
    const copy = document.querySelector<HTMLElement>("[data-hero-copy]");
    const track = st.closest<HTMLElement>("[data-flight-track]");
    const inner = ghost.current!.firstElementChild as HTMLElement;
    // The turn: the floor tilts up to face you, the scene moves to the middle and grows to fill the page, and the rest
    // of the platforms come in round Heardex. CSS reads --c (0..1) for everything on the floor.
    const copyNext = st.closest("section")?.querySelector<HTMLElement>("[data-scenario-copy]");
    const title = st.closest("section")?.querySelector<HTMLElement>("[data-network-title]");
    const dive = st.closest("section")?.querySelector<HTMLElement>("[data-dive]");
    const markOnFloor = base.querySelector<HTMLElement>(".mf-hx")!;
    const scene = el.parentElement!;
    const layer = net.current!;
    const turnTo = (c: number, g: number, d: number) => {
      if ((c > 0) !== turned) {
        turned = c > 0;
        sync(false);
      }
      st.style.setProperty("--c", `${c}`);
      layer.style.setProperty("--g", `${g}`);
      el.classList.toggle("is-network", g >= 1); // on the root: React rewrites the stage's classes every step
      layer.classList.toggle("is-network", g >= 1);
      // The network lies on the floor round Heardex, a screen-sized plane shrunk by the scale the scene grows to, so
      // it tilts with the floor on the way and, once the scene has turned and grown, covers the screen exactly.
      const sw = scene.getBoundingClientRect().width;
      const final = (Math.min(innerWidth, innerHeight) * HUB) / (sw * 0.21);
      layer.style.width = `${innerWidth}px`;
      layer.style.height = `${innerHeight}px`;
      layer.style.setProperty("--shrink", `${1 / final}`);
      if (copyNext) copyNext.style.opacity = c ? `${Math.max(0, 1 - c * 2.5)}` : "";
      // The dive: the solid mark (dive.tsx) takes the flat one's place and the camera flies into it; everything else on
      // the floor falls away.
      if (dive) poseDive(dive, d, Math.min(innerWidth, innerHeight) * HUB);
      markOnFloor.style.visibility = d > 0 ? "hidden" : "";
      base.style.opacity = d > 0 ? `${1 - smooth(0, 0.15, d)}` : "";
      layer.style.opacity = d > 0 ? `${1 - smooth(0, 0.3, d)}` : "";
      el.style.visibility = d >= 1 ? "hidden" : "";
      if ((d > 0) !== el.classList.contains("is-diving")) {
        el.classList.toggle("is-diving", d > 0);
        heardex.current?.classList.remove("is-hit");
      }
      if (title) {
        const t = smooth(0.75, 1, g) * (1 - smooth(0, 0.2, d)); // as the last wires arrive; gone as the dive starts
        title.style.opacity = `${t}`;
        title.style.transform = `translateY(${(1 - t) * 16}px)`;
      }
      if (!c) {
        el.style.transform = "";
        return;
      }
      const e = easeInOut(c);
      const box = scene.getBoundingClientRect();
      const w = box.width;
      // Heardex (at the floor's centre once it has moved) goes to the middle of the screen, at the network's hub size.
      const fx = box.left + w * 0.5;
      const fy = box.top + w * 0.53;
      const grow = (Math.min(innerWidth, innerHeight) * HUB) / (w * 0.21);
      el.style.transformOrigin = `${w * 0.5}px ${w * 0.53}px`;
      el.style.transform = `translate(${(innerWidth / 2 - fx) * e}px, ${(innerHeight / 2 - fy) * e}px) scale(${1 + (grow - 1) * e})`;
    };

    let queued = 0;
    let at = -1; // the scroll the logo has caught up to
    let last = 0;
    const place = (now: number) => {
      queued = 0;
      const dt = last ? Math.min(64, now - last) : 16;
      last = now;
      at = at < 0 ? scrollY : at + (scrollY - at) * (1 - Math.exp(-dt / FOLLOW_MS));
      if (Math.abs(scrollY - at) < 0.5) at = scrollY;

      const box = st.getBoundingClientRect();
      const held = heroTrack ? Math.max(1, heroTrack.offsetHeight - innerHeight) : 1;
      // The scene's track: the logo lands, a pause for the story, then the scene turns to face you and opens into the
      // network (in screen heights from the track's top; keep in step with its height in scenario.tsx).
      const top = track ? track.offsetTop : held + innerHeight;
      const end = Math.max(held + 1, top + LAND_AT * innerHeight);
      const c = clamp((at - top - TURN_FROM * innerHeight) / ((TURN_TO - TURN_FROM) * innerHeight));
      const g = clamp((at - top - GROW_FROM * innerHeight) / ((GROW_TO - GROW_FROM) * innerHeight));
      const d = clamp((at - top - DIVE_FROM * innerHeight) / ((DIVE_TO - DIVE_FROM) * innerHeight));
      const a = clamp(at / held); // the first part, page held
      const b = clamp((at - held) / (end - held)); // the second part, down to the tray

      // The first screen gives way: its words dissolve as the logo comes through them, and the planet rises.
      const fade = smooth(0.3, 0.7, a);
      if (copy) {
        copy.style.opacity = `${1 - fade}`;
        copy.style.filter = fade ? `blur(${fade * 14}px)` : "";
        copy.style.transform = fade ? `scale(${1 + fade * 0.08})` : "";
      }
      horizon.lift = 0.95 * easeInOut(smooth(0.35, 1, a));

      const flying = at > 0 && b < 1;
      ghost.current!.classList.toggle("is-flying", flying);
      // Once the logo has come back to the bar at the end of the story (process.tsx), the bar is left as it is.
      const bar = source?.closest("header");
      if (!bar?.classList.contains("is-back")) {
        if (source) source.style.visibility = at > 0 ? "hidden" : "";
        bar?.classList.toggle("is-flown", at > 0);
      }
      if (flying) {
        // The floor's angles before the turn (--tilt and --turn at --c 0 in landing.css).
        const tilt = (FLOOR_TILT * Math.PI) / 180;
        const turn = (FLOOR_TURN * Math.PI) / 180;
        // Where the scene's mark is: its point on the floor, turned and tilted with the floor about its centre.
        const ox = floor.offsetLeft + floor.offsetWidth / 2;
        const oy = floor.offsetTop + floor.offsetHeight / 2;
        const vx = floor.offsetLeft + base.offsetLeft - ox;
        const vy = floor.offsetTop + base.offsetTop - oy;
        const tx = vx * Math.cos(turn) - vy * Math.sin(turn);
        const ty = vx * Math.sin(turn) + vy * Math.cos(turn);
        const to = { x: ox + tx, y: oy + ty * Math.cos(tilt), z: ty * Math.sin(tilt) };
        // Where it starts (the bar's logo, which stays put while the first screen is pinned) and where it hangs, big, mid-screen.
        const src = source?.getBoundingClientRect();
        const from = src
          ? { x: src.left + src.width / 2 - box.left, y: src.top + src.height / 2 - box.top, size: src.width }
          : { x: 0, y: -box.top, size: 24 };
        const mid = { x: innerWidth / 2 - box.left, y: innerHeight * 0.46 - box.top };
        const s0 = from.size / mark.offsetWidth;
        const big = (Math.min(innerWidth, innerHeight) * 0.4) / mark.offsetWidth;

        // Part one: pops out and turns 3D, then comes from far, growing faster the nearer it gets.
        const pop = easeInOut(smooth(0, 0.22, a));
        const come = smooth(0.12, 1, a);
        const ax = from.x + (mid.x - from.x) * easeInOut(come);
        const ay = from.y + (mid.y - from.y) * easeInOut(come);
        const aScale = s0 + (big - s0) * come ** 2.2;
        const aLean = -26 * pop;
        const aYaw = 24 * pop;
        const turnOnce = 360 * easeInOut(smooth(0.3, 0.85, a)); // one full turn on the way in
        // Part two: from there down into the tray, settling onto the floor's angle.
        const k = 0.5 - Math.cos(Math.PI * b) / 2;
        const swoop = Math.sin(Math.PI * k) * box.width * 0.1;
        const x = ax + (to.x - ax) * k;
        const y = ay + (to.y - ay) * k + swoop;
        const z = to.z * k;
        const scale = aScale + (1 - aScale) * k;
        // Hanging in the air it bobs and rocks; the float fades out at both ends, so it leaves and lands exactly.
        const sec = now / 1000;
        const air = smooth(0, 0.3, a) * (1 - k) ** 0.6;
        const bob = Math.sin(sec * 1.6) * innerHeight * 0.012 * air;
        const rockX = Math.sin(sec * 1.1) * 9 * air;
        const rockY = Math.cos(sec * 0.9) * 14 * air;

        const g = ghost.current!;
        g.style.left = `${box.left}px`;
        g.style.top = `${box.top}px`;
        g.style.width = `${box.width}px`;
        // Seen from straight in front while it hangs mid-screen; from the scene's eye once it is down.
        const eyeX = (mid.x / box.width) * 100;
        const eyeY = (mid.y / box.height) * 100;
        inner.style.perspectiveOrigin = `${eyeX + (50 - eyeX) * k}% ${eyeY + (30 - eyeY) * k}%`;
        mover.current!.style.transform = `translate3d(${x}px, ${y + bob}px, ${z}px)`;
        spin.current!.style.transform =
          `rotateX(${tilt * k}rad) rotateZ(${turn * k}rad) rotateX(${aLean * (1 - k) + rockX}deg) rotateY(${aYaw * (1 - k) + turnOnce + rockY}deg) scale(${scale})`;
      }
      turnTo(c, g, d);
      if ((b >= 1) !== down) {
        down = b >= 1;
        setLanded(down);
        sync(down);
      }
      // Keep going while the logo is catching up with the scroll or hanging in the air.
      if (flying || at !== scrollY) queued = requestAnimationFrame(place);
      else last = 0;
    };
    const queue = () => { queued ||= requestAnimationFrame(place); };
    queue();
    addEventListener("scroll", queue, { passive: true });
    addEventListener("resize", queue);
    return () => {
      io.disconnect();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(queued);
      removeEventListener("scroll", queue);
      removeEventListener("resize", queue);
      if (source) source.style.visibility = "";
      if (copy) copy.style.cssText = "";
      if (copyNext) copyNext.style.opacity = "";
      if (title) title.style.cssText = "";
      el.style.transform = "";
      el.style.visibility = "";
      horizon.lift = 0;
    };
  }, []);

  const flags = Array.from({ length: step }, (_, i) => `s${i + 1}`).join(" ");

  return (
    <>
    <div ref={root} className="mf" aria-hidden>
      <div ref={stage} className={`mf-stage ${flags} ${landed ? "is-landed" : "is-waiting"}`}>
        <div className="mf-floor" style={{ ["--hx0" as string]: place.hx.toFixed(2), ["--hy0" as string]: place.hy.toFixed(2), ["--vx" as string]: place.vx.toFixed(2), ["--vy" as string]: place.vy.toFixed(2) }}>
          <span className="mf-grid" />

          <Network ref={net} hub={HUB} onReddit={setLink} onArrive={arrive} />

          {/* Reddit, a coin lying on the floor. */}
          <div className="mf-base is-reddit">
            <span className="mf-glow" />
            <span className="mf-ripple" />
            <span className="mf-ripple is-late" />
            <div className="mf-solid mf-coin">
              <Slices>{(top) => top && <><span className="mf-coin-face" /><Mark path={siReddit.path} className="mf-coin-mark" /></>}</Slices>
            </div>
            <span className="mf-beam" />

            {/* The post, standing straight above it. */}
            <div className="mf-post">
              <div className="mf-post-head">
                <Mark path={siReddit.path} className="mf-reddit-dot" />
                <span className="mf-strong">r/productivity</span>
                <span className="mf-dim">· Create post</span>
              </div>
              <p className="mf-post-text">
                {POST.slice(0, chars)}
                <span className="mf-caret" />
              </p>
              <div className="mf-post-foot">
                <span className="mf-dim">u/maya_writes</span>
                <span className="mf-send">Post</span>
              </div>
              <span className="mf-scan" />
              <svg className="mf-cursor" viewBox="0 0 24 24"><path d="M5 3l14 8-6.2 1.6L10 19z" /></svg>
            </div>
          </div>

          {/* Heardex, its mark lying on the floor the same way. */}
          <div ref={heardex} className="mf-base is-heardex">
            {/* The wire from Reddit, drawn from here (Heardex's centre) so it moves with Heardex on the turn. */}
            <svg className="mf-web" viewBox="0 0 100 100" preserveAspectRatio="none">
              <path d={place.d} className="mf-wire" />
              <path d={place.d} className="mf-wire-core" />
              <path d={place.d} pathLength={1} className="mf-pulse" />
            </svg>
            <span className="mf-glow" />
            <OutlineMask id={outline} />
            <span className="mf-ripple is-shape"><Ring id={outline} /></span>
            <span className="mf-ripple is-shape is-late"><Ring id={outline} /></span>
            <span className="mf-thud"><Ring id={outline} /></span>
            {/* A low wall in the mark's own outline, its top rim lit; it stays as it is while the ripples go out. */}
            <div className="mf-solid mf-outline">
              <Slices>{() => <Ring id={outline} />}</Slices>
            </div>
            <div className="mf-solid mf-hx">
              <Slices>{() => <HeardexMark className="mf-hx-mark" />}</Slices>
            </div>

            {/* The mention, risen out of it. */}
            <div className="mf-mention">
              <div className="mf-mention-head">
                <HeardexMark className="mf-mention-mark" />
                <span className="mf-strong">New mention</span>
                <span className="mf-dim">· just now</span>
              </div>
              <div className="mf-mention-src">
                <span className="mf-badge"><Mark path={siReddit.path} /></span>
                <span className="mf-strong">r/productivity</span>
                <span className="mf-dim">· u/maya_writes</span>
              </div>
              <p className="mf-mention-text">{POST}</p>
              <div className="mf-chips">
                <span className="mf-chip is-red">Negative</span>
                <span className="mf-chip">Bug · PDF export</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    {/* The logo in flight, over everything, in a stage laid over the scene's. */}
    <div ref={ghost} className="mf mf-ghost" aria-hidden>
      <div className="mf-stage">
        <div ref={mover} className="mf-mover">
          <div ref={spin} className="mf-mover">
            <div className="mf-solid mf-hx">
              <Slices fine>{() => <HeardexMark className="mf-hx-mark" />}</Slices>
            </div>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}