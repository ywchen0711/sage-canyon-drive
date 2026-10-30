// Sage Canyon Drive: a driving game on the real streets around Sage Canyon School.
import * as THREE from '../lib/three.module.min.js';
import { MAP } from './mapdata.js';
import { ROADS, NODES, EDGES, ADJ, nearestRoad, terrainH, route, onEdge, edgePoint, LIMIT, MPH, clamp, lerp, HOUSES, ADDRESSED } from './roads.js';
import { buildWorld, buildSky, addTempBox, addTempCircle, clearTemp } from './world.js';
import { createCity, restorePermanent, PRICES, STARTER, HOME_MISSIONS } from './city.js';
import { Walker } from './onfoot.js';
import { createBigMap } from './bigmap.js';
import { makeEnv, makeComposer } from './gfx.js';
import { VEHICLES, buildVehicle, Driver, poseVehicle } from './car.js';
import { createTraffic, updateSignals, lightFor, buildPerson, animPerson, buildDog, AICar } from './traffic.js';
import { MISSIONS, FREE, STARS, SCHOOL_DROP, kerb, addr } from './missions.js';
import { drawHUD, getMapCanvas } from './hud.js';
import { audioInit, engineSound, engineOff, sfx, horn, sirenOn, jingleOn, say, setMute, isMuted } from './audio.js';

// ---------- save ----------
const SAVE_KEY = 'sage-canyon-drive-v1';
let save = { stars: {}, found: [], home: null, lang: 'zh', traffic: 1, tilt: false, quality: 1, money: 100, owned: ['suv', 'minivan', 'pizza'], paid: {} };
try { Object.assign(save, JSON.parse(localStorage.getItem(SAVE_KEY) || '{}')); } catch (e) { }
function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { } }
const T = (zh, en) => save.lang === 'zh' ? zh : en;
const totalStars = () => Object.values(save.stars).reduce((a, b) => a + b, 0);

// ---------- renderer & scene ----------
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, save.quality ? 2 : 1));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.3, 6000);
const hudC = document.getElementById('hud'), hud = hudC.getContext('2d');

const hemi = new THREE.HemisphereLight('#cfe6ff', '#8a7a5a', 0.9); scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff4e0', 2.2);
sun.castShadow = true; sun.shadow.mapSize.set(save.quality ? 4096 : 1024, save.quality ? 4096 : 1024);
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 400 });
sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);
scene.fog = new THREE.Fog('#cfe3f1', 300, 2600);
const sky = buildSky(scene);

const loading = document.getElementById('loading');
const groundTex = await new Promise(res => new THREE.TextureLoader().load('assets/ground.jpg', t => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); res(t); }));
const W = buildWorld(scene, groundTex);
const fx = makeComposer(renderer, scene, camera);
let traffic = createTraffic(scene, [8, 16, 26][save.traffic], [12, 26, 40][save.traffic]);

// ---------- time of day ----------
const TODS = {
  morning: { sun: [-0.8, 0.35, -0.3], sunC: '#ffd9a8', sunI: 2.6, hemi: ['#d8e4f0', '#8a7a5a', 0.35], top: '#5d97d6', bot: '#f2dcc0', fog: '#e9dcc8', exp: 1.0, lamps: 0, glow: 0 },
  day: { sun: [0.45, 0.75, 0.45], sunC: '#fff4e0', sunI: 3.0, hemi: ['#cfe6ff', '#8a7a5a', 0.4], top: '#3f86d6', bot: '#cfe3f1', fog: '#cfe3f1', exp: 1.05, lamps: 0, glow: 0 },
  sunset: { sun: [0.85, 0.16, 0.25], sunC: '#ffab6b', sunI: 2.6, hemi: ['#e0b8a8', '#5a4a40', 0.3], top: '#41548a', bot: '#ffb37a', fog: '#e8a882', exp: 1.0, lamps: 0.5, glow: 0.4 },
  night: { sun: [-0.3, 0.6, 0.5], sunC: '#9fb4ff', sunI: 0.35, hemi: ['#4a5a80', '#1a1a22', 0.25], top: '#060a1a', bot: '#1c2440', fog: '#141a2e', exp: 1.1, lamps: 1, glow: 1 },
};
let tod = 'day';
function setTOD(name) {
  tod = name; const c = TODS[name];
  sun.color.set(c.sunC); sun.intensity = c.sunI;
  hemi.color.set(c.hemi[0]); hemi.groundColor.set(c.hemi[1]); hemi.intensity = c.hemi[2];
  sky.mat.uniforms.top.value.set(c.top); sky.mat.uniforms.bottom.value.set(c.bot);
  sky.mat.uniforms.sunDir.value.set(...c.sun).normalize();
  sky.mat.uniforms.sunCol.value.set(name === 'night' ? '#202840' : c.sunC);
  scene.fog.color.set(c.fog); scene.fog.near = name === 'night' ? 120 : 300; scene.fog.far = name === 'night' ? 1200 : 2600;
  renderer.toneMappingExposure = c.exp;
  W.furn.lampHeads.color.set(c.lamps ? '#fff2c0' : '#d6d6c8');
  W.furn.pools.material.opacity = c.lamps * 0.75;
  for (const m of [W.houses.walls, W.houses.fronts, W.houses.garages]) m.material.emissive.set(c.glow ? '#ffffff' : '#000000'), m.material.emissiveIntensity = c.glow * 0.55;
  sky.cloudMat.opacity = name === 'night' ? 0.15 : 1;
  stars3d.visible = name === 'night';
  scene.environment = makeEnv(renderer, sky.sky);
  // matte surfaces take less from the sky so shadows keep their depth; paint and glass stay shiny
  scene.traverse(o => { const m = o.material; if (m && m.isMeshStandardMaterial && !m.isMeshPhysicalMaterial && m.metalness < 0.5) m.envMapIntensity = name === 'night' ? 0.25 : 0.42; });
  fx.bloom.strength = name === 'night' ? 0.85 : name === 'sunset' ? 0.35 : 0.18;
  fx.grade.uniforms.warm.value = name === 'sunset' ? 0.05 : name === 'night' ? -0.02 : 0.025;
  headOn = name === 'night' || name === 'sunset';
}
// night sky
const stars3d = (() => {
  const g = new THREE.BufferGeometry(), p = [];
  for (let i = 0; i < 1500; i++) { const a = Math.random() * 6.28, b = Math.random() * 1.4 + 0.08, r = 3500; p.push(Math.cos(a) * Math.cos(b) * r, Math.sin(b) * r, Math.sin(a) * Math.cos(b) * r); }
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  const s = new THREE.Points(g, new THREE.PointsMaterial({ color: '#fff', size: 2, sizeAttenuation: false, fog: false })); s.visible = false; scene.add(s); return s;
})();

// ---------- player ----------
let player = null, model = null, kind = 'suv';
let headOn = false, headLight = null, headTarget = null;
const leftCars = [];   // cars you got out of: { d: Driver, model }
const walker = new Walker(scene); walker.show(false);
function attachLights() {
  headLight = new THREE.SpotLight('#fff3d8', 0, 70, 0.55, 0.5, 1.2);
  headLight.position.set(0, 1.0, VEHICLES[kind].L / 2); headTarget = new THREE.Object3D(); headTarget.position.set(0, -2, VEHICLES[kind].L / 2 + 25);
  model.root.add(headLight, headTarget); headLight.target = headTarget;
}
function spawnPlayer(k, x, z, h, color) {
  if (model && !leftCars.some(c => c.model === model)) scene.remove(model.root);
  G.onFoot = false; walker.show(false);
  kind = k;
  model = buildVehicle(k, color);
  scene.add(model.root);
  player = new Driver(k, x, z, h);
  attachLights();
  camState.init = false;
}
// a spot on the road: right-hand lane, facing along the road (closest to wanted heading)
function roadSpot(x, z, h) {
  const r = nearestRoad(x, z) || { qx: x, qz: z, tx: 0, tz: 1, w: 10 };
  let tx = r.tx, tz = r.tz;
  if (h != null && Math.sin(h) * tx + Math.cos(h) * tz < 0) { tx = -tx; tz = -tz; }
  const off = r.name === 'Carmel Mountain Rd' ? 5.6 : r.w * 0.24;
  return { x: r.qx - tz * off, z: r.qz + tx * off, h: Math.atan2(tx, tz) };
}

// ---------- home ----------
function homeHouse() {
  let h = save.home != null ? HOUSES[save.home] : null;
  if (!h || !h.num) { h = ADDRESSED.find(a => a.street === 'Quaker Hill Ln') || ADDRESSED[0]; }
  return h;
}

