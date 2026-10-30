"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

// The hero's 3D object: the Heardex EX mark lying horizontal, extruded from the logo's own
// outlines. It starts as the first letters of the wordmark, grows as the page scrolls, and a red
// light flows in from the left behind it and completes the blade.

// Logo outlines in the drawing's 2000px units (see src/components/brand.tsx).
const LETTERS: [number, number][][] = [
  [[554, 750], [642, 750], [642, 1330], [554, 1330]],
  [[554, 997], [801, 997], [801, 1084], [554, 1084]],
  [[554, 750], [965, 750], [1458, 1242], [1540, 1242], [1540, 1330], [1418, 1330], [927, 838], [554, 838]],
  [[554, 1330], [965, 1330], [1458, 838], [1540, 838], [1540, 750], [1418, 750], [927, 1242], [554, 1242]],
];
const BLADE: [number, number][] = [[274, 1040], [352, 997], [1505, 997], [1584, 1040], [1505, 1084], [352, 1084]];
const CX = 929, CY = 1040, UNIT = 1 / 300;
/** Letters' width and their centre's offset from the sword's centre, in units at scale 1. */
export const LETTERS_W = (1540 - 554) * UNIT;
const LETTERS_DX = ((554 + 1540) / 2 - CX) * UNIT;
const BLADE_L = (274 - CX) * UNIT, BLADE_R = (1584 - CX) * UNIT;
const HALF = (BLADE_R - BLADE_L) / 2;

function shapeOf(points: [number, number][]) {
  const s = new THREE.Shape();
  points.forEach(([x, y], i) => (i ? s.lineTo : s.moveTo).call(s, (x - CX) * UNIT, -(y - CY) * UNIT));
  s.closePath();
  return s;
}

