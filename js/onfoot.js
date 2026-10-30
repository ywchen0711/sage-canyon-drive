// Walking around on foot as Jasper (with the little mole to the right of his philtrum).
import * as THREE from '../lib/three.module.min.js';
import { groundH, clamp } from './roads.js';
import { collidersNear } from './world.js';
import { MAP } from './mapdata.js';

function buildJasper() {
  const g = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: '#f1c9a5' });
  const shirt = new THREE.MeshLambertMaterial({ color: '#3d8fe0' });
  const pants = new THREE.MeshLambertMaterial({ color: '#2f3d55' });
  const shoe = new THREE.MeshLambertMaterial({ color: '#f4f4f4' });
  const hairM = new THREE.MeshLambertMaterial({ color: '#1c140e' });
  const body = new THREE.Group(); g.add(body);
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.23, 0.55, 10), shirt); torso.position.y = 0.98; body.add(torso);
  const head = new THREE.Group(); head.position.y = 1.43; body.add(head);
  head.add(new THREE.Mesh(new THREE.SphereGeometry(0.21, 14, 12), skin));
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.225, 14, 10, 0, Math.PI * 2, 0, 1.5), hairM); hair.position.y = 0.03; hair.rotation.x = -0.25; head.add(hair);
  for (const s of [-1, 1]) { const eye = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), new THREE.MeshBasicMaterial({ color: '#1a1a1a' })); eye.position.set(s * 0.075, 0.03, 0.19); head.add(eye); }
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.012, 6, 10, Math.PI), new THREE.MeshBasicMaterial({ color: '#a0443a' })); mouth.position.set(0, -0.08, 0.195); mouth.rotation.z = Math.PI; head.add(mouth);
  // the mole: just right of the philtrum (his right = our left when facing him = local -x)
  const mole = new THREE.Mesh(new THREE.SphereGeometry(0.013, 6, 5), new THREE.MeshBasicMaterial({ color: '#111' })); mole.position.set(-0.035, -0.045, 0.205); head.add(mole);
  const legs = [], arms = [];
  for (const s of [-1, 1]) {
    const leg = new THREE.Group(); leg.position.set(s * 0.1, 0.72, 0);
    leg.add(new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.07, 0.62, 8).translate(0, -0.31, 0), pants));
    const sh = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.08, 0.24), shoe); sh.position.set(0, -0.65, 0.04); leg.add(sh);
    body.add(leg); legs.push(leg);
    const arm = new THREE.Group(); arm.position.set(s * 0.27, 1.2, 0);
    arm.add(new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.05, 0.5, 8).translate(0, -0.25, 0), shirt));
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), skin); hand.position.y = -0.52; arm.add(hand);
    body.add(arm); arms.push(arm);
  }
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.4, 0.16), new THREE.MeshLambertMaterial({ color: '#e85d5d' })); pack.position.set(0, 1.0, -0.22); body.add(pack);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return { g, body, legs, arms };
}

export class Walker {
  constructor(scene) {
    this.m = buildJasper(); scene.add(this.m.g);
    this.x = 0; this.z = 0; this.y = 0; this.h = 0; this.vy = 0; this.speed = 0; this.vf = 0; this.phase = 0;
    this.ground = true; this.visible = true; this.V = { L: 0.6, W: 0.6 }; this.surface = 2; this.impact = 0;
  }
  place(x, z, h) { this.x = x; this.z = z; this.h = h; this.y = groundH(x, z); this.vy = 0; this.speed = 0; }
  show(v) { this.m.g.visible = v; this.visible = v; }
  circles() { return [[this.x, this.z, 0.35]]; }
  update(dt, inp, cars) {
    const run = inp.run ? 1 : 0;
    const want = (inp.throttle - inp.brake) * (run ? 6.5 : 2.8);
    this.h -= inp.steer * dt * 2.8;
    this.vf += clamp(want - this.vf, -12 * dt, 12 * dt);
    const fx = Math.sin(this.h), fz = Math.cos(this.h);
    this.x += fx * this.vf * dt; this.z += fz * this.vf * dt;
    this.speed = Math.abs(this.vf);
    // jump and gravity
    const g = groundH(this.x, this.z);
    if (inp.jump && this.ground) { this.vy = 4.6; this.ground = false; }
    this.vy -= 12 * dt; this.y += this.vy * dt;
    if (this.y <= g) { this.y = g; this.vy = 0; this.ground = true; }
    // push out of houses, poles, trees and cars
    const r = 0.35;
    for (const o of collidersNear(this.x, this.z)) {
      if (o.off) continue;
      if (o.type === 'circle') {
        const dx = this.x - o.x, dz = this.z - o.z, d = Math.hypot(dx, dz);
        if (d < r + o.r && d > 0) { this.x += dx / d * (r + o.r - d); this.z += dz / d * (r + o.r - d); }
      } else {
        const dx = this.x - o.x, dz = this.z - o.z;
        const u = dx * o.c + dz * o.s, v = -dx * o.s + dz * o.c;
        const qu = clamp(u, -o.hw, o.hw), qv = clamp(v, -o.hd, o.hd);
        let du = u - qu, dv = v - qv, d = Math.hypot(du, dv);
        if (d >= r) continue;
        if (d === 0) { const pu = o.hw - Math.abs(u), pv = o.hd - Math.abs(v); if (pu < pv) { du = Math.sign(u) * (pu + r); dv = 0; } else { dv = Math.sign(v) * (pv + r); du = 0; } }
        else { du = du / d * (r - d); dv = dv / d * (r - d); }
        this.x += du * o.c - dv * o.s; this.z += du * o.s + dv * o.c;
      }
    }
    this.impact = 0;
    for (const c of cars) {
      for (const [cx, cz, cr] of c.circles()) {
        const dx = this.x - cx, dz = this.z - cz, d = Math.hypot(dx, dz);
        if (d < r + cr && d > 0) {
          this.x += dx / d * (r + cr - d); this.z += dz / d * (r + cr - d);
          const cs = c.v ?? c.speed ?? 0;
          if (cs > 3) this.impact = Math.max(this.impact, cs);
        }
      }
    }
    this.x = clamp(this.x, MAP.xmin + 3, MAP.xmax - 3); this.z = clamp(this.z, MAP.zmin + 3, MAP.zmax - 3);
    // pose and animate
    const m = this.m;
    m.g.position.set(this.x, this.y, this.z); m.g.rotation.y = this.h;
    this.phase += dt * (3 + this.speed * 2.2);
    const a = this.speed > 0.2 ? Math.sin(this.phase) * Math.min(0.9, 0.3 + this.speed * 0.1) : 0;
    m.legs[0].rotation.x = a; m.legs[1].rotation.x = -a;
    m.arms[0].rotation.x = -a * 0.9; m.arms[1].rotation.x = a * 0.9;
    if (!this.ground) { m.legs[0].rotation.x = -0.6; m.legs[1].rotation.x = 0.3; m.arms[0].rotation.z = 0.5; m.arms[1].rotation.z = -0.5; }
    else { m.arms[0].rotation.z = 0; m.arms[1].rotation.z = 0; }
    m.body.position.y = this.ground && this.speed > 0.2 ? Math.abs(Math.sin(this.phase)) * 0.05 : 0;
  }
}
