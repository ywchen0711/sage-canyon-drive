// Other drivers and people on the sidewalks.
import * as THREE from '../lib/three.module.min.js';
import { MAP } from './mapdata.js';
import { ROADS, NODES, EDGES, ADJ, other, edgePoint, terrainH, clamp, lerp, LIMIT, nearestRoad } from './roads.js';
import { buildVehicle, VEHICLES } from './car.js';

const rnd = Math.random;
const AICOLS = ['#f2f2f2', '#1b1b1b', '#9aa0a6', '#2b4f86', '#8a1f1f', '#c8c8c8', '#3e5e46', '#d8cfbd', '#5b6f8a', '#b04a2a'];
const STOPSET = new Map();   // "edge:end" -> stop entry
for (const s of MAP.stops) STOPSET.set(s[4] + ':' + s[5], s);

// ---------- traffic lights ----------
export const SIGNAL = { t: 0 };
const CYCLE = [['main', 'G', 14], ['main', 'Y', 3], ['all', 'R', 1.5], ['cross', 'G', 9], ['cross', 'Y', 3], ['all', 'R', 1.5]];
const CYCLE_LEN = CYCLE.reduce((a, c) => a + c[2], 0);
// light for a road at a signal node: 'G' | 'Y' | 'R'
export function lightFor(roadName, node, t = SIGNAL.t) {
  const off = node === MAP.signals[0] ? 0 : 7;
  let u = (t + off) % CYCLE_LEN;
  for (const [who, col, d] of CYCLE) {
    if (u < d) {
      const isMain = roadName === 'Carmel Mountain Rd';
      if (who === 'all') return 'R';
      return (who === 'main') === isMain ? col : 'R';
    }
    u -= d;
  }
  return 'R';
}
export function updateSignals(furn, dt) {
  SIGNAL.t += dt;
  for (const s of furn.signals) for (const h of s.heads) {
    const c = lightFor(h.road, s.node);
    h.lamps.forEach((m, k) => m.material.color.set((k === 0 && c === 'R') || (k === 1 && c === 'Y') || (k === 2 && c === 'G') ? m.userData.on : '#222'));
  }
}

function laneOffset(r) { return r.name === 'Carmel Mountain Rd' ? (rnd() < 0.5 ? 3.8 : 7.4) : r.oneway ? 0 : Math.max(2.2, r.w * 0.24); }

// position on edge e at arc s, travelling dir (+1 a→b), shifted to the right by off
function lanePoint(e, s, dir, off) {
  const p = edgePoint(e, clamp(s, 0, e.len));
  const tx = p.tx * dir, tz = p.tz * dir;
  return { x: p.x - tz * off, z: p.z + tx * off, tx, tz };
}

