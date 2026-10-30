// Vehicles: models built from extruded side profiles, and an arcade driving model.
import * as THREE from '../lib/three.module.min.js';
import { terrainH, groundH, surfaceAt, clamp } from './roads.js';
import { collidersNear, COLLIDE } from './world.js';
import { MAP } from './mapdata.js';

export const VEHICLES = {
  suv:      { zh: '家庭休旅車', en: 'Family SUV', color: '#2f5d8a', L: 4.8, W: 1.95, vmax: 46, acc: 5.2, brake: 9, steer: 0.6, wb: 2.85, grip: 9, unlock: 0 },
  minivan:  { zh: '休旅廂型車', en: 'Minivan', color: '#c9ccd0', L: 5.1, W: 2.0, vmax: 44, acc: 4.6, brake: 8.5, steer: 0.58, wb: 3.0, grip: 8.5, unlock: 0 },
  sports:   { zh: '紅色跑車', en: 'Sports car', color: '#d0202a', L: 4.5, W: 1.9, vmax: 62, acc: 8.5, brake: 11, steer: 0.62, wb: 2.6, grip: 11, unlock: 6 },
  police:   { zh: '警車', en: 'Police car', color: '#f4f4f4', L: 5.0, W: 1.95, vmax: 56, acc: 7.0, brake: 10, steer: 0.6, wb: 2.9, grip: 10, unlock: 10 },
  icecream: { zh: '冰淇淋車', en: 'Ice cream truck', color: '#fbfbf6', L: 6.0, W: 2.2, vmax: 32, acc: 3.6, brake: 7, steer: 0.55, wb: 3.6, grip: 7.5, unlock: 0 },
  garbage:  { zh: '垃圾車', en: 'Garbage truck', color: '#2f7a3d', L: 8.4, W: 2.5, vmax: 28, acc: 2.8, brake: 6.5, steer: 0.55, wb: 4.8, grip: 7, unlock: 0 },
  bus:      { zh: '黃色校車', en: 'School bus', color: '#f3b10b', L: 11.0, W: 2.5, vmax: 30, acc: 2.6, brake: 6, steer: 0.6, wb: 6.2, grip: 7, unlock: 0 },
  sedan:    { zh: '轎車', en: 'Sedan', color: '#888', L: 4.8, W: 1.85, vmax: 50, acc: 5.5, brake: 9, steer: 0.6, wb: 2.8, grip: 9, unlock: 0, ai: true },
  taxi:     { zh: '計程車', en: 'Taxi', color: '#f6c21c', L: 4.9, W: 1.9, vmax: 50, acc: 5.8, brake: 9.5, steer: 0.6, wb: 2.85, grip: 9.5, unlock: 0 },
  pizza:    { zh: '小型掀背車', en: 'Hatchback', color: '#f08a24', L: 4.1, W: 1.8, vmax: 44, acc: 6.0, brake: 9.5, steer: 0.62, wb: 2.5, grip: 9.5, unlock: 0 },
};

const glassM = new THREE.MeshLambertMaterial({ color: '#2c4258', emissive: '#0c1622' });
const tireM = new THREE.MeshLambertMaterial({ color: '#1a1a1a' });
const hubM = new THREE.MeshLambertMaterial({ color: '#b8bcc0' });
const darkM = new THREE.MeshLambertMaterial({ color: '#2a2a2a' });
const chromeM = new THREE.MeshLambertMaterial({ color: '#d0d4d8' });

function extrude(points, width, mat, bevel = 0.06) {
  const s = new THREE.Shape(points.map(p => new THREE.Vector2(p[0], p[1])));
  const g = new THREE.ExtrudeGeometry(s, { depth: width - bevel * 2, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 4 });
  g.rotateY(-Math.PI / 2);
  g.translate(width / 2 - bevel, 0, 0);
  const m = new THREE.Mesh(g, mat); m.castShadow = true; return m;
}
function box(w, h, d, mat, x, y, z) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; return m; }
function textPlane(w, h, draw, px = 256) {
  const c = document.createElement('canvas'); c.width = px; c.height = Math.round(px * h / w);
  draw(c.getContext('2d'), c.width, c.height);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: t, transparent: true }));
}

