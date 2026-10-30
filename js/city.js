// The open city: money, the police and wanted stars, hitchhikers, stunt jumps, the paint shop, the car dealer,
// and mission start points around the map.
import * as THREE from '../lib/three.module.min.js';
import { MAP } from './mapdata.js';
import { ROADS, NODES, EDGES, ADJ, nearestRoad, terrainH, groundH, route, RAMPS, SHOPS, ADDRESSED, clamp, MPH } from './roads.js';
import { VEHICLES, buildVehicle, Driver, poseVehicle } from './car.js';
import { addTempBox } from './world.js';
import { kerb, addr, PIZZA_SHOP, SCHOOL_DROP } from './missions.js';

const rnd = Math.random;
export const PRICES = { suv: 0, minivan: 0, pizza: 0, sedan: 150, taxi: 300, icecream: 250, garbage: 300, bus: 350, sports: 800, police: 600 };
export const STARTER = ['suv', 'minivan', 'pizza'];

// mission start points in the city (the home missions start from the 🏠 menu)
export const GIVERS = [
  { id: 'pizza', x: PIZZA_SHOP.x, z: PIZZA_SHOP.z },
  { id: 'icecream', x: -330, z: -238 },
  { id: 'trash', x: -150, z: 112 },
  { id: 'bus', x: -118, z: 84 },
  { id: 'parking', x: -40, z: 136 },
  { id: 'test', x: -270, z: -50 },
  { id: 'police', x: -50, z: -66 },
  { id: 'race', x: -345, z: 8 },
];
export const HOME_MISSIONS = ['learn', 'school', 'carpool', 'night', 'dog'];

function tex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
function signBoard(text, sub, bg, fg) {
  return tex(512, 160, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h); g.strokeStyle = fg; g.lineWidth = 8; g.strokeRect(8, 8, w - 16, h - 16);
    g.fillStyle = fg; g.textAlign = 'center'; g.font = 'bold 58px Arial'; g.fillText(text, w / 2, 78); g.font = 'bold 32px Arial'; g.fillText(sub, w / 2, 128);
  });
}