export class AICar {
  constructor(scene, ei, kind, color) {
    const kinds = ['sedan', 'sedan', 'suv', 'minivan', 'sedan', 'suv', 'pizza'];
    this.kind = kind || kinds[Math.floor(rnd() * kinds.length)];
    this.V = VEHICLES[this.kind];
    this.model = buildVehicle(this.kind, color || AICOLS[Math.floor(rnd() * AICOLS.length)]);
    if (this.kind === 'pizza') this.model.body.children.slice(1).forEach(c => { if (c.geometry && c.geometry.type === 'PlaneGeometry') c.visible = false; });
    scene.add(this.model.root);
    this.place(ei, rnd() * EDGES[ei].len, rnd() < 0.5 ? 1 : -1);
    this.v = 0; this.wait = 0; this.turn = null; this.h = 0; this.x = 0; this.z = 0; this.y = 0; this.spin = 0;
    this.honk = 0; this.stuck = 0;
  }
  place(ei, s, dir) {
    this.ei = ei; this.s = s; this.dir = dir; this.e = EDGES[ei]; this.r = ROADS[this.e.r];
    if (this.r.oneway && dir < 0) this.dir = 1;
    this.off = laneOffset(this.r); this.turn = null; this.stopped = false; this.next = null;
  }
  // distance left on the current edge in the travel direction
  get left() { return this.dir > 0 ? this.e.len - this.s : this.s; }
  get node() { return this.dir > 0 ? this.e.b : this.e.a; }
  chooseNext() {
    const n = this.node;
    const opts = ADJ[n].filter(ei => ei !== this.ei && !(ROADS[EDGES[ei].r].oneway && EDGES[ei].a !== n));
    let ei, dir;
    if (!opts.length || MAP.ends.includes(n)) { ei = this.ei; dir = -this.dir; }
    else {
      // prefer going straight on the same street
      const named = opts.filter(o => ROADS[EDGES[o].r].name === this.r.name);
      ei = (named.length && rnd() < 0.55) ? named[0] : opts[Math.floor(rnd() * opts.length)];
      if (this.flee) {
        // run away: the exit whose far end is furthest from the chaser (with a little randomness)
        const far = o => { const e = EDGES[o], m = other(e, n); return Math.hypot(NODES[m][0] - this.flee.x, NODES[m][1] - this.flee.z) + rnd() * 60; };
        ei = opts.slice().sort((a, b) => far(b) - far(a))[0];
      }
      dir = EDGES[ei].a === n ? 1 : -1;
    }
    this.next = { ei, dir };
  }
  circles() {
    const fx = Math.sin(this.h), fz = Math.cos(this.h), r = this.V.W / 2, n = Math.max(2, Math.round(this.V.L / this.V.W));
    const out = [];
    for (let i = 0; i < n; i++) { const t = (i / (n - 1) - 0.5) * (this.V.L - this.V.W); out.push([this.x + fx * t, this.z + fz * t, r]); }
    return out;
  }
  update(dt, cars, player) {
    if (!this.next) this.chooseNext();
    let lim = LIMIT(this.r.name) / 2.237 * (0.85 + (this.ei % 5) * 0.04);
    if (this.flee) { const d = Math.hypot(this.flee.x - this.x, this.flee.z - this.z); lim = this.halted ? 0 : d < 40 ? 19 : d > 120 ? 9 : 15; }
    let vt = lim;
    const isEnd = MAP.ends.includes(this.node) || this.next.ei === this.ei;
    const endGap = MAP.ends.includes(this.node) ? 16 : 0;
    // slow for the corner ahead
    if (!this.turn && this.left < 25) vt = Math.min(vt, isEnd ? 4 : lerp(this.flee ? 8 : 5.5, vt, this.left / 25));
    // stop signs and red lights
    const endIx = this.dir > 0 ? 1 : 0;
    const stop = STOPSET.get(this.ei + ':' + endIx);
    const isSignal = MAP.signals.includes(this.node);
    const wmax = Math.max(...ADJ[this.node].map(f => ROADS[EDGES[f].r].w));
    const lineAt = wmax / 2 + 3.5;
    if (!this.turn && !this.flee) {
      if (stop && !this.stopped) {
        const d = this.left - lineAt;
        vt = Math.min(vt, Math.max(0, d) * 0.7);
        if (d < 1.5 && this.v < 0.3) { this.wait += dt; if (this.wait > 1.2) { this.stopped = true; this.wait = 0; } }
      }
      if (isSignal) {
        const c = lightFor(this.r.name, this.node);
        const d = this.left - lineAt;
        if (c !== 'G' && d > -1 && (c === 'R' || d > 8)) vt = Math.min(vt, Math.max(0, d) * 0.6);
      }
    }
    // keep a gap to whatever is ahead (other cars and the player)
    const fx = Math.sin(this.h), fz = Math.cos(this.h);
    let gap = 99;
    const look = (x, z, len) => {
      const dx = x - this.x, dz = z - this.z, ahead = dx * fx + dz * fz, side = Math.abs(-dx * fz + dz * fx);
      if (ahead > 0 && ahead < 30 && side < 2.6) gap = Math.min(gap, ahead - len);
    };
    for (const c of cars) if (c !== this) look(c.x, c.z, (c.V.L + this.V.L) / 2);
    if (player && !this.flee) look(player.x, player.z, (player.V.L + this.V.L) / 2);
    if (gap < 99) vt = Math.min(vt, Math.max(0, (gap - 2.5) * 0.9));
    if (gap < 3 && player && Math.hypot(player.x - this.x, player.z - this.z) < 9) { this.stuck += dt; if (this.stuck > 2.5) { this.honk = 1; this.stuck = 0; } } else this.stuck = Math.max(0, this.stuck - dt);
    this.v += clamp(vt - this.v, -7 * dt, 2.4 * dt);
    if (this.v < 0) this.v = 0;
    const ds = this.v * dt;
    if (this.turn) {
      const T = this.turn;
      T.u += ds / T.len;
      if (T.u >= 1) { this.place(T.ei, T.s, T.dir); }
      else {
        const u = T.u, a = (1 - u) * (1 - u), b = 2 * u * (1 - u), c = u * u;
        const nx = a * T.p0.x + b * T.p1.x + c * T.p2.x, nz = a * T.p0.z + b * T.p1.z + c * T.p2.z;
        const tx = 2 * (1 - u) * (T.p1.x - T.p0.x) + 2 * u * (T.p2.x - T.p1.x), tz = 2 * (1 - u) * (T.p1.z - T.p0.z) + 2 * u * (T.p2.z - T.p1.z);
        this.x = nx; this.z = nz; this.h = Math.atan2(tx, tz);
      }
    }
    if (!this.turn) {
      this.s += ds * this.dir;
      if (!this.next) this.chooseNext();
      const reach = isEnd ? Math.max(7, endGap) : 8;
      if (this.left <= reach) {
        // build the corner curve into the next edge
        const n = this.node, N = this.next, e2 = EDGES[N.ei], r2 = ROADS[e2.r];
        const off2 = N.ei === this.ei ? this.off : laneOffset(r2);
        const p0 = lanePoint(this.e, this.s, this.dir, this.off);
        let s2, p2, p1;
        if (N.ei === this.ei) {
          // U-turn: around the cul-de-sac bulb or before the barricade
          s2 = this.s; p2 = lanePoint(this.e, s2, -this.dir, off2);
          const ahead = MAP.ends.includes(n) ? 6 : this.left + this.r.w * 0.5;
          p1 = { x: (p0.x + p2.x) / 2 + p0.tx * ahead * 1.6, z: (p0.z + p2.z) / 2 + p0.tz * ahead * 1.6 };
        } else {
          s2 = N.dir > 0 ? Math.min(8, e2.len * 0.4) : e2.len - Math.min(8, e2.len * 0.4);
          p2 = lanePoint(e2, s2, N.dir, off2);
          // control point: where the two lane lines cross (fallback: node)
          const d0x = p0.tx, d0z = p0.tz, d2x = p2.tx, d2z = p2.tz;
          const den = d0x * d2z - d0z * d2x;
          if (Math.abs(den) > 0.15) {
            const t = ((p2.x - p0.x) * d2z - (p2.z - p0.z) * d2x) / den;
            p1 = { x: p0.x + d0x * t, z: p0.z + d0z * t };
            if (t < 0 || t > 30) p1 = { x: (p0.x + p2.x) / 2, z: (p0.z + p2.z) / 2 };
          } else p1 = { x: (p0.x + p2.x) / 2, z: (p0.z + p2.z) / 2 };
        }
        const len = Math.hypot(p1.x - p0.x, p1.z - p0.z) + Math.hypot(p2.x - p1.x, p2.z - p1.z);
        this.turn = { p0, p1, p2, len: Math.max(2, len), u: 0, ei: N.ei, s: s2, dir: N.dir };
      } else {
        const p = lanePoint(this.e, this.s, this.dir, this.off);
        this.x = p.x; this.z = p.z; this.h = Math.atan2(p.tx, p.tz);
      }
    }
    // pose
    this.y = terrainH(this.x, this.z);
    const m = this.model;
    m.root.position.set(this.x, this.y, this.z); m.root.rotation.y = this.h;
    this.spin += this.v * dt / m.wr;
    for (const w of m.wheels) w.w.rotation.x = this.spin;
    if (m.parts.tailM) m.parts.tailM.color.set(this.v < vt - 0.5 || this.v < 0.5 ? '#ff2020' : '#7a1010');
  }
}