function extrude(points: [number, number][], depth: number, bevel: number) {
  const g = new THREE.ExtrudeGeometry(shapeOf(points), {
    depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, steps: 1, curveSegments: 1,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** What the page tells the scene, written by the scroll timeline and read every frame. */
export interface SwordState {
  /** 0 = the mark sits in the wordmark; 1 = it is large in the middle of the screen. */
  grow: number;
  /** How much of the blade the light has drawn, left to right. */
  draw: number;
  /** Strength of the light trail behind the mark. */
  trail: number;
  /** The horizontal track's offset in CSS px (negative as it moves left). */
  shiftPx: number;
  pointerX: number;
  pointerY: number;
  /** The empty slot in the wordmark the mark starts in. */
  anchor: HTMLElement | null;
}
export type SwordRef = React.RefObject<SwordState>;

function Studio() {
  const gl = useThree((s) => s.gl);
  const env = useMemo(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    return texture;
  }, [gl]);
  useEffect(() => () => env.dispose(), [env]);
  return <primitive object={env} attach="environment" />;
}

const TRAIL_VERT = /* glsl */ `
varying vec2 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xy;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

// Wavy lines of red light hugging the mark above and below, flowing left to right and
// converging to a point past the blade's tip, over a low haze the black letters stand against.
const TRAIL_FRAG = /* glsl */ `
uniform float uTime, uTrail, uHead, uHalf;
uniform vec2 uCenter;
varying vec2 vWorld;
float hash(float n) { return fract(sin(n) * 43758.5453); }
float noise(float x) { float i = floor(x), f = fract(x); return mix(hash(i), hash(i + 1.0), f * f * (3.0 - 2.0 * f)) * 2.0 - 1.0; }
void main() {
  vec2 p = (vWorld - uCenter) / uHalf;
  // Envelope: widest around the letters, closing to a point past the right tip, tapering left.
  float right = clamp(1.0 - (p.x - 0.55) / 1.15, 0.0, 1.0);
  float left = clamp((p.x + 1.25) / 0.75, 0.0, 1.0);
  float env = 0.5 * pow(right, 0.75) * sqrt(left);
  float light = 0.0;
  for (int i = 0; i < 9; i++) {
    float fi = float(i);
    float o = (fi / 8.0) * 2.0 - 1.0;
    o = sign(o) * (0.62 + 0.38 * abs(o)) * (i == 4 ? 0.0 : 1.0);
    float wob = noise(p.x * 3.2 - uTime * (0.9 + 0.15 * fi) + fi * 7.1) * 0.09 + noise(p.x * 9.0 - uTime * 2.2 + fi * 3.3) * 0.025;
    float y = o * env * (1.08 + 0.08 * sin(uTime * 0.7 + fi)) + wob * env * 2.0;
    float th = 0.008 + 0.006 * env;
    float line = exp(-pow((p.y - y) / th, 2.0));
    float flow = 0.55 + 0.45 * sin(p.x * 7.0 - uTime * 3.4 + fi * 1.7);
    light += line * flow * (i == 4 ? 0.0 : 1.0);
  }
  float haze = exp(-pow(p.y / max(env * 1.1, 0.001), 2.0)) * 0.09 * step(0.0001, env);
  // The light arrives from the left: nothing to the right of its head.
  float reveal = smoothstep(uHead + 0.05, uHead - 0.35, p.x);
  float a = (light * 1.6 + haze) * reveal * uTrail;
  gl_FragColor = vec4(vec3(1.0, 0.16, 0.1) * a + vec3(1.0, 0.75, 0.6) * light * 0.35 * reveal * uTrail, 1.0);
}`;

function Trail({ uniforms, material }: { uniforms: Record<string, THREE.IUniform>; material: React.RefObject<THREE.ShaderMaterial | null> }) {
  return (
    <mesh position={[0, 0, -1.2]}>
      <planeGeometry args={[60, 30]} />
      <shaderMaterial ref={material} vertexShader={TRAIL_VERT} fragmentShader={TRAIL_FRAG} uniforms={uniforms}
        blending={THREE.AdditiveBlending} depthWrite={false} transparent toneMapped={false} />
    </mesh>
  );
}

function headTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, "rgba(255,240,230,1)");
  r.addColorStop(0.2, "rgba(255,90,60,0.9)");
  r.addColorStop(1, "rgba(255,40,20,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function Sword({ state }: { state: SwordRef }) {
  const group = useRef<THREE.Group>(null);
  const head = useRef<THREE.Sprite>(null);
  const trail = useRef<THREE.ShaderMaterial>(null);
  const blade = useRef<THREE.MeshPhysicalMaterial>(null);
  const { size, camera } = useThree();
  const geo = useMemo(() => ({
    letters: LETTERS.map((p) => extrude(p, 0.36, 0.04)),
    blade: extrude(BLADE, 0.14, 0.03),
  }), []);
  useEffect(() => () => { geo.letters.forEach((g) => g.dispose()); geo.blade.dispose(); }, [geo]);
  const clip = useMemo(() => new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0), []);
  const headTex = useMemo(() => headTexture(), []);
  useEffect(() => () => headTex.dispose(), [headTex]);
  const uniforms = useMemo(() => ({
    uTime: { value: 0 }, uTrail: { value: 0 }, uHead: { value: -2 }, uHalf: { value: 1 }, uCenter: { value: new THREE.Vector2() },
  }), []);
  const v = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ clock }, dt) => {
    const g = group.current;
    const s = state.current;
    if (!g || !s) return;
    const persp = camera as THREE.PerspectiveCamera;
    // World units per CSS px at the mark's depth.
    const k = (2 * persp.position.z * Math.tan(THREE.MathUtils.degToRad(persp.fov / 2))) / size.height;
    const toX = (px: number) => (px - size.width / 2) * k;
    const toY = (py: number) => -(py - size.height / 2) * k;
    const e = THREE.MathUtils.smootherstep(s.grow, 0, 1);

    // Start: the letters fill the wordmark's empty slot exactly.
    const r = s.anchor?.getBoundingClientRect();
    const s0 = r ? (r.width * k) / LETTERS_W : 0.3;
    const x0 = r ? toX(r.left + r.width / 2) - LETTERS_DX * s0 : 0;
    const y0 = r ? toY(r.top + r.height / 2) : 0;
    // End: the whole sword across most of the screen, centred, moving with the track.
    const wide = size.width >= 768;
    // Keep in step with meetPx() in story.tsx.
    const s1 = Math.min((size.width * (wide ? 0.78 : 0.94) * k) / (HALF * 2), (size.height * 0.5 * k) / 1.93);
    const x1 = s.shiftPx * k;
    const y1 = wide ? 0 : 0.1 * size.height * k;

    g.scale.setScalar(THREE.MathUtils.lerp(s0, s1, e));
    g.position.set(THREE.MathUtils.lerp(x0, x1, e), THREE.MathUtils.lerp(y0, y1, e), 0);
    const t = clock.elapsedTime;
    const swing = Math.sin(e * Math.PI);
    const k2 = 1 - Math.exp(-dt * 5);
    g.rotation.y += (swing * -0.55 + s.pointerX * 0.16 * e + Math.sin(t * 0.5) * 0.04 * e - g.rotation.y) * k2;
    g.rotation.x += (swing * 0.18 - s.pointerY * 0.1 * e - g.rotation.x) * k2;

    // The blade exists only left of the light's head.
    const headLocal = THREE.MathUtils.lerp(BLADE_L - 0.05, BLADE_R + 0.05, s.draw);
    g.updateMatrixWorld();
    v.set(headLocal, 0, 0);
    g.localToWorld(v);
    const plane = blade.current?.clippingPlanes?.[0];
    if (plane) plane.constant = s.draw >= 1 ? 1e6 : v.x;
    if (head.current) {
      head.current.position.copy(v);
      const on = s.draw > 0 && s.draw < 1 ? 1 : 0;
      const sc = g.scale.x * 0.45 * on;
      head.current.scale.set(sc * 1.4, sc, 1);
    }

    const u = trail.current?.uniforms;
    if (u) {
      u.uTime!.value = t;
      u.uTrail!.value = s.trail;
      u.uHalf!.value = HALF * g.scale.x;
      (u.uCenter!.value as THREE.Vector2).set(g.position.x, g.position.y);
      // The trail's head runs a little ahead of the blade's and on past the tip once it is whole.
      u.uHead!.value = THREE.MathUtils.lerp(-1.3, 2.2, s.draw);
    }
  });

  return (
    <>
      <Trail uniforms={uniforms} material={trail} />
      <group ref={group}>
        {geo.letters.map((g, i) => (
          <mesh key={i} geometry={g}>
            <meshPhysicalMaterial color="#1c1c20" metalness={0.9} roughness={0.2} clearcoat={1} clearcoatRoughness={0.08} envMapIntensity={2.2} />
          </mesh>
        ))}
        <mesh geometry={geo.blade}>
          <meshPhysicalMaterial ref={blade} color="#ff3b2f" metalness={0.2} roughness={0.3} clearcoat={1} clearcoatRoughness={0.1}
            emissive="#ff2414" emissiveIntensity={0.85} clippingPlanes={[clip]} toneMapped={false} />
        </mesh>
      </group>
      <sprite ref={head} scale={[0, 0, 1]}>
        <spriteMaterial map={headTex} blending={THREE.AdditiveBlending} depthWrite={false} transparent toneMapped={false} />
      </sprite>
      <pointLight position={[0, 0, 1.5]} color="#ff3b2f" intensity={6} distance={8} />
    </>
  );
}

export default function SwordScene({ state, paused, still }: { state: SwordRef; paused: boolean; still: boolean }) {
  return (
    <Canvas
      dpr={[1, 1.75]}
      camera={{ position: [0, 0, 10], fov: 30 }}
      gl={{ antialias: true, localClippingEnabled: true } as THREE.WebGLRendererParameters}
      onCreated={({ gl }) => { gl.localClippingEnabled = true; }}
      frameloop={paused ? "never" : still ? "demand" : "always"}
      aria-hidden
    >
      <color attach="background" args={["#050506"]} />
      <Studio />
      <directionalLight position={[-3, 4, 6]} intensity={0.8} />
      <Sword state={state} />
      <EffectComposer multisampling={4}>
        <Bloom mipmapBlur intensity={0.85} luminanceThreshold={0.62} luminanceSmoothing={0.2} radius={0.7} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      </EffectComposer>
    </Canvas>
  );
}