// ---------- buildings ----------
function buildShops(scene) {
  const out = {};
  // paint & repair shop: a garage with a big open door facing the street
  {
    const s = SHOPS.spray, g = new THREE.Group();
    const wall = new THREE.MeshLambertMaterial({ color: '#e7ddc9' }), trim = new THREE.MeshLambertMaterial({ color: '#2f6fd0' });
    const W = 12, D = 11, H = 5.5;
    const add = (w, h, d, x, y, z, m = wall) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = b.receiveShadow = true; g.add(b); return b; };
    add(0.4, H, D, -W / 2, H / 2, 0); add(0.4, H, D, W / 2, H / 2, 0); add(W, H, 0.4, 0, H / 2, -D / 2);
    add(W + 0.8, 0.5, D + 0.8, 0, H, 0, trim);
    add(W, 1.2, 0.4, 0, H - 0.6, D / 2);    // header over the door
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#6c6f74' })); floor.position.y = 0.05; g.add(floor);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(7, 2.2), new THREE.MeshLambertMaterial({ map: signBoard('修車噴漆', 'PAINT & REPAIR', '#2f6fd0', '#ffffff') }));
    sign.position.set(0, H + 1.4, D / 2 + 0.1); g.add(sign);
    for (const k of [-1, 1]) { const stripe = add(0.3, H - 1.2, 0.3, k * (W / 2 - 0.2), (H - 1.2) / 2, D / 2, new THREE.MeshLambertMaterial({ color: '#f2c230' })); }
    g.position.set(s.x, terrainH(s.x, s.z), s.z); g.rotation.y = s.h;
    scene.add(g);
    // walls are solid; the doorway (local +z) is open
    const c = Math.cos(-s.h), sn = Math.sin(-s.h);
    const wpt = (lx, lz) => [s.x + lx * Math.cos(s.h) + lz * Math.sin(s.h), s.z - lx * Math.sin(s.h) + lz * Math.cos(s.h)];
    for (const [lx, lz, w, d] of [[-W / 2, 0, 0.6, D], [W / 2, 0, 0.6, D], [0, -D / 2, W, 0.6]]) { const [x, z] = wpt(lx, lz); addTempBoxPermanent(x, z, w, d, -s.h); }
    out.spray = { ...s, door: wpt(0, D / 2 + 2), inside: wpt(0, 0) };
  }
  // car dealer: a glass showroom with cars in the window
  {
    const s = SHOPS.dealer, g = new THREE.Group();
    const W = 16, D = 11, H = 5;
    const glass = new THREE.MeshLambertMaterial({ color: '#9fd0ee', transparent: true, opacity: 0.45 });
    const frame = new THREE.MeshLambertMaterial({ color: '#ececec' });
    const back = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.4), frame); back.position.set(0, H / 2, -D / 2); g.add(back);
    for (const x of [-W / 2, W / 2]) { const sd = new THREE.Mesh(new THREE.BoxGeometry(0.4, H, D), frame); sd.position.set(x, H / 2, 0); g.add(sd); }
    const front = new THREE.Mesh(new THREE.BoxGeometry(W, H - 0.5, 0.1), glass); front.position.set(0, H / 2 - 0.25, D / 2); g.add(front);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(W + 1, 0.5, D + 1), new THREE.MeshLambertMaterial({ color: '#d03a2f' })); roof.position.y = H; g.add(roof);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#f2f2f2' })); floor.position.y = 0.05; g.add(floor);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(8, 2.4), new THREE.MeshLambertMaterial({ map: signBoard('CARMEL 車行', 'NEW & USED CARS', '#d03a2f', '#ffffff') }));
    sign.position.set(0, H + 1.5, D / 2 + 0.1); g.add(sign);
    const show = [['sports', '#d0202a', -4], ['taxi', null, 0], ['police', null, 4]];
    for (const [k, c, x] of show) { const m = buildVehicle(k, c); m.root.position.set(x, 0.05, -1); m.root.rotation.y = 0.5; g.add(m.root); }
    // flags
    for (let i = 0; i < 6; i++) { const f = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.8, 3), new THREE.MeshLambertMaterial({ color: ['#d03a2f', '#f2c230', '#2f6fd0'][i % 3] })); f.position.set(-W / 2 + i * W / 5, H + 0.9, D / 2 + 0.4); f.rotation.z = Math.PI; g.add(f); }
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.position.set(s.x, terrainH(s.x, s.z), s.z); g.rotation.y = s.h;
    scene.add(g);
    addTempBoxPermanent(s.x, s.z, W, D, -s.h);
    const wpt = (lx, lz) => [s.x + lx * Math.cos(s.h) + lz * Math.sin(s.h), s.z - lx * Math.sin(s.h) + lz * Math.cos(s.h)];
    out.dealer = { ...s, door: wpt(0, D / 2 + 4) };
  }
  return out;
}
// permanent colliders go in the temp list but are re-added after every clear
const permanent = [];
function addTempBoxPermanent(x, z, w, d, ang) { permanent.push([x, z, w, d, ang]); addTempBox(x, z, w, d, ang, 'building'); }
export function restorePermanent() { for (const p of permanent) addTempBox(...p, 'building'); }