// ---------- people ----------
const SKIN = ['#f1c9a5', '#e0ac85', '#c68863', '#8d5a3b', '#f5d6bd'];
const SHIRT = ['#e85d5d', '#4c8be0', '#f2c230', '#5fbf6a', '#b06ad8', '#ff8c3a', '#2ab3b3', '#f2f2f2'];
export function buildPerson(opts = {}) {
  const g = new THREE.Group();
  const s = opts.kid ? 0.68 : 1;
  const skin = new THREE.MeshLambertMaterial({ color: opts.skin || SKIN[Math.floor(rnd() * SKIN.length)] });
  const shirt = new THREE.MeshLambertMaterial({ color: opts.shirt || SHIRT[Math.floor(rnd() * SHIRT.length)] });
  const pants = new THREE.MeshLambertMaterial({ color: opts.pants || (rnd() < 0.5 ? '#34495e' : '#6b5a45') });
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.6, 8), shirt); torso.position.y = 1.15; g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), skin); head.position.y = 1.62; g.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8, 0, 6.3, 0, 1.4), new THREE.MeshLambertMaterial({ color: opts.hair || ['#2b1d12', '#5a3a1e', '#c99a4b', '#111'][Math.floor(rnd() * 4)] }));
  hair.position.y = 1.65; g.add(hair);
  const legs = [], arms = [];
  for (const sd of [-1, 1]) {
    const leg = new THREE.Group(); leg.position.set(sd * 0.1, 0.85, 0);
    const lm = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.07, 0.82, 6).translate(0, -0.41, 0), pants); leg.add(lm); g.add(leg); legs.push(leg);
    const arm = new THREE.Group(); arm.position.set(sd * 0.27, 1.4, 0);
    const am = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.58, 6).translate(0, -0.29, 0), shirt); arm.add(am); g.add(arm); arms.push(arm);
  }
  if (opts.backpack) { const bp = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.4, 0.18), new THREE.MeshLambertMaterial({ color: opts.backpack })); bp.position.set(0, 1.2, -0.22); g.add(bp); }
  if (opts.vest) { const v = new THREE.Mesh(new THREE.CylinderGeometry(0.215, 0.235, 0.5, 8), new THREE.MeshLambertMaterial({ color: '#c6ff1a' })); v.position.y = 1.18; g.add(v); }
  g.scale.setScalar(s);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return { g, legs, arms, phase: rnd() * 6 };
}
export function animPerson(p, dt, speed, wave) {
  p.phase += dt * (2 + speed * 4);
  const a = speed > 0.1 ? Math.sin(p.phase) * 0.5 : 0;
  p.legs[0].rotation.x = a; p.legs[1].rotation.x = -a;
  p.arms[0].rotation.x = -a * 0.8; p.arms[1].rotation.x = a * 0.8;
  if (wave) { p.arms[1].rotation.z = -2.6 + Math.sin(p.phase * 3) * 0.3; p.arms[1].rotation.x = 0; } else p.arms[1].rotation.z = 0;
}