// ---------- markers & mission props ----------
const props = new THREE.Group(); scene.add(props);
const live = [];   // things with an update(dt)
function labelSprite(text, color = '#fff', bg = 'rgba(20,24,34,0.85)') {
  const c = document.createElement('canvas'), g = c.getContext('2d');
  g.font = 'bold 40px Arial'; const w = Math.min(1000, g.measureText(text).width + 40);
  c.width = w; c.height = 64; g.font = 'bold 40px Arial';
  g.fillStyle = bg; g.beginPath(); g.roundRect ? g.roundRect(0, 0, w, 64, 20) : g.rect(0, 0, w, 64); g.fill();
  g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(w / 64 * 1.3, 1.3, 1); s.renderOrder = 10;
  return s;
}
const ringTex = (() => {
  const c = document.createElement('canvas'); c.width = 4; c.height = 64; const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 64); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(255,255,255,0.9)'); g.fillStyle = gr; g.fillRect(0, 0, 4, 64);
  return new THREE.CanvasTexture(c);
})();
const markers = [];
function makeMarker(x, z, o = {}) {
  const g = new THREE.Group();
  const r = o.r || (o.small ? 3 : 4.5);
  const y = terrainH(x, z);
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(r, r, o.r ? 6 : 3, 40, 1, true), new THREE.MeshBasicMaterial({ color: o.color, map: ringTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
  ring.position.y = (o.r ? 3 : 1.5); g.add(ring);
  if (!o.r) {
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 40, 8, 1, true), new THREE.MeshBasicMaterial({ color: o.color, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
    beam.position.y = 20; g.add(beam);
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.8), new THREE.MeshBasicMaterial({ color: o.color })); gem.position.y = 5; g.add(gem); g.userData.gem = gem;
  }
  if (o.label) { const s = labelSprite(o.label); s.position.y = o.r ? 8 : 7.2; g.add(s); }
  g.position.set(x, y, z); props.add(g);
  const m = { x, z, r: o.r, color: o.color, g, remove() { props.remove(g); const i = markers.indexOf(m); if (i >= 0) markers.splice(i, 1); } };
  markers.push(m);
  return m;
}
function makeGate(gt) {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: '#ff3b30', emissive: '#ff3b30', emissiveIntensity: 0.4 });
  const half = gt.w / 2 + 1.5;
  for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, 6, 0.5), mat); p.position.set(s * half, 3, 0); g.add(p); }
  const top = new THREE.Mesh(new THREE.BoxGeometry(half * 2 + 0.5, 1.2, 0.5), new THREE.MeshLambertMaterial({ color: '#fff', emissive: '#ffffff', emissiveIntensity: 0.3 })); top.position.y = 6.3; g.add(top);
  const flag = labelSprite('🏁', '#fff', 'rgba(0,0,0,0)'); flag.position.y = 8; g.add(flag);
  g.position.set(gt.x, terrainH(gt.x, gt.z), gt.z); g.rotation.y = gt.h;
  props.add(g);
  const m = { x: gt.x, z: gt.z, color: '#ff3b30', g, remove() { props.remove(g); const i = markers.indexOf(m); if (i >= 0) markers.splice(i, 1); } };
  markers.push(m); return m;
}
function makeBay(b) {
  const g = new THREE.Group();
  const lines = new THREE.MeshBasicMaterial({ color: '#4cd964', transparent: true, opacity: 0.9 });
  const fill = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 5.4).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#4cd964', transparent: true, opacity: 0.25, depthWrite: false }));
  fill.position.y = 0.06; g.add(fill);
  for (const [w, d, x, z] of [[0.15, 5.4, -1.4, 0], [0.15, 5.4, 1.4, 0], [2.95, 0.15, 0, -2.7]]) { const l = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), lines); l.position.set(x, 0.07, z); g.add(l); }
  const s = labelSprite('P', '#fff', 'rgba(30,120,255,0.9)'); s.position.y = 3; g.add(s);
  g.position.set(b.x, terrainH(b.x, b.z), b.z); g.rotation.y = b.h; props.add(g);
  const m = { x: b.x, z: b.z, color: '#4cd964', g, remove() { props.remove(g); const i = markers.indexOf(m); if (i >= 0) markers.splice(i, 1); } };
  markers.push(m); return m;
}
function makePerson(opts, x, z) {
  const p = buildPerson(opts);
  p.g.position.set(x, terrainH(x, z), z); props.add(p.g);
  const o = {
    x, z, wave: false, target: null, cb: null, jump: 0,
    face(tx, tz) { if (!o.target) p.g.rotation.y = Math.atan2(tx - o.x, tz - o.z); },
    walkTo(tx, tz, cb) { o.target = [tx, tz]; o.cb = cb; o.wave = false; },
    cheer() { o.jump = 1.2; o.wave = true; },
    remove() { props.remove(p.g); const i = live.indexOf(o); if (i >= 0) live.splice(i, 1); },
    update(dt) {
      let sp = 0;
      if (o.target) {
        const dx = o.target[0] - o.x, dz = o.target[1] - o.z, d = Math.hypot(dx, dz);
        if (d < 1.4) { const cb = o.cb; o.target = null; o.cb = null; cb && cb(); return; }
        sp = 2.2; o.x += dx / d * sp * dt; o.z += dz / d * sp * dt; p.g.rotation.y = Math.atan2(dx, dz);
      }
      if (o.jump > 0) o.jump -= dt;
      p.g.position.set(o.x, terrainH(o.x, o.z) + (o.jump > 0 ? Math.abs(Math.sin(o.jump * 8)) * 0.4 : 0), o.z);
      animPerson(p, dt, sp, o.wave);
    },
  };
  live.push(o); return o;
}
function makeDog(x, z) {
  const d = buildDog(); d.g.scale.setScalar(1.3); d.g.position.set(x, terrainH(x, z), z); props.add(d.g);
  const label = labelSprite('🐶 Mochi'); label.position.y = 2.2; d.g.add(label);
  let t = 0;
  const o = {
    look(px, pz) { d.g.rotation.y = Math.atan2(px - x, pz - z); },
    remove() { props.remove(d.g); const i = live.indexOf(o); if (i >= 0) live.splice(i, 1); },
    update(dt) { t += dt; d.tail.rotation.y = Math.sin(t * 14) * 0.7; d.g.position.y = terrainH(x, z) + Math.abs(Math.sin(t * 5)) * 0.15; },
  };
  live.push(o); return o;
}
function makeBin(x, z, h) {
  // put the bin on the kerb, a little toward the house
  const r = nearestRoad(x, z), nx = (h.drive[0] - r.qx) / (r.d || 1), nz = (h.drive[1] - r.qz) / (r.d || 1);
  const bx = r.qx + nx * (r.w / 2 - 0.4) - nz * 3, bz = r.qz + nz * (r.w / 2 - 0.4) + nx * 3;
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.05, 0.75).translate(0, 0.52, 0), new THREE.MeshLambertMaterial({ color: '#2b6e3a' }));
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.08, 0.8), new THREE.MeshLambertMaterial({ color: '#1f4f2a' })); lid.position.y = 1.08;
  g.add(body, lid); g.position.set(bx, terrainH(bx, bz), bz); g.rotation.y = Math.atan2(nx, nz); props.add(g);
  const col = addTempCircle(bx, bz, 0.45, 'bin');
  let t = -1;
  const o = {
    x: bx, z: bz,
    empty() { t = 0; },
    update(dt) { if (t >= 0) { t += dt; lid.rotation.x = Math.min(1.8, t * 3); if (t > 1.2) { lid.rotation.x = 0; body.material.color.set('#3c8a4c'); t = -1; } } },
  };
  live.push(o); return o;
}
function makeStaticCar(x, z, h) {
  const k = ['sedan', 'suv', 'minivan'][Math.floor(Math.random() * 3)];
  const m = buildVehicle(k, ['#f4f4f4', '#1a1a1a', '#8d949a', '#2c4a7a', '#7a1c1c'][Math.floor(Math.random() * 5)]);
  m.root.position.set(x, terrainH(x, z), z); m.root.rotation.y = h; props.add(m.root);
  addTempBox(x, z, VEHICLES[k].W, VEHICLES[k].L, -h + Math.PI / 2 - Math.PI / 2, 'parked');
}

