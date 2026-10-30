"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";

// The camera's flight into Heardex, after the network (mention-flight.tsx drives it with `poseDive`), drawn in WebGL so
// the mark is a true solid at any distance. It lies on the dotted floor exactly where the flat mark was, and never
// moves; the camera does. It comes down out of the view from overhead until it flies level with the floor, swings in
// from the lower left, turns to face the long gap between the mark's two rows of tiles from its left end, and flies
// into it. Facing the gap, the walls facing it light up white, then every wall does as it goes in, and before the gap
// ends it all fades away, onto the mentions (process.tsx). Units are the drawing's (1085 × 1126), a screen pixel each at PERSPECTIVE away.
const PERSPECTIVE = 1000;
const HEIGHT = 240; // the slab's thickness
const MARK = { x: 423, y: 403, w: 1085, h: 1126 };
// World: x right, y up the page, z up out of the floor. The drawing's y runs down, so it is negated.
const FACE = new THREE.Vector3(MARK.x + MARK.w / 2, -(MARK.y + MARK.h / 2), HEIGHT); // where the camera looks first
const ENTRY = new THREE.Vector3(MARK.x - 40, -965.5, HEIGHT / 2); // the gap's left end, half way up (rows part at y 944–987)
const STANDOFF = 520; // how far out from the gap the camera is once level and facing it
const DEEP = 900; // how far along the gap it flies (it stays inside: the mark ends at 1085)
export const VANISH = [0.76, 0.87] as const; // where along the flight it fades out (the mentions come up as it goes)
const DOTS = 32; // the floor's dot spacing on screen in the network (.nx-fill), so the two floors match