// a car-shaped body from a few numbers
function carBody(o, mat) {
  const { L, W, bot = 0.32, hood, roof, wsX, topF, topR, rearX, tail, belt } = o;
  const h2 = L / 2;
  const body = [[-h2 + 0.08, bot], [h2 - 0.08, bot], [h2, bot + 0.25], [h2 - 0.06, hood - 0.08], [h2 - 0.25, hood], [wsX, hood + 0.06], [topF, roof], [topR, roof], [rearX, tail], [-h2 + 0.05, tail - 0.06], [-h2, bot + 0.25]];
  const g = new THREE.Group();
  g.add(extrude(body, W, mat));
  // glass band: between the belt line and the roof, following the windscreen and rear window
  const onLine = (a, b, y) => Math.abs(b[1] - a[1]) < 1e-3 ? b[0] : a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]);
  const E = [wsX, hood + 0.06], F = [topF, roof], G = [topR, roof], H = [rearX, tail];
  const yb = Math.max(belt, hood + 0.07), yt = roof - 0.02;
  const yr = Math.max(belt, tail + 0.01);
  // the body's bevel grows its outline by 0.06, so the glass sits 0.085 proud of the profile lines
  const go = 0.085;
  const glass = [[onLine(E, F, yb) + go, yb], [onLine(E, F, yt) + go, yt], [onLine(G, H, yt) - go, yt], [onLine(G, H, yr) - go, yr], [onLine(G, H, yr) - go, yb]];
  const gm = extrude(glass, W + 0.03, glassM, 0.0); gm.castShadow = false; g.add(gm);
  // B pillar
  const pil = box(W + 0.05, yt - yb, 0.12, mat, 0, (yt + yb) / 2, (topF + topR) / 2 + 0.15); g.add(pil);
  return g;
}

function wheel(r, w) {
  const g = new THREE.Group();
  const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 16), tireM); t.rotation.z = Math.PI / 2; t.castShadow = true; g.add(t);
  const h = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.6, r * 0.6, w + 0.02, 10), hubM); h.rotation.z = Math.PI / 2; g.add(h);
  const spoke = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, r * 0.15, r * 1.1), darkM); g.add(spoke);
  return g;
}