// ---------- stunt ramps: at cul-de-sacs that end at a canyon, and two in the park ----------
function buildRamps(scene) {
  for (const n of MAP.dead) {
    const e = EDGES[ADJ[n][0]], r = ROADS[e.r];
    const p = e.a === n ? e.pts[1] : e.pts[e.pts.length - 2];
    let dx = NODES[n][0] - p[0], dz = NODES[n][1] - p[1]; const L = Math.hypot(dx, dz); dx /= L; dz /= L;
    const beyond = terrainH(NODES[n][0] + dx * 30, NODES[n][1] + dz * 30);
    if (beyond > -4) continue;
    const d = r.w * 0.9 + 1.5;
    const x = NODES[n][0] + dx * d, z = NODES[n][1] + dz * d;
    RAMPS.push({ x, z, h: Math.atan2(dx, dz), len: 7, w: 4.2, ht: 2.0 });
  }
  // canyon rims beside the streets: a ramp on the verge pointing out over the drop
  const picks = [];
  for (const r of ROADS) {
    if (r.name === 'Carmel Mountain Rd' || r.name === 'Sage Canyon School') continue;
    for (let k = 0; k < r.pts.length - 1; k++) {
      const a = r.pts[k], b = r.pts[k + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let t = 10; t < L - 10; t += 15) {
        const tx = (b[0] - a[0]) / L, tz = (b[1] - a[1]) / L;
        for (const sd of [1, -1]) {
          const nx = -tz * sd, nz = tx * sd;
          const px = a[0] + tx * t + nx * (r.w / 2 + 4.5), pz = a[1] + tz * t + nz * (r.w / 2 + 4.5);
          if (Math.abs(terrainH(px, pz)) > 0.6) continue;
          const far = terrainH(px + nx * 25, pz + nz * 25);
          if (far > -4.5) continue;
          const nr = nearestRoad(px, pz);
          if (nr && nr.edge < 1.5) continue;
          if (picks.some(q => Math.hypot(q.x - px, q.z - pz) < 70)) continue;
          if (Math.abs(px) > 405 || Math.abs(pz) > 405) continue;
          picks.push({ x: px, z: pz, h: Math.atan2(nx, nz), len: 7, w: 4.2, ht: 2.0, far });
        }
      }
    }
  }
  picks.sort((p, q) => p.far - q.far);
  for (const p of picks.slice(0, 6)) RAMPS.push(p);
  const pk = MAP.park;
  RAMPS.push({ x: pk[0] - 30, z: pk[1] + 22, h: Math.PI / 2, len: 8, w: 4.5, ht: 2.2 });
  RAMPS.push({ x: pk[0] + 30, z: pk[1] + 22, h: -Math.PI / 2, len: 8, w: 4.5, ht: 2.2 });
  // two on the school blacktop
  RAMPS.push({ x: -125, z: 5, h: Math.PI / 2, len: 7, w: 4.2, ht: 1.8 });
  RAMPS.push({ x: -90, z: 40, h: -Math.PI / 2, len: 7, w: 4.2, ht: 1.8 });
  const wood = new THREE.MeshLambertMaterial({ color: '#b07a45' });
  const stripeTex = tex(128, 64, (g, w, h) => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#f2c230' : '#222'; g.beginPath(); g.moveTo(i * 20 - 20, h); g.lineTo(i * 20, 0); g.lineTo(i * 20 + 20, 0); g.lineTo(i * 20, h); g.fill(); } });
  for (const r of RAMPS) {
    // a wedge: slope rises toward local +z
    const s = new THREE.Shape(); s.moveTo(-r.len / 2, 0); s.lineTo(r.len / 2, 0); s.lineTo(r.len / 2, r.ht); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: r.w, bevelEnabled: false }); g.translate(0, 0, -r.w / 2); g.rotateY(-Math.PI / 2);
    const m = new THREE.Mesh(g, wood); m.castShadow = m.receiveShadow = true;
    m.position.set(r.x, terrainH(r.x, r.z), r.z); m.rotation.y = r.h;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(r.w, r.ht), new THREE.MeshLambertMaterial({ map: stripeTex }));
    face.position.set(0, r.ht / 2, r.len / 2 + 0.02); m.add(face);
    scene.add(m);
  }
}