// ---------- smoke from a damaged engine ----------
const smokeTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30); gr.addColorStop(0, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
const puffs = [];
for (let i = 0; i < 30; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: '#555', transparent: true, depthWrite: false, opacity: 0 })); s.visible = false; scene.add(s); puffs.push({ s, life: 0 }); }
let puffT = 0;
function updateSmoke(dt) {
  const hp = player.health ?? 100;
  puffT -= dt;
  if (hp < 50 && puffT <= 0) {
    puffT = hp < 20 ? 0.06 : 0.16;
    const p = puffs.find(q => q.life <= 0);
    if (p) {
      const fx = Math.sin(player.h), fz = Math.cos(player.h), L = player.V.L / 2 - 0.6;
      p.s.position.set(player.x + fx * L, player.y + 1.2, player.z + fz * L); p.life = 1.6; p.s.visible = true;
      p.s.material.color.set(hp < 20 ? '#2a2a2a' : '#9a9a9a');
    }
  }
  for (const p of puffs) if (p.life > 0) {
    p.life -= dt; p.s.position.y += dt * 1.6; const k = 1.6 - p.life;
    p.s.scale.setScalar(0.8 + k * 2.2); p.s.material.opacity = Math.max(0, p.life / 1.6) * 0.7;
    if (p.life <= 0) p.s.visible = false;
  }
}

// ---------- game state ----------
const G = {
  mode: 'menu', mission: null, ms: null, t: 0, paused: false,
  gps: null, route: null, routeT: 0, nav: null, announced: null,
  viol: null, rulesOn: true, tip: null, tipT: 0, toast: null, passenger: null,
  clockText: null, clockWarn: false, cam: 0, home: null, homeMk: null, stars: [],
  speedT: 0, sideT: 0, stopWatch: null, prevSig: {}, cool: {},
};
const resetViol = () => ({ speed: 0, stop: 0, red: 0, crash: 0, side: 0, ped: 0 });

// chevrons that show the route on the road
const chevG = (() => { const s = new THREE.Shape(); s.moveTo(-1.1, -0.5); s.lineTo(0, 0.6); s.lineTo(1.1, -0.5); s.lineTo(1.1, -1.1); s.lineTo(0, 0); s.lineTo(-1.1, -1.1); s.closePath(); const g = new THREE.ShapeGeometry(s); g.rotateX(-Math.PI / 2); g.rotateY(Math.PI); return g; })();
const chevrons = new THREE.InstancedMesh(chevG, new THREE.MeshBasicMaterial({ color: '#2ee07a', transparent: true, opacity: 0.85, depthWrite: false }), 24);
chevrons.count = 0; chevrons.renderOrder = 3; chevrons.frustumCulled = false; scene.add(chevrons);

// ---------- the mission API ----------
const M = {
  get player() { return player; }, get viol() { return G.viol; }, get lang() { return save.lang; }, T,
  goal: null,
  startAt(x, z, h) { const s = roadSpot(x, z, h); spawnPlayer(G.vehicle, s.x, s.z, h == null ? s.h : (h != null ? s.h : s.h)); traffic.clear(s.x, s.z); },
  startAtHome() {
    const h = G.home, k = kerb(h);
    const r = nearestRoad(k.x, k.z);
    const s = roadSpot(k.x + r.tx * -6, k.z + r.tz * -6, Math.atan2(r.tx, r.tz));
    spawnPlayer(G.vehicle, s.x, s.z, s.h); traffic.clear(s.x, s.z);
  },
  goHome() { const k = kerb(G.home); G.homeMk = makeMarker(k.x, k.z, { color: '#4cd964', label: '🏠 ' + T('家', 'Home') }); M.gps(k.x, k.z); },
  stoppedAtHome() { const k = kerb(G.home); return M.stoppedAt(k.x, k.z, 8); },
  marker: makeMarker, gate: makeGate, bay: makeBay, person: makePerson, dog: makeDog, bin: makeBin,
  parkedCars(list) { for (const b of list) makeStaticCar(b.x, b.z, b.h); },
  speeder() {
    const ei = EDGES.findIndex(e => ROADS[e.r].name === 'Carmel Mountain Rd' && e.len > 100);
    const c = new AICar(scene, ei, 'sports', '#d0202a');
    c.place(ei, EDGES[ei].len * 0.5, 1); c.flee = player; c.update(0, traffic.cars, null);
    traffic.extra.push(c);
    const label = labelSprite('🚨 ' + T('超速車', 'Speeder'), '#fff', 'rgba(200,30,30,0.9)'); label.position.y = 3; c.model.root.add(label);
    c.stop = () => { c.halted = true; };
    return c;
  },
  gps(x, z, direct) { G.gps = x == null ? null : { x, z }; G.routeT = 0; },
  tip(text) { G.tip = text; G.tipT = 9; },
  msg(text, bad) { G.toast = { text, t: 3, bad }; },
  say(text) { say(text, save.lang); },
  sfx, jingle: jingleOn, siren(on) { sirenOn(on); G.siren = on; },
  armLift() { if (model.parts.arm) { G.armT = 0; } },
  busArm(on) { if (model.parts.stopArm) model.parts.stopArm.rotation.y = on ? 0 : Math.PI / 2; G.busArmOn = on; },
  passenger(n) { G.passenger = n; },
  rules(on) { G.rulesOn = on; },
  clock(left, time, extra) {
    const parts = [];
    if (time != null) { const h = Math.floor(time / 60), m = Math.floor(time % 60); parts.push(`🕗 ${h}:${String(m).padStart(2, '0')}`); }
    if (left != null) { const l = Math.max(0, left); parts.push(`⏱ ${Math.floor(l / 60)}:${String(Math.floor(l % 60)).padStart(2, '0')}`); }
    if (extra) parts.push(extra);
    G.clockText = parts.join('   '); G.clockWarn = left != null && left < 20;
  },
  dist(x, z) { return Math.hypot(player.x - x, player.z - z); },
  stoppedAt(x, z, r) { return M.dist(x, z) < r && player.speed < 0.9; },
  spawnSchoolKids() {
    for (let i = 0; i < 10; i++) { const k = makePerson({ kid: true, backpack: ['#e85d5d', '#4c8be0', '#f2c230'][i % 3] }, SCHOOL_DROP.x - 8 + i * 1.6, SCHOOL_DROP.z - 9 - (i % 2) * 2); k.wave = i % 3 === 0; }
    makePerson({ vest: true }, -112, 104).wave = true;   // crossing guard
  },
  win(stars, lines, quote) { endMission(true, stars, lines, quote); },
  fail(reason) { endMission(false, 0, [reason]); },
};

// ---------- the open city ----------
const cityApi = {
  T, save, persist, missions: MISSIONS, marker: (...a) => makeMarker(...a), person: (...a) => makePerson(...a),
  home: () => homeHouse(), toast: (text, bad) => { G.toast = { text, t: 3, bad }; }, sfx, say: t => say(t, save.lang),
  gps: (x, z) => { if (x == null) { G.gps = G.waypoint ? { ...G.waypoint } : null; } else M.gps(x, z); },
  siren: on => { if (on !== G.siren) { sirenOn(on); G.siren = on; } },
  trafficCars: () => traffic.cars,
  startMission: def => startMission(def),
  openDealer: () => openDealer(), openHome: () => openHome(),
  repaint: () => { const c = new THREE.Color().setHSL(Math.random(), 0.6 + Math.random() * 0.3, 0.35 + Math.random() * 0.25); model.parts.paint.color.copy(c); G.carColor = '#' + c.getHexString(); },
  busted: fine => { G.toast = { text: T(`被警察攔下來了！罰單 $${fine}`, `Pulled over! Ticket: $${fine}`), t: 4, bad: true }; sfx('fail'); },
};
const city = createCity(scene, cityApi);
const bigmap = createBigMap({
  data: () => ({ x: player ? player.x : 0, z: player ? player.z : 0, h: player ? player.h : 0, blips: G.city ? city.blips() : markers.map(m => ({ x: m.x, z: m.z, icon: '📍' })), stars: G.city ? G.stars.map(s => [s.x, s.z]) : null, waypoint: G.waypoint, route: G.route && G.route.pts }),
  onWaypoint: (x, z) => {
    if (G.city) {
      if (x == null) { G.waypoint = null; if (!city.ride) M.gps(null); }
      else { G.waypoint = { x, z }; if (!city.ride) M.gps(x, z); sfx('beep'); }
    }
  },
  onClose: () => { if (G.mode === 'map') G.mode = 'drive'; },
});
function openBigMap() { if (G.mode !== 'drive') return; G.mode = 'map'; engineOff(); horn(false); bigmap.open(); }

function restoreParked() { for (const p of W.parked) if (p.hidden) p.show(); }
function clearLeftCars() { for (const c of leftCars) if (c.model !== model) scene.remove(c.model.root); leftCars.length = 0; }

function clearMission() {
  for (const m of [...markers]) m.remove();
  for (const o of [...live]) o.remove && o.remove();
  live.length = 0;
  while (props.children.length) props.remove(props.children[0]);
  clearTemp(); restorePermanent();
  for (const c of traffic.extra) scene.remove(c.model.root);
  traffic.extra.length = 0;
  jingleOn(false); sirenOn(false); G.siren = false;
  G.gps = null; G.route = null; G.nav = null; G.tip = null; G.passenger = null; G.clockText = null; G.homeMk = null;
  chevrons.count = 0;
}