export function buildVehicle(kind, color) {
  const V = VEHICLES[kind];
  const paint = new THREE.MeshLambertMaterial({ color: color || V.color });
  const root = new THREE.Group();     // positioned on the road
  const body = new THREE.Group();     // leans and pitches
  root.add(body);
  const L = V.L, W = V.W;
  const parts = { paint, lights: [], brake: [], beacons: [] };
  let wr = 0.36, axF = V.wb / 2, axR = -V.wb / 2, track = W / 2 - 0.18;
  if (kind === 'suv') body.add(carBody({ L, W, hood: 1.02, roof: 1.78, wsX: 1.05, topF: 0.35, topR: -2.05, rearX: -2.32, tail: 1.1, belt: 1.12 }, paint));
  if (kind === 'minivan') body.add(carBody({ L, W, hood: 0.98, roof: 1.82, wsX: 1.55, topF: 0.7, topR: -2.25, rearX: -2.5, tail: 1.05, belt: 1.08 }, paint));
  if (kind === 'pizza') {
    body.add(carBody({ L, W, hood: 0.92, roof: 1.5, wsX: 0.95, topF: 0.25, topR: -1.55, rearX: -2.0, tail: 1.0, belt: 1.0 }, paint));
    const sign = textPlane(0.9, 0.35, (g, w, h) => { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.fillStyle = '#d02020'; g.font = `bold ${h * 0.6}px Arial`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('PIZZA', w / 2, h / 2); });
    const s2 = sign.clone(); sign.position.set(0, 1.72, -0.5); sign.rotation.y = Math.PI / 2; s2.position.set(0, 1.72, -0.5); s2.rotation.y = -Math.PI / 2;
    body.add(box(0.1, 0.36, 0.9, new THREE.MeshLambertMaterial({ color: '#fff' }), 0, 1.72, -0.5), sign, s2);
    wr = 0.32;
  }
  if (kind === 'sports') {
    body.add(carBody({ L, W, bot: 0.25, hood: 0.78, roof: 1.25, wsX: 0.75, topF: -0.1, topR: -0.9, rearX: -1.75, tail: 0.92, belt: 0.86 }, paint));
    body.add(box(W * 0.9, 0.06, 0.3, darkM, 0, 1.0, -L / 2 + 0.15));
    wr = 0.34;
  }
  if (kind === 'sedan') body.add(carBody({ L, W, hood: 0.9, roof: 1.47, wsX: 0.95, topF: 0.25, topR: -1.15, rearX: -1.75, tail: 0.98, belt: 0.96 }, paint));
  if (kind === 'taxi') {
    body.add(carBody({ L, W, hood: 0.9, roof: 1.47, wsX: 0.95, topF: 0.25, topR: -1.15, rearX: -1.75, tail: 0.98, belt: 0.96 }, paint));
    const sign = textPlane(0.8, 0.28, (g, w, h) => { g.fillStyle = '#111'; g.fillRect(0, 0, w, h); g.fillStyle = '#ffd23f'; g.font = `bold ${h * 0.7}px Arial`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('TAXI', w / 2, h / 2); });
    const s2 = sign.clone(); sign.position.set(0, 1.66, -0.35); s2.position.set(0, 1.66, -0.35); s2.rotation.y = Math.PI;
    body.add(box(0.85, 0.3, 0.3, new THREE.MeshLambertMaterial({ color: '#111' }), 0, 1.65, -0.35), sign, s2);
    for (let i = 0; i < 6; i++) body.add(box(W + 0.03, 0.1, 0.25, new THREE.MeshLambertMaterial({ color: i % 2 ? '#111' : '#fff' }), 0, 0.82, -0.6 + i * 0.25));
  }
  if (kind === 'police') {
    body.add(carBody({ L, W, hood: 0.92, roof: 1.5, wsX: 1.0, topF: 0.3, topR: -1.15, rearX: -1.75, tail: 1.0, belt: 0.98 }, paint));
    // black lower doors and bonnet like a California black-and-white
    const black = new THREE.MeshLambertMaterial({ color: '#111' });
    body.add(box(W + 0.04, 0.5, 2.0, black, 0, 0.62, 0.1));
    body.add(box(W - 0.1, 0.06, 1.3, black, 0, 0.94, 1.75));
    body.add(box(W - 0.2, 0.06, 1.0, black, 0, 1.03, -2.05));
    const bar = new THREE.Group(); bar.position.y = 1.58; bar.position.z = -0.4; body.add(bar);
    const red = new THREE.MeshBasicMaterial({ color: '#ff2020' }), blue = new THREE.MeshBasicMaterial({ color: '#2060ff' });
    const r1 = box(0.6, 0.14, 0.3, red, -0.35, 0, 0), b1 = box(0.6, 0.14, 0.3, blue, 0.35, 0, 0);
    bar.add(r1, b1); parts.beacons.push({ m: r1, col: '#ff2020' }, { m: b1, col: '#2060ff' });
    const tx = textPlane(1.6, 0.28, (g, w, h) => { g.fillStyle = '#111'; g.font = `bold ${h * 0.8}px Arial`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('POLICE', w / 2, h / 2); });
    const t2 = tx.clone(); tx.position.set(W / 2 + 0.03, 1.15, -1.0); tx.rotation.y = Math.PI / 2; t2.position.set(-W / 2 - 0.03, 1.15, -1.0); t2.rotation.y = -Math.PI / 2; body.add(tx, t2);
  }
  if (kind === 'icecream') {
    const cab = carBody({ L: 2.4, W, hood: 1.1, roof: 2.2, wsX: 0.75, topF: 0.15, topR: -1.2, rearX: -1.2, tail: 2.2, belt: 1.25 }, paint);
    cab.position.z = L / 2 - 1.2; body.add(cab);
    const boxM = new THREE.MeshLambertMaterial({ color: '#fbfbf6' });
    body.add(box(W, 2.2, L - 2.3, boxM, 0, 0.32 + 1.1, -1.15));
    const stripe = new THREE.MeshLambertMaterial({ color: '#f07cb0' });
    body.add(box(W + 0.03, 0.3, L - 2.3, stripe, 0, 0.9, -1.15));
    const panel = textPlane(2.6, 1.0, (g, w, h) => {
      g.fillStyle = '#7fd3f0'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.font = `bold ${h * 0.36}px Arial`; g.textAlign = 'center'; g.fillText('ICE CREAM', w / 2, h * 0.42);
      g.font = `${h * 0.3}px Arial`; g.fillText('🍦 🍨 🍧', w / 2, h * 0.85);
    });
    const p2 = panel.clone(); panel.position.set(W / 2 + 0.02, 1.75, -1.0); panel.rotation.y = Math.PI / 2; p2.position.set(-W / 2 - 0.02, 1.75, -1.0); p2.rotation.y = -Math.PI / 2;
    body.add(panel, p2);
    // giant cone on the roof
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.0, 12), new THREE.MeshLambertMaterial({ color: '#d9a35a' })); cone.rotation.x = Math.PI; cone.position.set(0, 3.05, -1.5);
    const scoop = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), new THREE.MeshLambertMaterial({ color: '#f7a8c8' })); scoop.position.set(0, 3.65, -1.5);
    body.add(cone, scoop);
    wr = 0.42;
  }
  if (kind === 'garbage') {
    const cabM = new THREE.MeshLambertMaterial({ color: '#f2f2f2' });
    const cab = carBody({ L: 2.5, W, bot: 0.55, hood: 1.6, roof: 2.9, wsX: 1.0, topF: 0.8, topR: -1.2, rearX: -1.25, tail: 2.9, belt: 1.75 }, cabM);
    cab.position.z = L / 2 - 1.25; body.add(cab);
    body.add(box(W, 2.6, L - 2.6, paint, 0, 0.6 + 1.3, -1.3));
    body.add(box(W - 0.2, 2.2, 0.6, paint, 0, 1.7, -L / 2 + 0.1));
    body.add(box(W + 0.02, 0.18, L - 2.6, new THREE.MeshLambertMaterial({ color: '#f2c230' }), 0, 1.3, -1.3));
    // arm for picking up bins
    const arm = new THREE.Group(); arm.position.set(-W / 2 - 0.1, 1.2, 0.6);   // kerb side (right = local -x)
    arm.add(box(0.15, 0.15, 1.2, darkM, -0.1, 0, 0)); arm.add(box(0.5, 0.6, 0.15, darkM, -0.3, -0.2, 0.55));
    body.add(arm); parts.arm = arm;
    wr = 0.52; track = W / 2 - 0.25;
  }
  if (kind === 'bus') {
    const busM = paint;
    body.add(extrude([[-L / 2, 0.45], [L / 2 - 0.1, 0.45], [L / 2, 0.6], [L / 2, 1.35], [L / 2 - 1.0, 1.55], [L / 2 - 1.25, 3.0], [-L / 2 + 0.1, 3.0], [-L / 2, 2.9], [-L / 2, 0.6]], W, busM, 0.1));
    // window strip and black rub rails
    const win = extrude([[-L / 2 + 0.6, 1.95], [L / 2 - 1.28, 1.95], [L / 2 - 1.22, 2.75], [-L / 2 + 0.6, 2.75]], W + 0.03, glassM, 0);
    body.add(win);
    for (let i = 0; i < 9; i++) body.add(box(W + 0.05, 0.8, 0.12, busM, 0, 2.35, -L / 2 + 1.4 + i * 1.0));
    for (const y of [0.95, 1.45]) body.add(box(W + 0.04, 0.08, L - 0.4, new THREE.MeshLambertMaterial({ color: '#111' }), 0, y, 0));
    const label = textPlane(4.0, 0.42, (g, w, h) => { g.fillStyle = '#111'; g.font = `bold ${h * 0.78}px Arial`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('SCHOOL BUS', w / 2, h / 2); });
    const l2 = label.clone(); label.position.set(W / 2 + 0.04, 1.72, -0.8); label.rotation.y = Math.PI / 2; l2.position.set(-W / 2 - 0.04, 1.72, -0.8); l2.rotation.y = -Math.PI / 2;
    body.add(label, l2);
    // stop arm on the driver's side
    const stop = new THREE.Mesh(new THREE.CircleGeometry(0.3, 8), new THREE.MeshLambertMaterial({ color: '#c8102e', side: THREE.DoubleSide }));
    stop.position.set(W / 2 + 0.05, 2.0, L / 2 - 2.2); stop.rotation.y = Math.PI / 2; body.add(stop); parts.stopArm = stop;
    for (const s of [-1, 1]) { const amber = box(0.25, 0.18, 0.05, new THREE.MeshBasicMaterial({ color: '#ffb000' }), s * 0.8, 2.85, L / 2 - 1.18); body.add(amber); }
    wr = 0.5; axF = L / 2 - 1.6; axR = axF - V.wb; track = W / 2 - 0.25;
  }
  // side mirrors and grille on cars
  if (['suv', 'minivan', 'sedan', 'taxi', 'police', 'pizza', 'sports'].includes(kind)) {
    const my = kind === 'sports' ? 0.95 : 1.12, mz = { suv: 0.95, minivan: 1.4, sports: 0.6 }[kind] ?? 0.85;
    for (const s of [-1, 1]) body.add(box(0.22, 0.14, 0.12, paint, s * (W / 2 + 0.1), my, mz));
    body.add(box(W * 0.5, 0.18, 0.04, darkM, 0, kind === 'sports' ? 0.5 : 0.62, L / 2 + 0.03));
  }
  // lights
  const head = new THREE.MeshBasicMaterial({ color: '#fff8e0' });
  const tailM = new THREE.MeshBasicMaterial({ color: '#7a1010' });
  const hy = kind === 'bus' ? 1.0 : kind === 'garbage' ? 1.1 : kind === 'sports' ? 0.62 : 0.78;
  for (const s of [-1, 1]) {
    const h = box(0.36, 0.13, 0.05, head, s * (W / 2 - 0.3), hy, L / 2 + 0.01); body.add(h); parts.lights.push(h);
    const t = box(0.3, 0.14, 0.05, tailM, s * (W / 2 - 0.25), hy + 0.12, -L / 2 - 0.01); body.add(t); parts.brake.push(t);
  }
  parts.tailM = tailM;
  // bumpers
  if (!['bus', 'garbage'].includes(kind)) { body.add(box(W - 0.05, 0.22, 0.12, chromeM, 0, 0.42, L / 2 + 0.02)); body.add(box(W - 0.05, 0.22, 0.12, darkM, 0, 0.42, -L / 2 - 0.02)); }
  // wheels
  const wheels = [];
  for (const [z, front] of [[axF, true], [axR, false]]) for (const s of [-1, 1]) {
    const piv = new THREE.Group(); piv.position.set(s * track, wr, z);
    const w = wheel(wr, 0.26); piv.add(w); root.add(piv);
    wheels.push({ piv, w, front });
  }
  return { root, body, wheels, parts, V, wr };
}