// ---------- the police ----------
class Cop {
  constructor(scene, x, z, h) {
    this.d = new Driver('police', x, z, h);
    this.model = buildVehicle('police'); scene.add(this.model.root);
    this.scene = scene; this.routeT = 0; this.target = null; this.stuck = 0; this.rev = 0;
  }
  get x() { return this.d.x; } get z() { return this.d.z; } get V() { return this.d.V; } get speed() { return this.d.speed; }
  circles() { return this.d.circles(); }
  update(dt, tx, tz, others, t) {
    const d = this.d;
    this.routeT -= dt;
    const dist = Math.hypot(tx - d.x, tz - d.z);
    if (this.routeT <= 0) {
      this.routeT = 0.7;
      if (dist > 35) { const r = route(d.x, d.z, tx, tz); this.path = r.pts; } else this.path = null;
    }
    let gx = tx, gz = tz;
    if (this.path) for (const q of this.path) if (Math.hypot(q[0] - d.x, q[1] - d.z) > 12) { gx = q[0]; gz = q[1]; break; }
    let ang = Math.atan2(gx - d.x, gz - d.z) - d.h; ang = Math.atan2(Math.sin(ang), Math.cos(ang));
    const want = dist < 8 ? 2 : Math.min(22, 6 + dist * 0.2) * (Math.abs(ang) > 0.9 ? 0.45 : 1);
    const inp = { steer: clamp(-ang * 2.2, -1, 1), throttle: d.vf < want ? 1 : 0, brake: d.vf > want + 2 ? 1 : 0, hand: false };
    if (this.rev > 0) { this.rev -= dt; inp.throttle = 0; inp.brake = 1; inp.steer = -inp.steer; }
    else if (d.speed < 1 && dist > 10) { this.stuck += dt; if (this.stuck > 2) { this.rev = 1.4; this.stuck = 0; } }
    else this.stuck = 0;
    for (let i = 0; i < 2; i++) d.update(dt / 2, inp, others);
    poseVehicle(this.model, d, dt);
    for (const b of this.model.parts.beacons) b.m.material.color.set(Math.floor(t * 7 + (b.col === '#ff2020' ? 0 : 1)) % 2 ? b.col : '#222');
  }
  remove() { this.scene.remove(this.model.root); }
}