const TILES = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="423 403 1085 1126">
<path d="M423 589a186 186 0 0 1 372 0v309a45 45 0 0 1-45 45H468a45 45 0 0 1-45-45z"/>
<rect x="818" y="564" width="294" height="382" rx="45"/>
<path d="M1137 575a371 371 0 0 1 371 371h-371z"/>
<path d="M423 985h372v372A372 372 0 0 1 423 985z"/>
<rect x="818" y="985" width="287" height="382" rx="45"/>
<path d="M1182 989h281a45 45 0 0 1 45 45v309a186 186 0 0 1-372 0v-309a45 45 0 0 1 46-45z"/>
</svg>`;

const clamp = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (from: number, to: number, v: number) => {
  const t = clamp((v - from) / (to - from));
  return t * t * (3 - 2 * t);
};
const ease = (t: number) => 0.5 - Math.cos(Math.PI * t) / 2;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

type Stage = { pose: (d: number, size: number) => void; dispose: () => void };
const stages = new WeakMap<HTMLElement, Stage>();

function build(root: HTMLElement, canvas: HTMLCanvasElement): Stage {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const fog = new THREE.Fog(0x050506, 2000, 9000);
  scene.fog = fog;
  const camera = new THREE.PerspectiveCamera(50, 1, 1, 200000);

  // The mark: its six tiles extruded, the faces flat white as on the page, the sides lit.
  const caps = new THREE.MeshBasicMaterial({ color: 0xf4f4f5, side: THREE.DoubleSide });
  const grey = new THREE.Color(0x9a9aa2);
  const white = new THREE.Color(0xf4f4f5);
  const sides = new THREE.MeshStandardMaterial({ color: grey, emissive: white, emissiveIntensity: 0, roughness: 0.55, metalness: 0.1, side: THREE.DoubleSide });
  const geometries: THREE.BufferGeometry[] = [];
  for (const path of new SVGLoader().parse(TILES).paths) {
    for (const shape of SVGLoader.createShapes(path)) {
      const g = new THREE.ExtrudeGeometry(shape, { depth: HEIGHT, bevelEnabled: false, curveSegments: 48 });
      g.scale(1, -1, 1); // the drawing's y runs down the page
      geometries.push(g);
      scene.add(new THREE.Mesh(g, [caps, sides]));
    }
  }
  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(-0.6, 0.8, 1);
  scene.add(sun);
  // A light from the camera, along its view: once it faces the gap, the walls facing it are lit white.
  const lamp = new THREE.DirectionalLight(0xffffff, 0);
  scene.add(lamp, lamp.target);

  // The floor: the network's dots, out to where the fog takes them.
  const dot = document.createElement("canvas");
  dot.width = dot.height = 64;
  const ctx = dot.getContext("2d")!;
  ctx.fillStyle = "#34343a";
  ctx.beginPath();
  ctx.arc(32, 32, 2.2, 0, Math.PI * 2);
  ctx.fill();
  const texture = new THREE.CanvasTexture(dot);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const FLOOR = 60000;
  const floorMaterial = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR, FLOOR), floorMaterial);
  floor.position.set(FACE.x, FACE.y, -0.5);
  scene.add(floor);

  const forward = new THREE.Vector3();
  const up = new THREE.Vector3();
  const look = new THREE.Vector3();
  const eye = new THREE.Vector3();
  let width = 0, height = 0;

  const pose = (d: number, size: number) => {
    const on = d > 0 && d < 1;
    root.classList.toggle("is-on", on);
    if (!on) return;
    if (root.clientWidth !== width || root.clientHeight !== height) {
      width = root.clientWidth;
      height = root.clientHeight;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      // As the page's own 3D: a pixel is a unit at PERSPECTIVE away.
      camera.fov = (2 * Math.atan(height / 2 / PERSPECTIVE) * 180) / Math.PI;
      camera.updateProjectionMatrix();
    }
    // The camera tips from looking straight down to looking level along the floor, and turns from facing up the page to
    // facing right, along the gap; facing up the page it is below the mark, facing right to its left, so the turn
    // carries it round the lower left corner. Then it flies on, into the gap.
    const pitch = (Math.PI / 2) * smooth(0.04, 0.5, d);
    const yaw = (Math.PI / 2) * smooth(0.18, 0.55, d);
    forward.set(Math.sin(yaw) * Math.sin(pitch), Math.cos(yaw) * Math.sin(pitch), -Math.cos(pitch));
    up.set(Math.sin(yaw) * Math.cos(pitch), Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch));
    const near = ease(smooth(0, 0.55, d));
    const go = ease(smooth(0.55, 1, d));
    if (go > 0) {
      eye.set(lerp(ENTRY.x - STANDOFF, MARK.x + DEEP, go), ENTRY.y, ENTRY.z);
      look.copy(eye).addScaledVector(forward, 300);
    } else {
      // From the network's view (the mark `size` wide, overhead) to level with the gap's middle, STANDOFF out.
      const from = (PERSPECTIVE * MARK.w) / size;
      const dist = Math.exp(lerp(Math.log(from), Math.log(STANDOFF), near));
      look.lerpVectors(FACE, ENTRY, near);
      eye.copy(look).addScaledVector(forward, -dist);
    }
    camera.position.copy(eye);
    camera.up.copy(up);
    camera.lookAt(look);
    const span = eye.distanceTo(look);
    fog.near = span + 600;
    fog.far = span + 7000;
    // The floor's dots spaced as the network's, coming up as the network goes.
    texture.repeat.setScalar(FLOOR / ((DOTS * MARK.w) / size));
    floorMaterial.opacity = smooth(0.08, 0.3, d);
    // Facing the gap, the walls facing it go white; going in, every wall does; then it all goes, before the gap ends.
    const facing = smooth(0.42, 0.56, d);
    sides.color.lerpColors(grey, white, facing);
    lamp.intensity = 2.4 * facing;
    sun.intensity = 1.6 * (1 - facing);
    lamp.position.copy(eye);
    lamp.target.position.copy(look);
    sides.emissiveIntensity = 0.85 * smooth(0.6, 0.74, d);
    canvas.style.opacity = `${1 - smooth(VANISH[0], VANISH[1], d)}`;
    renderer.render(scene, camera);
  };

  return {
    pose,
    dispose: () => {
      geometries.forEach((g) => g.dispose());
      floor.geometry.dispose();
      [caps, sides, floorMaterial].forEach((m) => m.dispose());
      texture.dispose();
      renderer.dispose();
    },
  };
}

/** Places the camera, `d` 0..1 along the flight. `size` is the mark's width on screen at the start (the network's hub). */
export function poseDive(root: HTMLElement, d: number, size: number) {
  stages.get(root)?.pose(d, size);
}

/** The canvas the flight is drawn on; hidden until it starts. */
export function Dive() {
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = root.current!;
    const stage = build(el, canvas.current!);
    stages.set(el, stage);
    return () => {
      stages.delete(el);
      stage.dispose();
    };
  }, []);

  return (
    <div ref={root} data-dive className="dv" aria-hidden>
      <canvas ref={canvas} className="block h-full w-full" />
    </div>
  );
}