function startMission(def) {
  if (def.id === 'free') return startCity({ vehicle: def.vehicle, tod: def.tod });
  if (G.city) { G.cityReturn = { tod }; city.stop(); G.city = false; } else G.cityReturn = null;
  clearMission(); clearLeftCars(); restoreParked();
  G.onFoot = false; walker.show(false); G.waypoint = null;
  G.mission = def; G.mode = 'drive'; G.t = 0; G.viol = resetViol(); G.rulesOn = true; G.cool = {}; G.prevSig = {};
  G.home = homeHouse();
  G.vehicle = def.vehicle || G.freeVehicle || 'suv';
  setTOD(def.tod || G.freeTOD || 'day');
  G.stars = [];
  if (def.id === 'free') {
    M.startAtHome();
    STARS.forEach((s, i) => { if (!save.found.includes(i)) G.stars.push(makeStar(s, i)); });
    M.tip(T('自由開車！小地圖上的 ★ 是星星的位置。按 C 換視角，R 回到路上。', 'Free drive! ★ on the mini-map marks the stars. C changes the camera, R puts you back on the road.'));
    G.ms = null;
  } else {
    G.ms = def.setup(M);
  }
  hideAll();
  document.getElementById('hudbar').classList.remove('hidden');
  if (isTouch) document.getElementById('touch').classList.remove('hidden');
  audioInit();
}
// the open city: drive or walk anywhere, earn money, avoid the police
function startCity(o = {}) {
  if (G.city) city.stop();
  clearMission(); clearLeftCars(); restoreParked();
  G.mission = { ...FREE, id: 'free' }; G.mode = 'drive'; G.t = 0; G.viol = resetViol(); G.rulesOn = true; G.cool = {}; G.prevSig = {};
  G.home = homeHouse(); G.city = true; G.waypoint = null; G.ms = null; G.onFoot = false;
  setTOD(o.tod || G.freeTOD || 'day');
  G.vehicle = o.vehicle || G.freeVehicle || 'suv';
  if (o.at) { spawnPlayer(G.vehicle, o.at.x, o.at.z, o.at.h, o.color); }
  else M.startAtHome();
  G.stars = [];
  STARS.forEach((s, i) => { if (!save.found.includes(i)) G.stars.push(makeStar(s, i)); });
  city.start();
  M.tip(T('城市自由模式！按 M 看全地圖、F 下車／上車、E 互動。橘色圓圈是任務，🙋 是要搭便車的人。小心別被警察追！', 'Open city! M opens the map, F gets in and out, E interacts. Orange rings are missions, 🙋 people want a ride. Don’t get the police after you!'));
  hideAll();
  $('hudbar').classList.remove('hidden');
  if (isTouch) $('touch').classList.remove('hidden');
  audioInit();
}
function makeStar(s, i) {
  const shape = new THREE.Shape();
  for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2 - Math.PI / 2, r = k % 2 ? 0.45 : 1.1; k ? shape.lineTo(Math.cos(a) * r, Math.sin(a) * r) : shape.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 1 }); g.center();
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: '#ffcc00', emissive: '#ff9900', emissiveIntensity: 0.5 }));
  const y = terrainH(s[0], s[1]) + 1.8;
  m.position.set(s[0], y, s[1]); props.add(m);
  return { m, i, x: s[0], z: s[1], y };
}