// ---------- driving model ----------
const ROLL = [0.15, 0.25, 1.1, 1.0, 2.6];      // rolling resistance (m/s²) by surface
const GRIPS = [1, 1, 0.75, 0.8, 0.5];
export class Driver {
  constructor(kind, x, z, h) {
    this.V = VEHICLES[kind]; this.kind = kind;
    this.x = x; this.z = z; this.h = h;
    this.vx = 0; this.vz = 0; this.vf = 0; this.vs = 0;
    this.steer = 0; this.yawRate = 0; this.y = terrainH(x, z);
    this.pitch = 0; this.roll = 0; this.lean = 0; this.dive = 0;
    this.surface = 0; this.sCount = 0; this.wheelSpin = 0;
    this.impact = 0; this.hitTag = null; this.braking = false; this.reversing = false;
    this.vy = 0; this.air = false; this.airT = 0; this.landed = null; this.health = 100;
  }
  get speed() { return Math.hypot(this.vx, this.vz); }
  update(dt, inp, others) {
    const V = this.V;
    if (this.air) return this.flyStep(dt, others);
    if (this.health <= 0) inp = { ...inp, throttle: 0 };
    const fx = Math.sin(this.h), fz = Math.cos(this.h);
    const rx = -fz, rz = fx;   // right-hand side (x east, z south)
    let vf = this.vx * fx + this.vz * fz, vs = this.vx * rx + this.vz * rz;
    if ((this.sCount = (this.sCount + 1) % 4) === 0) this.surface = surfaceAt(this.x, this.z);
    const surf = this.surface;
    // steering: slower and smaller at speed
    const sIn = clamp(inp.steer, -1, 1);
    const rate = 2.6 + (Math.abs(sIn) < 0.05 ? 2.0 : 0);
    this.steer += clamp(sIn - this.steer, -rate * dt, rate * dt);
    const delta = this.steer * V.steer / (1 + Math.abs(vf) * Math.abs(vf) / 420);
    // engine and brakes
    let a = 0; this.braking = false; this.reversing = false;
    const thr = clamp(inp.throttle, 0, 1), brk = clamp(inp.brake, 0, 1);
    const top = V.vmax * (surf >= 2 ? 0.55 : 1);
    if (thr > 0) {
      if (vf < -0.4) { a += V.brake * thr; this.braking = true; }
      else a += V.acc * thr * Math.max(0, 1 - (vf / top) ** 2);
    }
    if (brk > 0) {
      if (vf > 0.4) { a -= V.brake * brk; this.braking = true; }
      else { a -= V.acc * 0.6 * brk * Math.max(0, 1 - (-vf / 9) ** 2); this.reversing = true; }
    }
    if (inp.hand) { a -= Math.sign(vf) * Math.min(Math.abs(vf) / dt, 5); this.braking = true; }
    // resistance and slope
    a -= Math.sign(vf) * Math.min(Math.abs(vf) / dt, ROLL[surf] + 0.0006 * vf * vf * 8);
    const s1 = terrainH(this.x + fx * 1.5, this.z + fz * 1.5), s0 = terrainH(this.x - fx * 1.5, this.z - fz * 1.5);
    a -= 9.8 * (s1 - s0) / 3 * 0.9;
    vf += a * dt;
    if (thr === 0 && brk === 0 && Math.abs(vf) < 0.15 && Math.abs(s1 - s0) < 0.2) vf = 0;
    // yaw from steering geometry, limited by tyre grip
    const grip = V.grip * GRIPS[surf] * (inp.hand ? 0.2 : 1);
    let yaw = -vf * Math.tan(delta) / V.wb;   // +h turns left (x east, z south)
    const maxLat = 8.5 * GRIPS[surf] * (inp.hand ? 0.6 : 1);
    const lim = maxLat / Math.max(2, Math.abs(vf));
    if (!inp.hand) yaw = clamp(yaw, -lim, lim);
    else yaw *= 1.35;
    this.yawRate += (yaw - this.yawRate) * Math.min(1, dt * 10);
    this.h += this.yawRate * dt;
    // sideways slip decays with grip; with the handbrake the tail steps out
    vs *= Math.exp(-grip * dt);
    if (inp.hand && Math.abs(vf) > 6) vs -= this.yawRate * Math.abs(vf) * 0.12 * dt * 10;
    this.drift = Math.abs(vs);
    const nfx = Math.sin(this.h), nfz = Math.cos(this.h);
    this.vx = nfx * vf + (-nfz) * vs; this.vz = nfz * vf + nfx * vs;
    this.vf = vf; this.vs = vs;
    // move and collide
    this.x += this.vx * dt; this.z += this.vz * dt;
    this.impact = 0; this.hitTag = null;
    this.collide(others);
    // keep inside the map
    const m = 6;
    if (this.x < MAP.xmin + m) { this.x = MAP.xmin + m; this.vx = Math.abs(this.vx) * 0.3; this.impact = 3; this.hitTag = 'edge'; }
    if (this.x > MAP.xmax - m) { this.x = MAP.xmax - m; this.vx = -Math.abs(this.vx) * 0.3; this.impact = 3; this.hitTag = 'edge'; }
    if (this.z < MAP.zmin + m) { this.z = MAP.zmin + m; this.vz = Math.abs(this.vz) * 0.3; this.impact = 3; this.hitTag = 'edge'; }
    if (this.z > MAP.zmax - m) { this.z = MAP.zmax - m; this.vz = -Math.abs(this.vz) * 0.3; this.impact = 3; this.hitTag = 'edge'; }
    // ride height and attitude from the ground under the wheels
    const hl = V.L * 0.36, hw = V.W * 0.42;
    const fxw = Math.sin(this.h), fzw = Math.cos(this.h);
    const hF = groundH(this.x + fxw * hl, this.z + fzw * hl), hB = groundH(this.x - fxw * hl, this.z - fzw * hl);
    const hR = groundH(this.x - fzw * hw, this.z + fxw * hw), hL = groundH(this.x + fzw * hw, this.z - fxw * hw);
    const bump = surf === 4 ? (Math.sin(this.x * 2.1) * Math.cos(this.z * 1.7)) * 0.05 * Math.min(1, Math.abs(vf) / 5) : 0;
    const lift = surf === 1 ? 0.11 : surf === 0 ? 0.03 : 0;
    const target = (hF + hB + hR + hL) / 4 + bump + lift;
    // leave the ground when it falls away faster than the car can follow (ramp lips, canyon edges)
    const prevY = this.y;
    if (target < this.y - 0.35 && this.speed > 7) {
      this.air = true; this.airT = 0;
      return;
    }
    this.y += (target - this.y) * Math.min(1, dt * 14);
    this.vy = this.vy * 0.6 + ((this.y - prevY) / dt) * 0.4;
    this.pitch += (Math.atan2(hF - hB, hl * 2) - this.pitch) * Math.min(1, dt * 8);
    this.roll += (Math.atan2(hR - hL, hw * 2) - this.roll) * Math.min(1, dt * 8);
    // body lean from cornering and braking
    this.lean += (clamp(this.yawRate * vf * 0.012, -0.08, 0.08) - this.lean) * Math.min(1, dt * 6);
    this.dive += (clamp(-a * 0.006, -0.05, 0.05) - this.dive) * Math.min(1, dt * 6);
    this.wheelSpin += vf * dt / 0.36;
  }
  flyStep(dt, others) {
    this.airT += dt;
    this.vy -= 9.8 * dt;
    this.vx *= 1 - 0.05 * dt; this.vz *= 1 - 0.05 * dt;
    this.x += this.vx * dt; this.z += this.vz * dt; this.y += this.vy * dt;
    this.pitch += (-0.25 - this.pitch) * dt * 0.8;     // nose drops slowly
    this.yawRate *= 1 - dt;
    this.h += this.yawRate * dt;
    this.wheelSpin += this.vf * dt / 0.36;
    this.impact = 0; this.hitTag = null;
    this.collide(others);
    const g = groundH(this.x, this.z);
    if (this.y <= g) {
      this.y = g; this.air = false;
      this.landed = { air: this.airT, vy: -this.vy };
      if (this.vy < -7) { this.impact = Math.max(this.impact, -this.vy - 4); this.hitTag = 'landing'; }
      this.vy = 0;
    }
  }
  circles() {
    const fx = Math.sin(this.h), fz = Math.cos(this.h), r = this.V.W / 2;
    const n = Math.max(2, Math.round(this.V.L / this.V.W));
    const out = [];
    for (let i = 0; i < n; i++) { const t = (i / (n - 1) - 0.5) * (this.V.L - this.V.W); out.push([this.x + fx * t, this.z + fz * t, r]); }
    return out;
  }
  collide(others) {
    for (const [cx, cz, r] of this.circles()) {
      for (const o of collidersNear(cx, cz)) {
        if (o.off) continue;
        let nx, nz, pen;
        if (o.type === 'circle') {
          const dx = cx - o.x, dz = cz - o.z, d = Math.hypot(dx, dz);
          if (d >= r + o.r || d === 0) continue;
          nx = dx / d; nz = dz / d; pen = r + o.r - d;
        } else {
          // box: closest point in its local frame (u along cos/sin, v perpendicular)
          const dx = cx - o.x, dz = cz - o.z;
          const u = dx * o.c + dz * o.s, v = -dx * o.s + dz * o.c;
          const qu = clamp(u, -o.hw, o.hw), qv = clamp(v, -o.hd, o.hd);
          let du = u - qu, dv = v - qv, d = Math.hypot(du, dv);
          if (d >= r) continue;
          if (d === 0) { // centre inside: push out along the shallow axis
            const pu = o.hw - Math.abs(u), pv = o.hd - Math.abs(v);
            if (pu < pv) { du = Math.sign(u); dv = 0; pen = pu + r; } else { du = 0; dv = Math.sign(v); pen = pv + r; }
            d = 1;
          } else pen = r - d;
          const lu = du / d, lv = dv / d;
          nx = lu * o.c - lv * o.s; nz = lu * o.s + lv * o.c;
        }
        this.push(nx, nz, pen, o.tag);
      }
      if (others) for (const c of others) {
        if (c === this) continue;
        const dx = cx - c.x, dz = cz - c.z;
        if (dx * dx + dz * dz > 100) continue;
        for (const [ox, oz, orr] of c.circles()) {
          const ex = cx - ox, ez = cz - oz, d = Math.hypot(ex, ez);
          if (d < r + orr && d > 0) { this.push(ex / d, ez / d, (r + orr - d) * 0.6, 'car', c); c.bumped = (c.bumped || 0) + 1; }
        }
      }
    }
  }
  push(nx, nz, pen, tag, car) {
    this.x += nx * pen; this.z += nz * pen;
    const vn = this.vx * nx + this.vz * nz;
    if (vn < 0) {
      this.vx -= vn * nx * 1.25; this.vz -= vn * nz * 1.25;
      this.vx *= 0.92; this.vz *= 0.92;
      if (-vn > this.impact) { this.impact = -vn; this.hitTag = tag; this.hitCar = car; }
    }
  }
}