function buildDog() {
  const g = new THREE.Group();
  const m = new THREE.MeshLambertMaterial({ color: ['#c08a4a', '#222', '#f2e2c4', '#8a5a2a'][Math.floor(rnd() * 4)] });
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.26, 0.62), m); b.position.y = 0.42; g.add(b);
  const h = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.26), m); h.position.set(0, 0.62, 0.38); g.add(h);
  const legs = [];
  for (const [x, z] of [[-0.1, 0.22], [0.1, 0.22], [-0.1, -0.22], [0.1, -0.22]]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.3, 0.07).translate(0, -0.15, 0), m); l.position.set(x, 0.32, z); g.add(l); legs.push(l); }
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.25), m); tail.position.set(0, 0.55, -0.4); tail.rotation.x = -0.6; g.add(tail);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return { g, legs, tail };
}
export { buildDog };

class Walker {
  constructor(scene) {
    this.p = buildPerson({ kid: rnd() < 0.3 });
    scene.add(this.p.g);
    if (rnd() < 0.35) { this.dog = buildDog(); scene.add(this.dog.g); }
    this.pick();
    this.dodge = 0; this.dx = 0; this.dz = 0;
  }
  pick() {
    let r; do { r = ROADS[Math.floor(rnd() * ROADS.length)]; } while (r.name === 'Carmel Mountain Rd' && rnd() < 0.6);
    this.r = r; this.side = rnd() < 0.5 ? 1 : -1;
    this.pts = r.pts; this.k = Math.floor(rnd() * (r.pts.length - 1)); this.t = rnd(); this.dir = rnd() < 0.5 ? 1 : -1;
    this.v = 1.0 + rnd() * 0.5;
  }
  update(dt, player) {
    const a = this.pts[this.k], b = this.pts[this.k + 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    this.t += this.dir * this.v * dt / L;
    if (this.t > 1) { if (this.k < this.pts.length - 2) { this.k++; this.t = 0; } else { this.t = 1; this.dir = -1; } }
    if (this.t < 0) { if (this.k > 0) { this.k--; this.t = 1; } else { this.t = 0; this.dir = 1; } }
    const tx = (b[0] - a[0]) / L, tz = (b[1] - a[1]) / L;
    const off = (this.r.w / 2 + 1.2) * this.side;
    let x = a[0] + (b[0] - a[0]) * this.t - tz * off, z = a[1] + (b[1] - a[1]) * this.t + tx * off;
    // step away from a car that comes too close
    if (player) {
      const ddx = x + this.dx - player.x, ddz = z + this.dz - player.z, d = Math.hypot(ddx, ddz);
      if (d < 4.5 && player.speed > 1.5) { this.dodge = 1.2; this.dx += ddx / d * dt * 9; this.dz += ddz / d * dt * 9; if (player.speed > 3.5 && d < 3) this.scared = true; }
    }
    if (this.dodge > 0) this.dodge -= dt; else { this.dx *= 1 - dt; this.dz *= 1 - dt; }
    x += this.dx; z += this.dz;
    this.x = x; this.z = z;
    const g = this.p.g;
    g.position.set(x, terrainH(x, z) + (this.dodge > 0.8 ? Math.sin((1.2 - this.dodge) * 8) * 0.3 : 0), z);
    g.rotation.y = Math.atan2(tx * this.dir, tz * this.dir);
    animPerson(this.p, dt, this.v, false);
    if (this.dog) {
      const dx = x - tz * -0.8 * this.side + tx * this.dir * 1.2, dz = z + tx * -0.8 * this.side + tz * this.dir * 1.2;
      this.dog.g.position.set(dx, terrainH(dx, dz), dz); this.dog.g.rotation.y = g.rotation.y;
      const s = Math.sin(this.p.phase * 2) * 0.5; this.dog.legs.forEach((l, i) => l.rotation.x = i % 2 ? s : -s);
      this.dog.tail.rotation.y = Math.sin(this.p.phase * 5) * 0.6;
    }
  }
}

export function createTraffic(scene, nCars = 16, nPeople = 26) {
  const cars = [], people = [];
  const used = new Set();
  for (let i = 0; i < nCars; i++) {
    let ei, tries = 0;
    do { ei = Math.floor(rnd() * EDGES.length); tries++; } while ((EDGES[ei].len < 40 || used.has(ei) || ROADS[EDGES[ei].r].oneway) && tries < 50);
    used.add(ei);
    cars.push(new AICar(scene, ei));
  }
  for (let i = 0; i < nPeople; i++) people.push(new Walker(scene));
  return {
    cars, people,
    extra: [],
    update(dt, player) {
      for (const c of this.extra) { if (c.bumped) { c.bumped = 0; c.hitByPlayer = true; } c.update(dt, cars, player); }
      for (const c of cars) {
        if (c.bumped) { c.v *= 0.3; c.bumped = 0; }
        c.update(dt, cars, player);
      }
      for (const p of people) p.update(dt, player);
    },
    setVisible(v) { for (const c of cars) c.model.root.visible = v; for (const p of people) { p.p.g.visible = v; if (p.dog) p.dog.g.visible = v; } },
    // move cars that sit right on top of a point (so a mission start is clear)
    clear(x, z, r = 20) { for (const c of cars) if (Math.hypot(c.x - x, c.z - z) < r) { const ei = Math.floor(rnd() * EDGES.length); c.place(ei, EDGES[ei].len / 2, 1); c.update(0, cars, null); } },
  };
}