function endMission(ok, stars, lines, quote) {
  if (G.mode !== 'drive') return;
  G.mode = 'result';
  const def = G.mission;
  let reward = 0;
  if (ok) {
    sfx('win');
    const prev = save.stars[def.id] || 0;
    if (!save.stars[def.id] || stars > save.stars[def.id]) { save.stars[def.id] = stars; }
    reward = 15 * stars + Math.max(0, stars - prev) * 50;   // a bonus for every new star
    save.money = (save.money || 0) + reward; persist();
    lines = [...lines, T(`💵 獎金 $${reward}`, `💵 Reward $${reward}`)];
  } else sfx('fail');
  jingleOn(false); sirenOn(false);
  const el = document.getElementById('result');
  el.querySelector('.rtitle').textContent = ok ? T('任務完成！', 'Mission complete!') : T('任務失敗', 'Mission failed');
  el.querySelector('.rstars').textContent = ok ? '★'.repeat(stars) + '☆'.repeat(3 - stars) : '';
  el.querySelector('.rquote').textContent = quote || '';
  el.querySelector('.rlines').innerHTML = lines.map(l => `<div>${l}</div>`).join('');
  const idx = MISSIONS.indexOf(def);
  el.querySelector('#rnext').style.display = ok && idx >= 0 && idx < MISSIONS.length - 1 && !G.cityReturn ? '' : 'none';
  el.querySelector('#rcity').style.display = G.cityReturn ? '' : 'none';
  el.classList.remove('hidden');
  document.getElementById('touch').classList.add('hidden');
  if (ok && quote) say(quote.replace(/^[^「"]*[「"]|[」"]$/g, ''), save.lang);
}

// ---------- rules ----------
function checkRules(dt) {
  if (G.onFoot) {
    const r = nearestRoad(player.x, player.z);
    G.street = r && r.edge < 3 ? (r.name || T('社區小路', 'Neighbourhood street')) : '';
    G.limit = 25; return;
  }
  const P = player, v = G.viol;
  const cool = (k, s) => { if ((G.cool[k] || 0) > G.t) return false; G.cool[k] = G.t + s; return true; };
  const r = nearestRoad(P.x, P.z);
  G.street = r && r.edge < 3 ? (r.name || T('社區小路', 'Neighbourhood street')) : (P.surface === 4 ? T('峽谷', 'Canyon') : P.surface === 3 ? 'Sage Canyon Park' : '');
  if (r && r.name === 'Sage Canyon School') G.street = 'Sage Canyon School';
  G.limit = r && r.edge < 3 ? LIMIT(r.name) : 25;
  // crashes
  if (P.impact > 4 && P.hitTag !== 'edge') {
    P.health -= (P.impact - 3.5) * 3.2;
    if (P.health <= 0 && !G.brokeMsg) { G.brokeMsg = true; G.toast = { text: T('車子壞了！按 F 下車，或按 R 叫拖吊車（$30）', 'Your car broke down! F to get out, or R for a tow ($30)'), t: 5, bad: true }; }
  }
  if (P.impact > 3.5 && ['house', 'car', 'parked', 'pole', 'tree', 'sign', 'school', 'building', 'barrier', 'bin', 'play', 'goal', 'landing'].includes(P.hitTag)) {
    sfx(P.impact > 7 ? 'crash' : 'bump', Math.min(1, P.impact / 10));
    if (cool('crash', 1.5)) { if (G.rulesOn || G.mission?.id === 'race' || G.mission?.id === 'parking') v.crash++; G.toast = { text: T('碰！小心駕駛', 'Bump! Careful'), t: 1.5, bad: true }; }
  } else if (P.impact > 1.2) sfx('bump', 0.3);
  if (!G.rulesOn || !G.viol) return;
  const mph = P.speed * MPH;
  // speeding
  if (mph > G.limit + 5) { G.speedT += dt; if (G.speedT > 1.5 && cool('speed', 6)) { v.speed++; sfx('warn'); G.toast = { text: T(`超速了！速限 ${G.limit} mph`, `Speeding! Limit ${G.limit} mph`), t: 2.5, bad: true }; } }
  else G.speedT = 0;
  // keep right
  if (r && r.edge < 0 && !ROADS[r.ri].oneway && P.speed > 4) {
    const lat = (P.x - r.qx) * -r.tz + (P.z - r.qz) * r.tx;
    const dir = Math.sin(P.h) * r.tx + Math.cos(P.h) * r.tz;
    const nearJ = NODES.some((n, i) => ADJ[i].length !== 2 && Math.hypot(n[0] - P.x, n[1] - P.z) < (ADJ[i].length === 1 ? 26 : 20));
    if (!nearJ && lat * Math.sign(dir) < (r.name === 'Carmel Mountain Rd' ? -1.5 : -0.9) && Math.abs(dir) > 0.6) {
      G.sideT += dt;
      if (G.sideT > 1.6 && cool('side', 6)) { v.side++; sfx('warn'); G.toast = { text: T('請靠右行駛！', 'Keep right!'), t: 2.5, bad: true }; }
    } else G.sideT = 0;
  } else G.sideT = 0;
  // stop signs: track the slowest speed in the 18 m before each line you cross
  const fx = Math.sin(P.h), fz = Math.cos(P.h);
  for (let i = 0; i < MAP.stops.length; i++) {
    const s = MAP.stops[i];
    const hx = Math.sin(s[2]), hz = Math.cos(s[2]);
    if (fx * hx + fz * hz < 0.6) continue;
    const lx = s[0] + hz * 3.6, lz = s[1] - hx * 3.6;    // centre of the stopping lane, at the line
    const along = (P.x - lx) * hx + (P.z - lz) * hz, lat = Math.abs((P.x - lx) * -hz + (P.z - lz) * hx);
    if (lat > 6) continue;
    const key = 's' + i;
    if (along > -18 && along < 0.5) { G.prevSig[key] = Math.min(G.prevSig[key] ?? 99, P.speed); }
    else if (along >= 0.5 && along < 6 && G.prevSig[key] != null) {
      if (G.prevSig[key] > 1.3 && cool('stop', 4)) { v.stop++; sfx('warn'); G.toast = { text: T('STOP 要完全停下來！', 'Come to a full stop at STOP!'), t: 2.5, bad: true }; }
      else if (G.prevSig[key] <= 1.3) G.toast = { text: T('停得好 👍', 'Nice stop 👍'), t: 1.2 };
      delete G.prevSig[key];
    } else if (along < -18 || along > 6) delete G.prevSig[key];
  }
  // red lights
  for (const n of MAP.signals) {
    const [nx, nz] = NODES[n];
    if (Math.hypot(P.x - nx, P.z - nz) > 45) continue;
    const wmax = Math.max(...ADJ[n].map(f => ROADS[EDGES[f].r].w));
    for (const ei of ADJ[n]) {
      const e = EDGES[ei], p = e.a === n ? e.pts[1] : e.pts[e.pts.length - 2];
      let dx = p[0] - nx, dz = p[1] - nz; const L = Math.hypot(dx, dz); dx /= L; dz /= L;
      if (fx * -dx + fz * -dz < 0.7) continue;
      const along = (P.x - nx) * dx + (P.z - nz) * dz, lat = Math.abs((P.x - nx) * -dz + (P.z - nz) * dx);
      if (lat > ROADS[e.r].w / 2 + 1) continue;
      const key = 'r' + n + ':' + ei, line = wmax / 2 + 3;
      if (G.prevSig[key] != null && G.prevSig[key] > line && along <= line) {
        if (lightFor(ROADS[e.r].name, n) === 'R' && P.speed > 2 && cool('red', 5)) { v.red++; sfx('warn'); G.toast = { text: T('闖紅燈了！', 'You ran a red light!'), t: 2.5, bad: true }; }
      }
      G.prevSig[key] = along;
    }
  }
  // pedestrians
  for (const w of traffic.people) if (w.scared) { w.scared = false; if (G.t > 3 && cool('ped', 4)) { v.ped++; G.toast = { text: T('小心行人！', 'Watch out for people!'), t: 2, bad: true }; } }
}

// ---------- GPS ----------
const fmtDist = m => save.lang === 'zh' ? (m >= 1000 ? (m / 1000).toFixed(1) + ' 公里' : Math.round(m / 10) * 10 + ' 公尺') : (m > 300 ? (m / 1609).toFixed(1) + ' mi' : Math.round(m * 3.28 / 50) * 50 + ' ft');
function updateGPS(dt) {
  if (!G.gps) { G.nav = null; chevrons.count = 0; G.route = null; return; }
  G.routeT -= dt;
  if (G.routeT <= 0) { G.routeT = 0.5; G.route = route(player.x, player.z, G.gps.x, G.gps.z); }
  const R = G.route; if (!R) return;
  // distance along the route to each turn
  const pts = R.pts; let acc = 0, cum = [0];
  for (let i = 1; i < pts.length; i++) { acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); cum.push(acc); }
  const total = acc + Math.hypot(player.x - pts[0][0], player.z - pts[0][1]);
  let next = null;
  for (const t of R.turns) {
    let best = 0, bd = 1e9; pts.forEach((p, i) => { const d = Math.hypot(p[0] - t.x, p[1] - t.z); if (d < bd) { bd = d; best = i; } });
    if (cum[best] > 4) { next = { ...t, d: cum[best] }; break; }
  }
  const destD = Math.hypot(player.x - G.gps.x, player.z - G.gps.z);
  if (next) {
    const verb = { left: T('左轉', 'Turn left onto'), right: T('右轉', 'Turn right onto'), straight: T('直走', 'Continue onto') }[next.dir];
    G.nav = { dir: next.dir, dist: fmtDist(next.d), text: `${verb} ${next.road || T('小路', 'the street')}` };
    const key = next.node + next.dir;
    if (next.d < 70 && G.announced !== key) {
      G.announced = key;
      say(save.lang === 'zh' ? `前方${next.d < 30 ? '' : Math.round(next.d / 10) * 10 + '公尺'}${{ left: '左轉', right: '右轉', straight: '直走' }[next.dir]}，${next.road}` : `In ${Math.round(next.d * 3.28 / 50) * 50} feet, ${verb} ${next.road}`, save.lang);
    }
  } else {
    G.nav = { dir: destD < 40 ? 'arrive' : 'straight', dist: fmtDist(Math.min(total, destD + 5)), text: destD < 40 ? T('目的地就在前面', 'Destination ahead') : T('直走到目的地', 'Go straight to the destination') };
  }
  // chevrons along the first ~150 m
  const M4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
  let n = 0, d = 6;
  for (let i = 1; i < pts.length && n < 24; i++) {
    while (cum[i] >= d && n < 24 && d < 160) {
      const t = (d - cum[i - 1]) / Math.max(0.01, cum[i] - cum[i - 1]);
      const x = lerp(pts[i - 1][0], pts[i][0], t), z = lerp(pts[i - 1][1], pts[i][1], t);
      const h = Math.atan2(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      // drawn on the right-hand lane
      const r = nearestRoad(x, z); const off = r && !ROADS[r.ri].oneway ? (r.name === 'Carmel Mountain Rd' ? 5.6 : r.w * 0.24) : 0;
      const ox = x - Math.cos(h) * off, oz = z + Math.sin(h) * off;
      q.setFromAxisAngle(up, h);
      M4.compose(v.set(ox, terrainH(ox, oz) + 0.12, oz), q, s); chevrons.setMatrixAt(n++, M4);
      d += 7;
    }
  }
  chevrons.count = n; chevrons.instanceMatrix.needsUpdate = true;
  chevrons.material.opacity = 0.55 + Math.sin(G.t * 5) * 0.25;
}

// ---------- camera ----------
const camState = { init: false, pos: new THREE.Vector3(), look: new THREE.Vector3(), yaw: 0 };
// keep the camera out of houses: pull it in front of the first wall between the car and the camera
const camRay = new THREE.Raycaster();
const camBlockers = [W.houses.walls, W.houses.fronts, W.houses.garages, W.houses.roofs];
function unblock(look, pos) {
  const dir = pos.clone().sub(look), len = dir.length();
  if (len < 0.5) return pos;
  camRay.set(look, dir.divideScalar(len)); camRay.far = len;
  const hit = camRay.intersectObjects(camBlockers, false)[0];
  return hit ? look.clone().addScaledVector(dir, Math.max(0.8, hit.distance - 0.4)) : pos;
}
const CAMS = ['chase', 'far', 'hood', 'top'];
function updateCamera(dt) {
  if (G.onFoot) {
    const P = walker;
    let dy = P.h - camState.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    if (!camState.init) camState.yaw = P.h; else camState.yaw += dy * Math.min(1, dt * 3);
    const cy = Math.sin(camState.yaw), cz = Math.cos(camState.yaw);
    const pos = new THREE.Vector3(P.x - cy * 4.6, P.y + 2.3, P.z - cz * 4.6);
    const gh = terrainH(pos.x, pos.z) + 0.8; if (pos.y < gh) pos.y = gh;
    const look = new THREE.Vector3(P.x + cy * 1.5, P.y + 1.3, P.z + cz * 1.5);
    pos.copy(unblock(new THREE.Vector3(P.x, P.y + 1.6, P.z), pos));
    if (!camState.init) { camState.pos.copy(pos); camState.look.copy(look); camState.init = true; }
    else { camState.pos.lerp(pos, Math.min(1, dt * 7)); camState.look.lerp(look, Math.min(1, dt * 10)); }
    camera.position.copy(camState.pos); camera.lookAt(camState.look); camera.fov = 62; camera.updateProjectionMatrix();
    const sd = sky.mat.uniforms.sunDir.value;
    sun.position.set(P.x + sd.x * 150, P.y + sd.y * 150, P.z + sd.z * 150); sun.target.position.set(P.x, P.y, P.z);
    return;
  }
  const P = player, V = VEHICLES[kind];
  const mode = CAMS[G.cam];
  const fx = Math.sin(P.h), fz = Math.cos(P.h);
  // chase cameras follow the direction of travel (and look back when reversing)
  let yawT = P.h;
  if (P.vf < -1) yawT = P.h;
  if (!camState.init) { camState.yaw = yawT; }
  let dy = yawT - camState.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  camState.yaw += dy * Math.min(1, dt * 4);
  const cy = Math.sin(camState.yaw), cz = Math.cos(camState.yaw);
  const big = V.L / 4.8;
  let pos, look;
  if (mode === 'chase' || mode === 'far') {
    const back = (mode === 'far' ? 15 : 8.5) * Math.max(1, big * 0.85), up = (mode === 'far' ? 6.5 : 3.2) * Math.max(1, big * 0.7);
    pos = new THREE.Vector3(P.x - cy * back, P.y + up, P.z - cz * back);
    const gh = terrainH(pos.x, pos.z) + 1.5; if (pos.y < gh) pos.y = gh;
    look = new THREE.Vector3(P.x + cy * 4, P.y + 1.4, P.z + cz * 4);
    camera.fov = 60 + Math.min(14, P.speed * 0.35);
  } else if (mode === 'hood') {
    const eye = kind === 'bus' ? [0.6, 2.4, V.L / 2 - 1.2] : kind === 'garbage' ? [0.6, 2.5, V.L / 2 - 1.0] : [0.38, kind === 'sports' ? 1.05 : 1.35, 0.3];
    const m = model.root.matrixWorld;
    pos = new THREE.Vector3(...eye).applyMatrix4(m);
    look = new THREE.Vector3(eye[0], eye[1] - 0.15, eye[2] + 10).applyMatrix4(m);
    camera.fov = 70;
  } else {
    pos = new THREE.Vector3(P.x - fx * 0.01, P.y + 70, P.z - fz * 22);
    look = new THREE.Vector3(P.x + fx * 6, P.y, P.z + fz * 6);
    camera.fov = 50;
  }
  if (!camState.init || mode === 'hood') { camState.pos.copy(pos); camState.look.copy(look); camState.init = true; }
  else { camState.pos.lerp(pos, Math.min(1, dt * 6)); camState.look.lerp(look, Math.min(1, dt * 10)); }
  if (mode === 'chase' || mode === 'far') camState.pos.copy(unblock(new THREE.Vector3(P.x, P.y + 1.8, P.z), camState.pos));
  camera.position.copy(camState.pos); camera.lookAt(camState.look);
  camera.updateProjectionMatrix();
  model.body.visible = true;
  // shadows follow the car
  const sd = sky.mat.uniforms.sunDir.value;
  sun.position.set(P.x + sd.x * 150, P.y + sd.y * 150, P.z + sd.z * 150); sun.target.position.set(P.x, P.y, P.z);
}

// ---------- input ----------
const keys = {};
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
addEventListener('keydown', e => {
  if (e.repeat) { keys[e.code] = true; return; }
  keys[e.code] = true;
  if (G.mode === 'map') { if (e.code === 'KeyM' || e.code === 'Escape') bigmap.close(); return; }
  if (G.mode !== 'drive') { if (e.code === 'Escape' && G.mode === 'pause') resume(); return; }
  if (e.code === 'KeyC') G.cam = (G.cam + 1) % CAMS.length;
  if (e.code === 'KeyL') headOn = !headOn;
  if (e.code === 'KeyR') resetCar();
  if (e.code === 'KeyM') openBigMap();
  if (e.code === 'KeyN') G.bigMap = !G.bigMap;
  if (e.code === 'KeyF') toggleCar();
  if (e.code === 'KeyE') actionKey();
  if (e.code === 'Escape' || e.code === 'KeyP') pause();
  if (['ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', e => { keys[e.code] = false; });
const touchState = { steer: 0, gas: 0, brake: 0, hand: false, horn: false };
let tiltSteer = 0;
function input() {
  const k = keys;
  let steer = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
  let throttle = k.KeyW || k.ArrowUp ? 1 : 0, brake = k.KeyS || k.ArrowDown ? 1 : 0;
  let hand = !!k.Space, hornK = !!k.KeyH;
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads) {
    if (!p) continue;
    const ax = p.axes[0] || 0; if (Math.abs(ax) > 0.12) steer = ax;
    throttle = Math.max(throttle, p.buttons[7]?.value || 0); brake = Math.max(brake, p.buttons[6]?.value || 0);
    if (p.buttons[0]?.pressed) hand = true; if (p.buttons[1]?.pressed) hornK = true;
    if (p.buttons[3]?.pressed && !G.padY) G.cam = (G.cam + 1) % CAMS.length; G.padY = p.buttons[3]?.pressed;
    if (p.buttons[9]?.pressed && !G.padStart) pause(); G.padStart = p.buttons[9]?.pressed;
  }
  if (isTouch) {
    if (save.tilt) steer = clamp(tiltSteer, -1, 1); else if (touchState.steer) steer = touchState.steer;
    throttle = Math.max(throttle, touchState.gas); brake = Math.max(brake, touchState.brake);
    hand = hand || touchState.hand; hornK = hornK || touchState.horn;
  }
  return { steer, throttle, brake, hand, horn: hornK, jump: !!k.Space || touchState.hand, run: !!(k.ShiftLeft || k.ShiftRight) || touchState.run };
}
// get out of the car, or into the nearest one
function toggleCar() {
  if (G.mode !== 'drive') return;
  if (!G.onFoot) {
    if (player.speed > 3) { G.toast = { text: T('先停車再下車！', 'Stop the car first!'), t: 1.5 }; return; }
    if (!G.city && G.mission && G.mission.id !== 'free') { G.toast = { text: T('任務中不能下車', 'You can’t get out during a mission'), t: 1.5 }; return; }
    const lx = Math.cos(player.h), lz = -Math.sin(player.h);   // the car's left (driver's) side
    const d = player.V.W / 2 + 0.8;
    leftCars.push({ d: player, model });
    player.vx = player.vz = 0;
    walker.place(player.x + lx * d, player.z + lz * d, player.h);
    walker.show(true); G.onFoot = true; player = walker; camState.init = false;
    engineOff(); horn(false); headLight.intensity = 0; sfx('door');
    if (city.ride) { /* the passenger leaves in city.update */ }
    return;
  }
  // nearest car: one you left, or one parked on a driveway
  let best = null, bd = 4.2;
  for (const c of leftCars) { const dd = Math.hypot(c.d.x - walker.x, c.d.z - walker.z) - c.d.V.L / 2 + 1.5; if (dd < bd) { bd = dd; best = { left: c }; } }
  for (const p of W.parked) if (!p.hidden) { const dd = Math.hypot(p.x - walker.x, p.z - walker.z) - 1.5; if (dd < bd) { bd = dd; best = { parked: p }; } }
  if (!best) { G.toast = { text: T('附近沒有車', 'No car nearby'), t: 1.2 }; return; }
  walker.show(false); G.onFoot = false; sfx('door');
  if (best.left) {
    const c = best.left; leftCars.splice(leftCars.indexOf(c), 1);
    player = c.d; model = c.model; kind = c.d.kind;
  } else {
    const p = best.parked; p.hide();
    kind = p.kind; model = buildVehicle(p.kind, p.color); scene.add(model.root);
    player = new Driver(p.kind, p.x, p.z, p.h);
    attachLights();
    if (G.city && Math.random() < 0.5) city.addHeat(0.6);   // borrowing a neighbour's car gets noticed sometimes
  }
  if (!headLight || !model.root.children.includes(headLight)) attachLights();
  camState.init = false;
}
function actionKey() {
  if (G.mode !== 'drive' || !G.city || !city.prompt) return;
  city.prompt.act();
}
function resetCar() {
  if (G.onFoot) return;
  if (player.health <= 0) {
    if (G.city) { const fee = Math.min(30, save.money || 0); save.money -= fee; persist(); G.toast = { text: T(`拖吊車把你的車修好了 −$${fee}`, `The tow truck fixed your car −$${fee}`), t: 3 }; }
    player.health = 100; G.brokeMsg = false;
  }
  const s = roadSpot(player.x, player.z, player.h);
  player.x = s.x; player.z = s.z; player.h = s.h; player.vx = player.vz = 0; player.yawRate = 0;
  camState.init = false;
}
// touch controls
function bindHold(id, on, off) {
  const el = document.getElementById(id); if (!el) return;
  const down = e => { e.preventDefault(); el.classList.add('on'); on(); audioInit(); };
  const up = e => { e.preventDefault(); el.classList.remove('on'); off(); };
  el.addEventListener('touchstart', down, { passive: false }); el.addEventListener('touchend', up); el.addEventListener('touchcancel', up);
  el.addEventListener('mousedown', down); el.addEventListener('mouseup', up); el.addEventListener('mouseleave', up);
}
bindHold('tLeft', () => touchState.steer = -1, () => { if (touchState.steer < 0) touchState.steer = 0; });
bindHold('tRight', () => touchState.steer = 1, () => { if (touchState.steer > 0) touchState.steer = 0; });
bindHold('tGas', () => touchState.gas = 1, () => touchState.gas = 0);
bindHold('tBrake', () => touchState.brake = 1, () => touchState.brake = 0);
bindHold('tHand', () => touchState.hand = true, () => touchState.hand = false);
bindHold('tHorn', () => touchState.horn = true, () => touchState.horn = false);
document.getElementById('tCam').addEventListener('click', () => { G.cam = (G.cam + 1) % CAMS.length; });
document.getElementById('tReset').addEventListener('click', () => resetCar());
document.getElementById('tF').addEventListener('click', () => toggleCar());
document.getElementById('tE').addEventListener('click', () => actionKey());
document.getElementById('tMap').addEventListener('click', () => openBigMap());
bindHold('tRun', () => touchState.run = true, () => touchState.run = false);
document.getElementById('tPause').addEventListener('click', () => pause());
addEventListener('deviceorientation', e => {
  if (!save.tilt) return;
  const landscape = Math.abs(window.orientation || (screen.orientation && screen.orientation.angle) || 0) === 90;
  const ang = screen.orientation ? screen.orientation.angle : (window.orientation || 0);
  let v = landscape ? e.beta : e.gamma;
  if (ang === -90 || ang === 270) v = -v;
  tiltSteer = clamp((v || 0) / 25, -1, 1);
});

// ---------- menus ----------
const $ = id => document.getElementById(id);
function hideAll() { for (const id of ['menu', 'missions', 'free', 'settings', 'result', 'pause', 'shop', 'home']) $(id).classList.add('hidden'); }
function show(id) { hideAll(); $(id).classList.remove('hidden'); }
function applyLang() {
  document.querySelectorAll('[data-zh]').forEach(el => { el.textContent = save.lang === 'zh' ? el.dataset.zh : el.dataset.en; });
  $('starsTotal').textContent = `★ ${totalStars()} / ${MISSIONS.length * 3}`;
}
function buildMissionList() {
  const box = $('mlist'); box.innerHTML = '';
  for (const m of MISSIONS) {
    const b = document.createElement('button'); b.className = 'mcard';
    const st = save.stars[m.id] || 0;
    b.innerHTML = `<div class="mi">${m.icon}</div><div class="mt">${T(m.zh, m.en)}</div><div class="md">${T(m.dzh, m.den)}</div><div class="ms">${'★'.repeat(st)}${'☆'.repeat(3 - st)}</div>`;
    b.onclick = () => startMission(m);
    box.appendChild(b);
  }
}
function buildFree() {
  const vs = $('vlist'); vs.innerHTML = '';
  const total = totalStars();
  for (const [k, v] of Object.entries(VEHICLES)) {
    if (v.ai) continue;
    const locked = !save.owned.includes(k);
    const b = document.createElement('button'); b.className = 'vcard' + (G.freeVehicle === k ? ' sel' : '') + (locked ? ' locked' : '');
    b.innerHTML = `<span class="sw" style="background:${v.color}"></span>${T(v.zh, v.en)}${locked ? ` 🔒 $${PRICES[k]}` : ''}`;
    b.onclick = () => { if (locked) return; G.freeVehicle = k; buildFree(); };
    vs.appendChild(b);
  }
  const ts = $('tlist'); ts.innerHTML = '';
  for (const [k, zh, en] of [['morning', '早上', 'Morning'], ['day', '中午', 'Midday'], ['sunset', '黃昏', 'Sunset'], ['night', '晚上', 'Night']]) {
    const b = document.createElement('button'); b.className = 'vcard' + (G.freeTOD === k ? ' sel' : ''); b.textContent = T(zh, en);
    b.onclick = () => { G.freeTOD = k; buildFree(); }; ts.appendChild(b);
  }
  $('freeFound').textContent = T(`💵 $${save.money}・已找到 ${save.found.length} / 20 顆星星・🔒 的車可以在城市裡的車行買`, `💵 $${save.money} · ${save.found.length} / 20 stars found · buy 🔒 cars at the dealer in the city`);
}
function buildSettings() {
  const sel = $('homeSel'); sel.innerHTML = '';
  const list = ADDRESSED.slice().sort((a, b) => a.street.localeCompare(b.street) || a.num - b.num);
  const cur = homeHouse();
  for (const h of list) { const o = document.createElement('option'); o.value = h.i; o.textContent = addr(h); if (h === cur) o.selected = true; sel.appendChild(o); }
  $('langSel').value = save.lang; $('trafficSel').value = save.traffic; $('tiltChk').checked = !!save.tilt; $('muteChk').checked = isMuted(); $('qualSel').value = save.quality;
}
G.freeVehicle = 'suv'; G.freeTOD = 'day';
$('bMissions').onclick = () => { buildMissionList(); show('missions'); };
$('bFree').onclick = () => { buildFree(); show('free'); };
$('bSettings').onclick = () => { buildSettings(); show('settings'); };
$('bGo').onclick = () => startCity({ vehicle: G.freeVehicle, tod: G.freeTOD });
$('rcity').onclick = () => { const o = G.cityReturn || {}; G.cityReturn = null; startCity({ vehicle: kind, tod: o.tod || tod, at: { x: player.x, z: player.z, h: player.h } }); };
$('shopClose').onclick = () => { hideAll(); G.mode = 'drive'; };
$('homeClose').onclick = () => { hideAll(); G.mode = 'drive'; };
function openDealer() {
  G.mode = 'shop'; engineOff(); horn(false); show('shop');
  const box = $('shopList'); box.innerHTML = '';
  $('shopMoney').textContent = `💵 $${save.money}`;
  for (const [k, v] of Object.entries(VEHICLES)) {
    if (v.ai) continue;
    const owned = save.owned.includes(k), price = PRICES[k] ?? 300;
    const needStars = k === 'police' ? 10 : 0, okStars = totalStars() >= needStars;
    const b = document.createElement('button'); b.className = 'vcard' + (owned ? ' sel' : '');
    b.innerHTML = `<span class="sw" style="background:${v.color}"></span>${T(v.zh, v.en)} — ${owned ? T('已擁有・開走', 'Owned · drive it') : `$${price}`}${!okStars ? T(`（要 ${needStars}★）`, ` (needs ${needStars}★)`) : ''}`;
    b.onclick = () => {
      if (!owned) {
        if (!okStars) { sfx('fail'); return; }
        if (save.money < price) { sfx('fail'); $('shopMoney').textContent = T(`💵 $${save.money}・錢不夠！`, `💵 $${save.money} · not enough!`); return; }
        save.money -= price; save.owned.push(k); persist(); sfx('win');
      }
      // drive the car out of the showroom
      const d = city.shops.dealer.door;
      const sp = roadSpot(d[0], d[1], null);
      if (!G.onFoot) leftCars.push({ d: player, model });
      spawnPlayer(k, sp.x, sp.z, sp.h);
      hideAll(); G.mode = 'drive';
    };
    box.appendChild(b);
  }
}
function openHome() {
  G.mode = 'home'; engineOff(); horn(false); show('home');
  const gar = $('garageList'); gar.innerHTML = '';
  for (const k of save.owned) {
    const v = VEHICLES[k];
    const b = document.createElement('button'); b.className = 'vcard';
    b.innerHTML = `<span class="sw" style="background:${v.color}"></span>${T(v.zh, v.en)}`;
    b.onclick = () => {
      const h = G.home, kb = kerb(h), r = nearestRoad(kb.x, kb.z);
      const sp = roadSpot(kb.x, kb.z, Math.atan2(r.tx, r.tz));
      if (!G.onFoot) leftCars.push({ d: player, model });
      spawnPlayer(k, sp.x, sp.z, sp.h); hideAll(); G.mode = 'drive';
    };
    gar.appendChild(b);
  }
  const ml = $('homeMissions'); ml.innerHTML = '';
  for (const id of HOME_MISSIONS) {
    const m = MISSIONS.find(q => q.id === id), st = save.stars[id] || 0;
    const b = document.createElement('button'); b.className = 'vcard';
    b.textContent = `${m.icon} ${T(m.zh, m.en)} ${'★'.repeat(st)}${'☆'.repeat(3 - st)}`;
    b.onclick = () => startMission(m);
    ml.appendChild(b);
  }
}
document.querySelectorAll('.back').forEach(b => b.onclick = () => { show('menu'); applyLang(); });
$('homeSel').onchange = e => { save.home = +e.target.value; persist(); };
$('langSel').onchange = e => { save.lang = e.target.value; persist(); applyLang(); buildSettings(); };
$('trafficSel').onchange = e => {
  save.traffic = +e.target.value; persist();
  for (const c of traffic.cars) scene.remove(c.model.root); for (const p of traffic.people) { scene.remove(p.p.g); if (p.dog) scene.remove(p.dog.g); }
  traffic = createTraffic(scene, [8, 16, 26][save.traffic], [12, 26, 40][save.traffic]);
};
$('qualSel').onchange = e => { save.quality = +e.target.value; persist(); renderer.setPixelRatio(Math.min(devicePixelRatio, save.quality ? 2 : 1)); renderer.shadowMap.enabled = !!save.quality; resize(); };
$('tiltChk').onchange = e => {
  save.tilt = e.target.checked; persist();
  if (save.tilt && typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) DeviceOrientationEvent.requestPermission().catch(() => { });
};
$('muteChk').onchange = e => setMute(e.target.checked);
$('rretry').onclick = () => startMission(G.mission);
$('rnext').onclick = () => { const i = MISSIONS.indexOf(G.mission); startMission(MISSIONS[i + 1]); };
$('rmenu').onclick = () => toMenu();
$('presume').onclick = () => resume();
$('prestart').onclick = () => startMission(G.mission);
$('pmenu').onclick = () => toMenu();
function pause() { if (G.mode !== 'drive') return; G.mode = 'pause'; engineOff(); horn(false); show('pause'); }
function resume() { hideAll(); G.mode = 'drive'; }
function toMenu() {
  if (G.city) { city.stop(); G.city = false; }
  clearMission(); clearLeftCars(); restoreParked(); G.onFoot = false; walker.show(false); G.cityReturn = null;
  G.mode = 'menu'; engineOff(); horn(false);
  $('hudbar').classList.add('hidden'); $('touch').classList.add('hidden');
  show('menu'); applyLang();
  menuCam();
}
function menuCam() { setTOD('sunset'); }

// ---------- loop ----------
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  fx.composer.setSize(w, h);
  hudC.width = w * devicePixelRatio; hudC.height = h * devicePixelRatio;
}
addEventListener('resize', resize); resize();

let last = performance.now(), menuT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  updateSignals(W.furn, dt);
  if (G.mode === 'drive') {
    G.t += dt;
    const inp = input();
    const parkedCars = leftCars.map(c => c.d);
    const others = traffic.cars.concat(traffic.extra, parkedCars, G.city ? city.cops : []);
    if (G.onFoot) {
      walker.update(dt, inp, others);
      if (walker.impact > 3) { if (!G.cool.walkHit || G.cool.walkHit < G.t) { G.cool.walkHit = G.t + 1.5; G.toast = { text: T('哎呀！小心車子！', 'Whoa! Watch out for cars!'), t: 1.5, bad: true }; sfx('bump', 0.4); } }
    } else {
      const steps = 3;
      for (let i = 0; i < steps; i++) player.update(dt / steps, inp, others);
      poseVehicle(model, player, dt);
    }
    for (const c of leftCars) poseVehicle(c.model, c.d, dt);
    traffic.update(dt, player);
    for (const o of live) o.update(dt);
    const before = G.viol ? { ...G.viol } : null;
    checkRules(dt);
    if (G.city && before) {
      const HEAT = { speed: 0.6, stop: 0.5, red: 1.1, crash: 0.35, side: 0.3, ped: 1 };
      for (const k in HEAT) if (G.viol[k] > before[k]) city.addHeat(HEAT[k]);
    }
    if (G.city) city.update(dt, { x: player.x, z: player.z, inCar: !G.onFoot, car: G.onFoot ? null : player, walker: G.onFoot ? walker : null, t: G.t });
    if (G.mission && G.mission.update && G.ms) G.mission.update(M, G.ms, dt);
    // stars in free drive
    for (const s of [...G.stars]) {
      s.m.rotation.y += dt * 2; s.m.position.y = s.y + Math.sin(G.t * 2 + s.i) * 0.3;
      if (Math.hypot(player.x - s.x, player.z - s.z) < 4.5) {
        props.remove(s.m); G.stars.splice(G.stars.indexOf(s), 1); save.found.push(s.i); save.money = (save.money || 0) + 25; persist(); sfx('star');
        G.toast = { text: `★ ${save.found.length} / 20`, t: 2 };
        if (save.found.length === 20) { G.toast = { text: T('20 顆星星全部找到了！🎉', 'All 20 stars found! 🎉'), t: 4 }; sfx('win'); }
      }
    }
    if (G.mission?.id === 'free' && G.stars.length) {
      // GPS to the nearest star if none is set
      let n = null, nd = 1e9; for (const s of G.stars) { const d = Math.hypot(player.x - s.x, player.z - s.z); if (d < nd) { nd = d; n = s; } }
      if (G.starGPS) M.gps(n.x, n.z);
    }
    updateGPS(dt);
    // markers bob
    for (const m of markers) if (m.g.userData.gem) { m.g.userData.gem.rotation.y += dt * 2; m.g.userData.gem.position.y = 5 + Math.sin(G.t * 3) * 0.4; }
    if (!G.onFoot) {
    // car lights
    headLight.intensity = headOn ? 60 : 0;
    for (const l of model.parts.lights) l.material.color.set(headOn ? '#ffffff' : '#e8e2cc');
    model.parts.tailM.color.set(player.braking ? '#ff2020' : headOn ? '#c01818' : '#7a1010');
    for (const b of model.parts.beacons) b.m.material.color.set(Math.floor(G.t * 6 + (b.col === '#ff2020' ? 0 : 1)) % 2 ? b.col : '#222');
    if (model.parts.arm && G.armT != null) { G.armT += dt; model.parts.arm.rotation.z = Math.sin(Math.min(1, G.armT / 1.4) * Math.PI) * 1.4; if (G.armT > 1.4) G.armT = null; }
    if (model.parts.stopArm && !G.busArmOn) model.parts.stopArm.rotation.y = Math.PI / 2;
    horn(inp.horn, kind);
    engineSound(player.speed, player.health > 0 ? inp.throttle : 0, kind, player.drift || 0, player.surface >= 3 && player.speed > 2);
    updateSmoke(dt);
    }
    if (G.tipT > 0) { G.tipT -= dt; if (G.tipT <= 0) G.tip = null; }
    if (G.toast) G.toast.t -= dt;
    // AI horns
    for (const c of traffic.cars) if (c.honk) { c.honk = 0; if (Math.hypot(c.x - player.x, c.z - player.z) < 25) horn(true, 'suv'), setTimeout(() => horn(false), 300); }
    updateCamera(dt);
  } else if (G.mode === 'menu' || G.mode === 'result' || G.mode === 'pause') {
    if (G.mode === 'menu') {
      traffic.update(dt, null);
      menuT += dt * 0.05;
      const cx = MAP.school[0], cz = MAP.school[1];
      camera.position.set(cx + Math.cos(menuT) * 260, 120, cz + Math.sin(menuT) * 260);
      camera.lookAt(cx, 0, cz); camera.fov = 50; camera.updateProjectionMatrix();
      sun.position.set(cx + 150, 150, cz + 50); sun.target.position.set(cx, 0, cz);
    }
  }
  if (save.quality) fx.composer.render(); else renderer.render(scene, camera);
  drawHUD(hud, hudC.width, hudC.height, G.mode === 'drive' ? {
    dpr: devicePixelRatio, player, street: G.street, limit: G.limit || 25, nav: G.nav,
    mission: G.mission ? T(G.mission.zh, G.mission.en) : null, clockText: G.clockText, clockWarn: G.clockWarn, passenger: G.passenger,
    tip: G.tip, toast: G.toast, showMap: true, bigMap: G.bigMap, routePts: G.route && G.route.pts, cars: traffic.cars.concat(G.city ? city.cops : []), markers,
    stars: G.mission?.id === 'free' ? G.stars.map(s => [s.x, s.z]) : null, starCount: G.mission?.id === 'free' ? save.found.length : null,
    home: G.home, touch: isTouch, maxMph: Math.ceil(VEHICLES[kind].vmax * MPH / 10) * 10 + 10,
    money: G.city ? save.money : null, wanted: G.city ? city.wanted : null, onFoot: G.onFoot, health: G.onFoot ? null : player.health,
    prompt: G.city && city.prompt ? city.prompt.label : (G.onFoot ? T('F：上車', 'F: get in a car') : null),
  } : { dpr: devicePixelRatio });
}
setTOD('sunset');
applyLang();
loading.classList.add('hidden');
show('menu');
requestAnimationFrame(frame);

// for testing
window.SCD = { G, M, get player() { return player; }, MISSIONS, startMission, startCity, city, walker, toggleCar, openBigMap, bigmap, leftCars, scene, camera, renderer, traffic: () => traffic, keys, setTOD, route, FREE, save, W };