// place a model at a driver's state
export function poseVehicle(model, d, dt) {
  model.root.position.set(d.x, d.y, d.z);
  model.root.rotation.set(0, 0, 0);
  model.root.rotation.order = 'YXZ';
  model.root.rotation.y = d.h;
  model.root.rotation.x = -d.pitch;
  model.root.rotation.z = -d.roll;
  model.body.rotation.z = d.lean;
  model.body.rotation.x = d.dive;
  for (const w of model.wheels) {
    w.w.rotation.x = d.wheelSpin * 0.36 / model.wr;
    if (w.front) w.piv.rotation.y = -d.steer * d.V.steer;
  }
}

// one vehicle merged into two geometries (paint, everything else) for cheap instancing of parked cars
export function mergedVehicle(kind) {
  const m = buildVehicle(kind, '#ffffff');
  m.root.updateMatrixWorld(true);
  const lists = { paint: [], fixed: [] };
  m.root.traverse(o => {
    if (!o.isMesh || o.material.map) return;
    const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrixWorld);
    const isPaint = o.material === m.parts.paint;
    const c = isPaint ? new THREE.Color('#ffffff') : o.material.color;
    const n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    lists[isPaint ? 'paint' : 'fixed'].push({ p: g.attributes.position.array, n: g.attributes.normal.array, c: col });
  });
  const join = L => {
    const total = L.reduce((a, x) => a + x.p.length, 0);
    const P = new Float32Array(total), N = new Float32Array(total), C = new Float32Array(total);
    let o = 0; for (const x of L) { P.set(x.p, o); N.set(x.n, o); C.set(x.c, o); o += x.p.length; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(N, 3)); g.setAttribute('color', new THREE.BufferAttribute(C, 3));
    return g;
  };
  return { paint: join(lists.paint), fixed: join(lists.fixed) };
}