export function createCity(scene, api) {
  const shops = buildShops(scene);
  buildRamps(scene);
  const C = {
    shops, cops: [], heat: 0, wanted: 0, evadeT: 0, bustT: 0, hitch: [], ride: null, hitchT: 3,
    givers: [], prompt: null, active: false, jumpBest: 0,
  };
  // mission start markers
  function showGivers() {
    for (const g of C.givers) g.mk.remove();
    C.givers = GIVERS.map(gv => {
      const def = api.missions.find(m => m.id === gv.id);
      const st = api.save.stars[gv.id] || 0;
      return { ...gv, def, mk: api.marker(gv.x, gv.z, { color: '#ffb000', label: `${def.icon} ${api.T(def.zh, def.en)} ${'★'.repeat(st)}`, small: true }) };
    });
    const k = kerb(api.home());
    C.homeMk = api.marker(k.x, k.z, { color: '#4cd964', label: '🏠 ' + api.T('家（車庫、任務）', 'Home (garage, missions)'), small: true });
    C.sprayMk = api.marker(shops.spray.door[0], shops.spray.door[1], { color: '#2f9bff', label: '🔧 ' + api.T('修車噴漆 $20', 'Paint & repair $20'), small: true });
    C.dealerMk = api.marker(shops.dealer.door[0], shops.dealer.door[1], { color: '#ff4d4d', label: '🚗 ' + api.T('Carmel 車行', 'Carmel Cars'), small: true });
  }
  C.start = () => {
    C.active = true; C.heat = 0; C.wanted = 0; C.ride = null; C.hitch = []; C.hitchT = 3;
    for (const c of C.cops) c.remove(); C.cops = [];
    showGivers();
  };
  C.stop = () => {
    C.active = false; for (const c of C.cops) c.remove(); C.cops = []; api.siren(false);
    for (const h of C.hitch) { h.p.remove(); h.mk.remove(); } C.hitch = [];
    C.ride = null;
  };
  C.addHeat = (n, why) => {
    if (!C.active) return;
    const before = C.wanted;
    C.heat = Math.min(3.99, C.heat + n);
    C.wanted = Math.floor(C.heat);
    if (C.wanted > before) { api.toast(api.T(`警察注意到你了！${'★'.repeat(C.wanted)}`, `The police noticed! ${'★'.repeat(C.wanted)}`), true); api.sfx('warn'); }
  };
  C.clearWanted = () => { C.heat = 0; C.wanted = 0; for (const c of C.cops) c.remove(); C.cops = []; api.siren(false); };
  C.pay = (n, why) => { api.save.money = Math.max(0, (api.save.money || 0) + n); api.persist(); if (why) api.toast(`${why}  ${n >= 0 ? '+' : '−'}$${Math.abs(n)}`, n < 0); if (n > 0) api.sfx('coin'); };

  function spawnCop(px, pz) {
    // a road node 120–220 m away
    const cands = NODES.map((n, i) => ({ i, d: Math.hypot(n[0] - px, n[1] - pz) })).filter(c => c.d > 110 && c.d < 240);
    const c = cands.length ? cands[Math.floor(rnd() * cands.length)] : { i: 0 };
    const [x, z] = NODES[c.i];
    const cop = new Cop(scene, x, z, Math.atan2(px - x, pz - z));
    C.cops.push(cop);
  }

  C.update = (dt, A) => {
    if (!C.active) return;
    const { x, z, inCar, car, t } = A;
    C.prompt = null;
    // ---- wanted level ----
    if (C.wanted > 0) {
      while (C.cops.length < C.wanted) spawnCop(x, z);
      api.siren(true);
      const others = [car || A.walker, ...api.trafficCars()].filter(Boolean);
      let near = 1e9;
      for (const c of C.cops) {
        c.update(dt, x, z, others.concat(C.cops.filter(o => o !== c)), t);
        near = Math.min(near, Math.hypot(c.x - x, c.z - z));
      }
      // escape: stay far from every police car
      if (near > 90) { C.evadeT += dt; if (C.evadeT > 9) { C.evadeT = 0; C.heat = Math.max(0, C.wanted - 1); C.wanted = Math.floor(C.heat); if (C.cops.length > C.wanted) { const c = C.cops.pop(); c.remove(); } api.toast(C.wanted ? api.T(`甩掉一台警車！${'★'.repeat(C.wanted)}`, `Lost one! ${'★'.repeat(C.wanted)}`) : api.T('警察不追了 😅', 'The police gave up 😅')); if (!C.wanted) api.siren(false); } }
      else C.evadeT = 0;
      // busted: a police car right next to you while you are (nearly) stopped
      const slow = inCar ? car.speed < 2 : true;
      if (near < (inCar ? 7 : 3.5) && slow) { C.bustT += dt; if (C.bustT > 2) { const fine = 40 * Math.max(1, C.wanted); C.bustT = 0; C.clearWanted(); C.pay(-Math.min(fine, api.save.money || 0)); api.busted(fine); } }
      else C.bustT = 0;
    } else if (C.cops.length) { for (const c of C.cops) c.remove(); C.cops = []; api.siren(false); }
    else C.heat = Math.max(0, C.heat - dt * 0.02);

    // ---- hitchhikers (only when driving) ----
    C.hitchT -= dt;
    if (inCar && !C.ride && C.hitch.length < 2 && C.hitchT <= 0) {
      C.hitchT = 6;
      const list = ADDRESSED.filter(h => { const d = Math.hypot(h.x - x, h.z - z); return d > 70 && d < 260; });
      if (list.length) {
        const h = list[Math.floor(rnd() * list.length)], k = kerb(h);
        const p = api.person({ shirt: ['#e85d5d', '#4c8be0', '#f2c230', '#5fbf6a', '#b06ad8'][Math.floor(rnd() * 5)] }, h.mailbox ? h.mailbox[0] : k.x, h.mailbox ? h.mailbox[1] : k.z); p.wave = true;
        C.hitch.push({ h, k, p, mk: api.marker(k.x, k.z, { color: '#40e0d0', label: '🙋 ' + api.T('要搭便車', 'Needs a ride'), small: true }), life: 90 });
      }
    }
    for (const hh of [...C.hitch]) {
      hh.life -= dt; hh.p.face(x, z);
      if (inCar && !C.ride && Math.hypot(hh.k.x - x, hh.k.z - z) < 7 && car.speed < 1) {
        C.hitch.splice(C.hitch.indexOf(hh), 1); hh.mk.remove(); hh.p.walkTo(x, z, () => hh.p.remove()); api.sfx('door');
        const dests = ADDRESSED.filter(h => { const d = Math.hypot(h.x - x, h.z - z); return d > 180 && d < 600; });
        const dh = dests[Math.floor(rnd() * dests.length)], dk = kerb(dh);
        const len = route(x, z, dk.x, dk.z).len;
        C.ride = { dh, dk, len, t: 0, limit: len / 8 + 25, mk: api.marker(dk.x, dk.z, { color: '#40e0d0', label: '🏁 ' + addr(dh) }), bumps: 0 };
        api.gps(dk.x, dk.z);
        api.toast(api.T(`乘客：「請載我到 ${addr(dh)}」`, `Passenger: "${addr(dh)}, please!"`));
        api.say(api.T(`請載我到 ${addr(dh)}`, `${addr(dh)}, please`));
      } else if (hh.life <= 0) { C.hitch.splice(C.hitch.indexOf(hh), 1); hh.mk.remove(); hh.p.remove(); }
    }
    if (C.ride) {
      const R = C.ride; R.t += dt;
      if (!inCar) { R.mk.remove(); C.ride = null; api.gps(null); api.toast(api.T('乘客下車走掉了…', 'Your passenger walked off…'), true); }
      else if (Math.hypot(R.dk.x - x, R.dk.z - z) < 7 && car.speed < 1) {
        R.mk.remove(); C.ride = null; api.gps(null); api.sfx('door');
        let pay = Math.round(12 + R.len / 18 + Math.max(0, R.limit - R.t) * 0.4);
        if (car.kind === 'taxi') pay = Math.round(pay * 1.6);
        C.pay(pay, api.T('車資', 'Fare'));
      }
    }
    // ---- stunts ----
    if (inCar && car.landed) {
      const L = car.landed; car.landed = null;
      if (L.air > 0.5) {
        const bonus = Math.round(L.air * 25);
        C.pay(bonus, api.T(`特技跳躍！滯空 ${L.air.toFixed(1)} 秒`, `Stunt jump! ${L.air.toFixed(1)} s in the air`));
        if (L.air > C.jumpBest) C.jumpBest = L.air;
      }
    }
    // ---- places you can use ----
    const near = (p, r) => Math.hypot(p[0] - x, p[1] - z) < r;
    if (inCar && near(shops.spray.inside, 6) && car.speed < 1.5) {
      if (!C.sprayed) {
        C.sprayed = true;
        if ((api.save.money || 0) >= 20) {
          C.pay(-20); car.health = 100; api.repaint(); C.clearWanted();
          api.toast(api.T('修好了，還換了新顏色！警察認不出你了 😎', 'Fixed and repainted! The police won’t recognise you 😎'));
          api.sfx('trash');
        } else api.toast(api.T('錢不夠（要 $20）', 'Not enough money ($20)'), true);
      }
    } else C.sprayed = false;
    if (near(shops.dealer.door, 7) && (!inCar || car.speed < 1.5)) C.prompt = { label: api.T('E：進車行買車', 'E: Buy a car'), act: () => api.openDealer() };
    const k = kerb(api.home());
    if (Math.hypot(k.x - x, k.z - z) < 8 && (!inCar || car.speed < 1.5)) C.prompt = { label: api.T('E：回家（車庫／任務）', 'E: Home (garage / missions)'), act: () => api.openHome() };
    for (const g of C.givers) if (Math.hypot(g.x - x, g.z - z) < 8 && (!inCar || car.speed < 1.5)) C.prompt = { label: `E：${g.def.icon} ${api.T(g.def.zh, g.def.en)}`, act: () => api.startMission(g.def) };
  };
  C.blips = () => {
    const b = [];
    for (const g of C.givers) b.push({ x: g.x, z: g.z, icon: g.def.icon, label: api.T(g.def.zh, g.def.en) });
    const k = kerb(api.home()); b.push({ x: k.x, z: k.z, icon: '🏠', label: api.T('家', 'Home') });
    b.push({ x: shops.spray.door[0], z: shops.spray.door[1], icon: '🔧', label: api.T('修車噴漆', 'Paint & repair') });
    b.push({ x: shops.dealer.door[0], z: shops.dealer.door[1], icon: '🚗', label: api.T('車行', 'Car dealer') });
    for (const h of C.hitch) b.push({ x: h.k.x, z: h.k.z, icon: '🙋', label: api.T('搭便車', 'Hitchhiker') });
    for (const r of RAMPS) b.push({ x: r.x, z: r.z, icon: '⤴️', label: api.T('特技跳台', 'Stunt ramp') });
    for (const c of C.cops) b.push({ x: c.x, z: c.z, icon: '🚓', label: api.T('警察', 'Police') });
    return b;
  };
  return C;
}
