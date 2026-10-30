// The neighbourhood: terrain from the traced map, houses from the map's footprints, trees, signs and the school.
import * as THREE from '../lib/three.module.min.js';
import { MAP } from './mapdata.js';
import { ROADS, NODES, EDGES, ADJ, terrainH, nearestRoad, HOUSES, clamp, SHOPS } from './roads.js';
import { buildRoads } from './roadmesh.js';
import { mergedVehicle } from './car.js';

const rnd = (() => { let s = 12345; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
const pick = a => a[Math.floor(rnd() * a.length)];

export const COLLIDE = { boxes: [], circles: [] };   // boxes: {x,z,hw,hd,c,s}  circles: {x,z,r}
const CG = 20, cgrid = new Map();
function addCol(o, r) {
  const x0 = Math.floor((o.x - r) / CG), x1 = Math.floor((o.x + r) / CG), z0 = Math.floor((o.z - r) / CG), z1 = Math.floor((o.z + r) / CG);
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
    const k = x * 4096 + z; if (!cgrid.has(k)) cgrid.set(k, []); cgrid.get(k).push(o);
  }
}
function addBox(x, z, w, d, ang, tag) {
  const o = { type: 'box', x, z, hw: w / 2, hd: d / 2, c: Math.cos(ang), s: Math.sin(ang), tag };
  COLLIDE.boxes.push(o); addCol(o, Math.hypot(w, d) / 2);
  return o;
}
function addCircle(x, z, r, tag) { const o = { type: 'circle', x, z, r, tag }; COLLIDE.circles.push(o); addCol(o, r); }
// temporary colliders for a mission (parked cars in the car park, bins…)
const temp = [];
export function addTempBox(x, z, w, d, ang, tag) { const o = { type: 'box', x, z, hw: w / 2, hd: d / 2, c: Math.cos(ang), s: Math.sin(ang), tag }; temp.push(o); return o; }
export function addTempCircle(x, z, r, tag) { const o = { type: 'circle', x, z, r, tag }; temp.push(o); return o; }
export function removeTemp(o) { const i = temp.indexOf(o); if (i >= 0) temp.splice(i, 1); }
export function clearTemp() { temp.length = 0; }
export function collidersNear(x, z) {
  const l = cgrid.get(Math.floor(x / CG) * 4096 + Math.floor(z / CG)) || [];
  if (!temp.length) return l;
  return l.concat(temp.filter(o => Math.abs(o.x - x) < 25 && Math.abs(o.z - z) < 25));
}

function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 4;
  return t;
}
function noiseFill(g, w, h, base, amt, n) {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    const v = (rnd() - 0.5) * amt;
    g.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`;
    g.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 3, 2 + rnd() * 3);
  }
}

// ---------- materials ----------
const wallTex = canvasTex(256, 192, (g, w, h) => {
  noiseFill(g, w, h, '#ffffff', 0.12, 1800);
  // one window per 4 m bay, one storey per tile
  g.fillStyle = '#f4f1ea'; g.fillRect(70, 46, 116, 92);
  g.fillStyle = '#5c6b78'; g.fillRect(78, 54, 100, 76);
  g.fillStyle = 'rgba(255,255,255,0.25)'; g.beginPath(); g.moveTo(78, 54); g.lineTo(130, 54); g.lineTo(78, 110); g.fill();
  g.fillStyle = '#f4f1ea'; g.fillRect(126, 54, 4, 76); g.fillRect(78, 90, 100, 4);
  g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(66, 138, 124, 6);
}, true);
const frontTex = canvasTex(512, 384, (g, w, h) => {
  noiseFill(g, w, h, '#ffffff', 0.12, 3000);
  // upper floor windows (top half)
  for (const x of [60, 200, 350]) {
    g.fillStyle = '#f4f1ea'; g.fillRect(x - 6, 50, 112, 90);
    g.fillStyle = '#5c6b78'; g.fillRect(x, 56, 100, 78);
    g.fillStyle = '#f4f1ea'; g.fillRect(x + 48, 56, 4, 78);
  }
  // garage door (bottom half, left)
  g.fillStyle = '#efece4'; g.fillRect(24, 220, 270, 164);
  g.fillStyle = '#e2ded4';
  for (let y = 232; y < 384; y += 30) g.fillRect(34, y, 250, 24);
  g.strokeStyle = 'rgba(0,0,0,0.15)'; g.lineWidth = 2;
  for (let y = 232; y < 384; y += 30) g.strokeRect(34, y, 250, 24);
  // front door and window
  g.fillStyle = '#7a4b2c'; g.fillRect(360, 250, 64, 134);
  g.fillStyle = '#d9b35b'; g.beginPath(); g.arc(412, 320, 4, 0, 7); g.fill();
  g.fillStyle = '#f4f1ea'; g.fillRect(440, 252, 60, 72);
  g.fillStyle = '#5c6b78'; g.fillRect(446, 258, 48, 60);
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(350, 240, 84, 8);
});
// the same windows, lit, for night
const wallGlow = canvasTex(256, 192, (g, w, h) => { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); g.fillStyle = '#ffd48a'; g.fillRect(78, 54, 100, 76); g.fillStyle = '#000'; g.fillRect(126, 54, 4, 76); g.fillRect(78, 90, 100, 4); }, true);
const frontGlow = canvasTex(512, 384, (g, w, h) => {
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h); g.fillStyle = '#ffd48a';
  for (const x of [60, 350]) g.fillRect(x, 56, 100, 78);
  g.fillStyle = '#7a5a30'; g.fillRect(200, 56, 100, 78);
  g.fillStyle = '#ffd48a'; g.fillRect(446, 258, 48, 60); g.fillStyle = '#ffeec0'; g.fillRect(352, 236, 80, 10);
});
const roofTex = canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 16) {
    g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, y + 12, w, 4);
    for (let x = (y / 16) % 2 ? 8 : 0; x < w; x += 16) { g.fillStyle = `rgba(0,0,0,${0.05 + rnd() * 0.1})`; g.fillRect(x, y, 2, 12); }
  }
}, true);

const WALLS = ['#efe3cc', '#e8d6b8', '#f3ece0', '#dcc8a8', '#e9dccb', '#f5efe6', '#d8c4a4', '#e4d2bf', '#cfc4b3', '#ead2b6'];
const ROOFS = ['#b5562f', '#a34a2a', '#c0673b', '#9a5634', '#8c5a44', '#7c6f66', '#a85e3c', '#b86a45'];

// ---------- houses ----------
function buildHouses(scene) {
  const W = { p: [], uv: [], c: [], n: [] }, F = { p: [], uv: [], c: [], n: [] }, R = { p: [], uv: [], c: [], n: [] };
  const col = new THREE.Color();
  const quad = (B, a, b, c, d, uvs, color, nrm) => {
    for (const [v, uv] of [[a, uvs[0]], [b, uvs[1]], [c, uvs[2]], [a, uvs[0]], [c, uvs[2]], [d, uvs[3]]]) {
      B.p.push(v[0], v[1], v[2]); B.uv.push(uv[0], uv[1]); B.c.push(color.r, color.g, color.b); B.n.push(nrm[0], nrm[1], nrm[2]);
    }
  };
  const tri = (B, a, b, c, color) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const L = Math.hypot(nx, ny, nz); nx /= L; ny /= L; nz /= L;
    for (const v of [a, b, c]) { B.p.push(v[0], v[1], v[2]); B.uv.push(v[0] * 0.35 + v[2] * 0.12, v[1] * 0.9 + v[2] * 0.35); B.c.push(color.r, color.g, color.b); B.n.push(nx, ny, nz); }
  };
  const SCHOOLC = new THREE.Color('#d9c7a5');
  for (const h of HOUSES) {
    const cx = h.x, cz = h.z, y0 = terrainH(cx, cz);
    const ca = Math.cos(h.ang), sa = Math.sin(h.ang);
    const big = h.w * h.d;
    const stories = h.school ? 1 : (big > 230 ? (rnd() < 0.75 ? 2 : 1) : (rnd() < 0.45 ? 2 : 1));
    const ht = h.school ? 4.6 : stories * 3.0 + 0.4;
    const hw = h.w / 2, hd = h.d / 2;
    // world position of local (u along w, v along d)
    const P = (u, v, y) => [cx + u * ca - v * sa, y0 + y, cz + u * sa + v * ca];
    col.set(h.school ? '#dccbb0' : pick(WALLS));
    // which face points to the street
    const fx = Math.sin(h.front), fz = Math.cos(h.front);
    const faces = [
      { a: [-hw, -hd], b: [hw, -hd], n: [sa, -ca] },   // local -v side, outward normal (world)
      { a: [hw, -hd], b: [hw, hd], n: [ca, sa] },
      { a: [hw, hd], b: [-hw, hd], n: [-sa, ca] },
      { a: [-hw, hd], b: [-hw, -hd], n: [-ca, -sa] },
    ];
    let fi = 0, bd = -2;
    faces.forEach((f, i) => { const d = f.n[0] * fx + f.n[1] * fz; if (d > bd) { bd = d; fi = i; } });
    faces.forEach((f, i) => {
      const L = Math.hypot(f.b[0] - f.a[0], f.b[1] - f.a[1]);
      const A = P(f.a[0], f.a[1], -1.5), B_ = P(f.b[0], f.b[1], -1.5), C = P(f.b[0], f.b[1], ht), D = P(f.a[0], f.a[1], ht);
      const nrm = [f.n[0], 0, f.n[1]];
      const vb = -1.5 / 3, vt = ht / 3;
      if (i === fi && !h.school && L > 7) {
        // front: garage + door texture; top half used only for two storeys
        const v0 = stories === 2 ? 0 : 0.5;
        quad(F, A, B_, C, D, [[0, -0.05], [1, -0.05], [1, 1 - v0 + 0.0], [0, 1 - v0]].map(([u, v]) => [u, v]), col, nrm);
      } else {
        quad(W, A, B_, C, D, [[0, vb], [L / 4, vb], [L / 4, vt], [0, vt]], h.school ? SCHOOLC : col, nrm);
      }
    });
    // roof
    const rc = new THREE.Color(h.school ? '#9aa0a6' : pick(ROOFS));
    const o = 0.55, Hw = hw + o, Hd = hd + o;
    if (h.school) {
      const y = ht;
      quad(R, P(-Hw, -Hd, y), P(-Hw, Hd, y), P(Hw, Hd, y), P(Hw, -Hd, y), [[0, 0], [0, 1], [1, 1], [1, 0]], rc, [0, 1, 0]);
      addBox(cx, cz, h.w, h.d, h.ang, 'school');
      continue;
    }
    const along = h.w >= h.d;   // ridge along the long side
    const rise = Math.min(hw, hd) * 0.5;
    const y = ht, yt = ht + rise;
    Object.assign(h, { ht, rise, along, y0 });
    if (along) {
      const r = Math.max(0.01, Hw - Hd);
      const r1 = P(-r, 0, yt), r2 = P(r, 0, yt);
      tri(R, P(-Hw, -Hd, y), r1, r2, rc); tri(R, P(-Hw, -Hd, y), r2, P(Hw, -Hd, y), rc);
      tri(R, P(Hw, Hd, y), r2, r1, rc); tri(R, P(Hw, Hd, y), r1, P(-Hw, Hd, y), rc);
      tri(R, P(-Hw, Hd, y), r1, P(-Hw, -Hd, y), rc); tri(R, P(Hw, -Hd, y), r2, P(Hw, Hd, y), rc);
    } else {
      const r = Math.max(0.01, Hd - Hw);
      const r1 = P(0, -r, yt), r2 = P(0, r, yt);
      tri(R, P(Hw, -Hd, y), r1, r2, rc); tri(R, P(Hw, -Hd, y), r2, P(Hw, Hd, y), rc);
      tri(R, P(-Hw, Hd, y), r2, r1, rc); tri(R, P(-Hw, Hd, y), r1, P(-Hw, -Hd, y), rc);
      tri(R, P(-Hw, -Hd, y), r1, P(Hw, -Hd, y), rc); tri(R, P(Hw, Hd, y), r2, P(-Hw, Hd, y), rc);
    }
    addBox(cx, cz, h.w + 0.4, h.d + 0.4, h.ang, 'house');
  }
  const mk = (B, map, glow) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(B.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(B.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(B.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(B.c, 3));
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map, vertexColors: true, emissiveMap: glow || null, emissive: '#000000' }));
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m); return m;
  };
  return { walls: mk(W, wallTex, wallGlow), fronts: mk(F, frontTex, frontGlow), roofs: mk(R, roofTex) };
}

// ---------- pools, solar panels, chimneys and front-garden shrubs ----------
function buildHouseExtras(scene) {
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), s = new THREE.Vector3(), v = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const panels = [], chims = [], pools = [], shrubs = [];
  const homes = HOUSES.filter(h => !h.school && h.ht);
  for (const h of homes) {
    const ca = Math.cos(h.ang), sa = Math.sin(h.ang);
    const hw = h.w / 2, hd = h.d / 2, o = 0.55;
    const W2 = (u, w) => [h.x + u * ca - w * sa, h.z + u * sa + w * ca];
    // solar panels on the roof slope that faces most to the south (+z)
    if (rnd() < 0.35) {
      // the slope's outward direction in world space: local +v is (-sa, ca), local +u is (ca, sa)
      let dir, run, len;
      if (h.along) { const sgn = ca >= 0 ? 1 : -1; dir = [-sa * sgn, ca * sgn]; run = hd + o; len = Math.min(h.w * 0.6, 9); }
      else { const sgn = sa >= 0 ? 1 : -1; dir = [ca * sgn, sa * sgn]; run = hw + o; len = Math.min(h.d * 0.6, 9); }
      const px = h.x + dir[0] * run * 0.5, pz = h.z + dir[1] * run * 0.5;
      const slope = Math.atan2(h.rise, run);
      // a panel facing the slope direction: yaw so local +z points down the slope, then tilt
      panels.push({ x: px, z: pz, y: h.y0 + h.ht + h.rise * 0.5 + 0.12, ry: Math.atan2(dir[0], dir[1]), rx: slope, w: len, d: run * 0.7 });
    }
    if (rnd() < 0.3) { const [cx, cz] = W2((rnd() - 0.5) * hw, (rnd() - 0.5) * hd); chims.push({ x: cx, z: cz, y: h.y0 + h.ht + h.rise * 0.7, ry: -h.ang }); }
    // back-yard pool if there is room behind the house
    const fx = Math.sin(h.front), fz = Math.cos(h.front);
    const ext = Math.abs(hw * (ca * fx + sa * fz)) + Math.abs(hd * (-sa * fx + ca * fz));
    if (rnd() < 0.4) {
      const px = h.x - fx * (ext + 4.2), pz = h.z - fz * (ext + 4.2);
      const nr = nearestRoad(px, pz);
      const clear = terrainH(px, pz) > -0.4 && (!nr || nr.edge > 5) &&
        HOUSES.every(o2 => o2 === h || Math.hypot(o2.x - px, o2.z - pz) > Math.max(o2.w, o2.d) / 2 + 4.5);
      if (clear) pools.push({ x: px, z: pz, ry: h.front, w: 4 + rnd() * 1.5, d: 7 + rnd() * 3 });
    }
    // shrubs along the front wall
    for (let k = 0; k < 3; k++) {
      const along = ((k - 1) * 0.3 + (rnd() - 0.5) * 0.1) * Math.max(hw, hd) * 1.6;
      shrubs.push([h.x + fx * (ext + 0.9) + fz * along, h.z + fz * (ext + 0.9) - fx * along]);
    }
  }
  const pm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.08, 1), new THREE.MeshLambertMaterial({ color: '#1e2c4a', emissive: '#0a1430', emissiveIntensity: 0.4 }), panels.length);
  // tilt so the downhill (+z) edge drops: rotate about local x by +slope
  panels.forEach((p, i) => { e.set(p.rx, p.ry, 0); q.setFromEuler(e); M.compose(v.set(p.x, p.y, p.z), q, s.set(p.w, 1, p.d)); pm.setMatrixAt(i, M); });
  const cm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 2.2, 0.9), new THREE.MeshLambertMaterial({ color: '#a8735a' }), chims.length);
  chims.forEach((c, i) => { q.setFromAxisAngle(up, c.ry); M.compose(v.set(c.x, c.y, c.z), q, s.set(1, 1, 1)); cm.setMatrixAt(i, M); });
  cm.castShadow = true;
  const waterTex = canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#37b6e6'; g.fillRect(0, 0, w, h); g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 2; for (let i = 0; i < 14; i++) { g.beginPath(); const x = rnd() * w, y = rnd() * h; g.moveTo(x, y); g.bezierCurveTo(x + 10, y - 6, x + 20, y + 6, x + 30, y); g.stroke(); } });
  const wm = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: waterTex, emissive: '#0a4a6a', emissiveIntensity: 0.5 }), pools.length);
  const deck = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.12, 1), new THREE.MeshLambertMaterial({ color: '#e9e3d6' }), pools.length);
  pools.forEach((p, i) => {
    q.setFromAxisAngle(up, p.ry);
    const y = terrainH(p.x, p.z);
    M.compose(v.set(p.x, y + 0.1, p.z), q, s.set(p.w, 1, p.d)); wm.setMatrixAt(i, M);
    M.compose(v.set(p.x, y + 0.02, p.z), q, s.set(p.w + 1.6, 1, p.d + 1.6)); deck.setMatrixAt(i, M);
  });
  deck.receiveShadow = true; wm.receiveShadow = true;
  const sh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: '#fff', flatShading: true }), shrubs.length);
  const col = new THREE.Color();
  shrubs.forEach(([x, z], i) => {
    const r = 0.55 + rnd() * 0.45;
    M.compose(v.set(x, terrainH(x, z) + r * 0.6, z), q.identity(), s.set(r, r * 0.8, r)); sh.setMatrixAt(i, M);
    sh.setColorAt(i, rnd() < 0.15 ? col.setHSL(0.92 + rnd() * 0.06, 0.6, 0.6) : col.setHSL(0.27 + rnd() * 0.06, 0.4, 0.28 + rnd() * 0.08));
  });
  sh.castShadow = true;
  scene.add(pm, cm, wm, deck, sh);
  return { pools };
}

// ---------- terrain ----------
function buildTerrain(scene, groundTex) {
  const w = MAP.xmax - MAP.xmin, d = MAP.zmax - MAP.zmin;
  const nx = 300, nz = 300;
  const g = new THREE.PlaneGeometry(w, d, nx, nz);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + (MAP.xmin + MAP.xmax) / 2, z = p.getZ(i) + (MAP.zmin + MAP.zmax) / 2;
    p.setXYZ(i, x, terrainH(x, z), z);
    uv.setXY(i, (x - MAP.xmin) / w, 1 - (z - MAP.zmin) / d);
  }
  g.computeVertexNormals();
  const tm = new THREE.MeshLambertMaterial({ map: groundTex });
  // a tiled detail texture breaks up the blur of the big ground map up close
  const detail = canvasTex(256, 256, (g2, w2, h2) => {
    g2.fillStyle = '#9e9e9e'; g2.fillRect(0, 0, w2, h2);
    for (let i = 0; i < 9000; i++) { const v = 110 + rnd() * 90; g2.fillStyle = `rgba(${v},${v},${v},0.55)`; g2.fillRect(rnd() * w2, rnd() * h2, 1 + rnd() * 2.5, 1 + rnd() * 2.5); }
  }, true);
  detail.colorSpace = THREE.NoColorSpace;
  tm.onBeforeCompile = (sh) => {
    sh.uniforms.detailMap = { value: detail };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vDet;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvDet = (modelMatrix * vec4(position, 1.0)).xz * 0.42;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D detailMap; varying vec2 vDet;')
      .replace('#include <map_fragment>', '#include <map_fragment>\nvec3 dtl = texture2D(detailMap, vDet).rgb * texture2D(detailMap, vDet * 0.13).rgb;\ndiffuseColor.rgb *= 0.55 + dtl * 1.1;');
  };
  const m = new THREE.Mesh(g, tm);
  m.receiveShadow = true;
  scene.add(m);
  // the land beyond the map: a frame around it, then hills
  const outer = new THREE.MeshLambertMaterial({ color: '#8f8a62' });
  const R = 3000;
  for (const [x0, z0, x1, z1] of [[-R, -R, R, MAP.zmin], [-R, MAP.zmax, R, R], [-R, MAP.zmin, MAP.xmin, MAP.zmax], [MAP.xmax, MAP.zmin, R, MAP.zmax]]) {
    const pg = new THREE.PlaneGeometry(x1 - x0, z1 - z0); pg.rotateX(-Math.PI / 2);
    const pm = new THREE.Mesh(pg, outer); pm.position.set((x0 + x1) / 2, -0.02, (z0 + z1) / 2); pm.receiveShadow = true; scene.add(pm);
  }
  // rooftops of the neighbourhoods beyond the edge, as low blocks
  const far = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: '#d8c8aa' }), 900);
  const roofs = new THREE.InstancedMesh(new THREE.ConeGeometry(0.75, 0.5, 4), new THREE.MeshLambertMaterial({ color: '#a65a36' }), 900);
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3();
  let n = 0;
  while (n < 900) {
    const x = (rnd() - 0.5) * 1700, z = (rnd() - 0.5) * 1700;
    if (x > MAP.xmin - 25 && x < MAP.xmax + 25 && z > MAP.zmin - 25 && z < MAP.zmax + 25) continue;
    if (Math.sin(x * 0.006) + Math.cos(z * 0.007) > 0.9) continue;
    const bw = 10 + rnd() * 8, bd = 9 + rnd() * 7, bh = 3 + rnd() * 3.5, a = Math.round(rnd() * 4) * Math.PI / 2 + 0.3;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a);
    M.compose(v.set(x, bh / 2, z), q, s.set(bw, bh, bd)); far.setMatrixAt(n, M);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a + Math.PI / 4);
    M.compose(v.set(x, bh + 1.2, z), q, s.set(bw * 0.95, 4.8, bd * 0.95)); roofs.setMatrixAt(n, M);
    n++;
  }
  scene.add(far, roofs);
  // hills on the horizon (Black Mountain to the east, Torrey Pines mesa to the west)
  const hills = new THREE.Group();
  const hm = new THREE.MeshLambertMaterial({ color: '#8d8f6a', flatShading: true });
  for (let i = 0; i < 40; i++) {
    const a = i / 40 * Math.PI * 2 + rnd() * 0.1, r = 1900 + rnd() * 700;
    const hgt = 60 + rnd() * 90 + (Math.abs(a - 0.3) < 0.5 ? 200 : 0);
    const cg = new THREE.ConeGeometry(300 + rnd() * 250, hgt, 7);
    const c = new THREE.Mesh(cg, hm); c.position.set(Math.cos(a) * r, hgt / 2 - 10, Math.sin(a) * r); c.scale.z = 0.6 + rnd() * 0.6; hills.add(c);
  }
  scene.add(hills);
  return m;
}

// ---------- vegetation ----------
function buildTrees(scene) {
  const T = MAP.trees.filter(t => Object.values(SHOPS).every(sp => Math.hypot(t[0] - sp.x, t[1] - sp.z) > 16));
  const kinds = [[], [], [], []];
  for (const t of T) kinds[t[2]].push(t);
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const c = new THREE.Color();
  const make = (geo, mat, list, f) => {
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((t, i) => { f(t, i, im); });
    im.castShadow = true; im.receiveShadow = true;
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    scene.add(im); return im;
  };
  const trunkG = new THREE.CylinderGeometry(0.18, 0.28, 1, 6); trunkG.translate(0, 0.5, 0);
  const trunkM = new THREE.MeshLambertMaterial({ color: '#6b513a' });
  const leafG = new THREE.IcosahedronGeometry(1, 1);
  const leafM = new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true });
  // round shade trees
  const round = kinds[0];
  make(trunkG, trunkM, round, (t, i, im) => {
    const h = 2.2 + rnd() * 1.6; const y = terrainH(t[0], t[1]);
    M.compose(v.set(t[0], y, t[1]), q.identity(), s.set(1, h, 1)); im.setMatrixAt(i, M); t.h = h; t.y = y;
    addCircle(t[0], t[1], 0.45, 'tree');
  });
  const blobs = [];
  for (const t of round) {
    const r = 1.8 + rnd() * 1.4, hue = 0.22 + rnd() * 0.09, sat = 0.32 + rnd() * 0.2, lit = 0.24 + rnd() * 0.1;
    blobs.push({ x: t[0], y: t.y + t.h + r * 0.55, z: t[1], r, hue, sat, lit });
    for (let k = 0; k < 3; k++) {
      const a = rnd() * 6.28, d = r * 0.55;
      blobs.push({ x: t[0] + Math.cos(a) * d, y: t.y + t.h + r * (0.2 + rnd() * 0.6), z: t[1] + Math.sin(a) * d, r: r * (0.55 + rnd() * 0.2), hue, sat, lit: lit + (rnd() - 0.4) * 0.08 });
    }
  }
  make(leafG, leafM, blobs, (b, i, im) => {
    M.compose(v.set(b.x, b.y, b.z), q.setFromAxisAngle(up, rnd() * 6), s.set(b.r, b.r * 0.85, b.r)); im.setMatrixAt(i, M);
    im.setColorAt(i, c.setHSL(b.hue, b.sat, b.lit));
  });
  // palms
  const palms = kinds[1];
  const ptrunk = new THREE.CylinderGeometry(0.16, 0.24, 1, 6); ptrunk.translate(0, 0.5, 0);
  make(ptrunk, new THREE.MeshLambertMaterial({ color: '#8a7358' }), palms, (t, i, im) => {
    const h = 7 + rnd() * 6; const y = terrainH(t[0], t[1]);
    M.compose(v.set(t[0], y, t[1]), q.identity(), s.set(1, h, 1)); im.setMatrixAt(i, M); t.h = h; t.y = y;
    addCircle(t[0], t[1], 0.35, 'tree');
  });
  const frond = new THREE.BufferGeometry();
  {
    const pts = [];
    for (let k = 0; k < 9; k++) {
      const a = k / 9 * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const tip = [ca * 3.4, -1.3, sa * 3.4], mid = [ca * 1.8, 0.35, sa * 1.8];
      const side = [-sa * 0.55, 0, ca * 0.55];
      pts.push(0, 0, 0, mid[0] + side[0], mid[1], mid[2] + side[2], tip[0], tip[1], tip[2]);
      pts.push(0, 0, 0, tip[0], tip[1], tip[2], mid[0] - side[0], mid[1], mid[2] - side[2]);
    }
    frond.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); frond.computeVertexNormals();
  }
  make(frond, new THREE.MeshLambertMaterial({ color: '#ffffff', side: THREE.DoubleSide }), palms, (t, i, im) => {
    M.compose(v.set(t[0], t.y + t.h, t[1]), q.setFromAxisAngle(up, rnd() * 6), s.set(1, 1, 1)); im.setMatrixAt(i, M);
    im.setColorAt(i, c.setHSL(0.22 + rnd() * 0.05, 0.4, 0.3 + rnd() * 0.08));
  });
  // pines / cypress on Carmel Mountain Rd
  const pines = kinds[2];
  const coneG = new THREE.ConeGeometry(1, 1, 7); coneG.translate(0, 0.5, 0);
  make(coneG, leafM, pines, (t, i, im) => {
    const h = 6 + rnd() * 4, r = 0.9 + rnd() * 0.5, y = terrainH(t[0], t[1]);
    M.compose(v.set(t[0], y + 0.5, t[1]), q.identity(), s.set(r, h, r)); im.setMatrixAt(i, M);
    im.setColorAt(i, c.setHSL(0.3 + rnd() * 0.05, 0.35, 0.2 + rnd() * 0.06));
    addCircle(t[0], t[1], 0.5, 'tree');
  });
  // chaparral bushes
  const bush = kinds[3];
  const bm = make(new THREE.IcosahedronGeometry(1, 0), leafM, bush, (t, i, im) => {
    const r = 0.9 + rnd() * 1.6, y = terrainH(t[0], t[1]);
    M.compose(v.set(t[0], y + r * 0.35, t[1]), q.setFromAxisAngle(up, rnd() * 6), s.set(r * (1 + rnd() * 0.5), r * 0.7, r)); im.setMatrixAt(i, M);
    im.setColorAt(i, c.setHSL(0.13 + rnd() * 0.12, 0.25 + rnd() * 0.15, 0.26 + rnd() * 0.12));
  });
  bm.castShadow = false;
}

// ---------- street furniture ----------
const signCache = new Map();
function nameSignTex(name) {
  if (signCache.has(name)) return signCache.get(name);
  const t = canvasTex(512, 96, (g, w, h) => {
    g.fillStyle = '#1d6b3b'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#fff'; g.lineWidth = 5; g.strokeRect(6, 6, w - 12, h - 12);
    g.fillStyle = '#fff'; g.font = 'bold 54px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    let fs = 54; while (g.measureText(name).width > w - 40 && fs > 20) { fs -= 2; g.font = `bold ${fs}px Arial, sans-serif`; }
    g.fillText(name, w / 2, h / 2 + 2);
  });
  signCache.set(name, t); return t;
}
function plateTex(draw, w = 128, h = 160) { return canvasTex(w, h, draw); }
const stopTex = canvasTex(128, 128, (g) => {
  g.translate(64, 64); g.fillStyle = '#fff'; g.beginPath();
  for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + i * Math.PI / 4; g.lineTo(Math.cos(a) * 63, Math.sin(a) * 63); } g.fill();
  g.fillStyle = '#c8102e'; g.beginPath();
  for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + i * Math.PI / 4; g.lineTo(Math.cos(a) * 57, Math.sin(a) * 57); } g.fill();
  g.fillStyle = '#fff'; g.font = 'bold 36px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('STOP', 0, 2);
});
const limitTex = n => plateTex((g, w, h) => {
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.strokeStyle = '#111'; g.lineWidth = 6; g.strokeRect(8, 8, w - 16, h - 16);
  g.fillStyle = '#111'; g.textAlign = 'center'; g.font = 'bold 22px Arial'; g.fillText('SPEED', w / 2, 42); g.fillText('LIMIT', w / 2, 66);
  g.font = 'bold 62px Arial'; g.fillText(String(n), w / 2, 128);
});
const schoolTex = plateTex((g, w, h) => {
  g.fillStyle = '#d4e800'; g.beginPath(); g.moveTo(w / 2, 4); g.lineTo(w - 4, h * 0.42); g.lineTo(w - 4, h - 4); g.lineTo(4, h - 4); g.lineTo(4, h * 0.42); g.closePath(); g.fill();
  g.strokeStyle = '#111'; g.lineWidth = 4; g.stroke();
  g.fillStyle = '#111';
  const kid = (x, s) => { g.beginPath(); g.arc(x, 62, 9 * s, 0, 7); g.fill(); g.fillRect(x - 7 * s, 72, 14 * s, 34 * s); g.fillRect(x - 7 * s, 104, 5 * s, 26 * s); g.fillRect(x + 2 * s, 104, 5 * s, 26 * s); };
  kid(48, 1); kid(82, 0.85);
  g.font = 'bold 16px Arial'; g.textAlign = 'center'; g.fillText('SCHOOL', w / 2, 150);
});

function buildFurniture(scene) {
  const out = { lampHeads: null, signals: [] };
  const poleG = new THREE.CylinderGeometry(0.05, 0.05, 1, 6); poleG.translate(0, 0.5, 0);
  const poleM = new THREE.MeshLambertMaterial({ color: '#9aa1a6' });
  const add = (o) => { scene.add(o); return o; };
  const signPost = (x, z, ang, tex, w, h, y = 2.2) => {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(poleG, poleM); pole.scale.y = y + h / 2; g.add(pole);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide }));
    plate.position.y = y; plate.position.z = 0.06; g.add(plate);
    g.position.set(x, terrainH(x, z), z); g.rotation.y = ang;
    addCircle(x, z, 0.15, 'sign');
    return add(g);
  };
  // stop signs facing the drivers that must stop
  for (const s of MAP.stops) signPost(s[0], s[1], s[2] + Math.PI, stopTex, 0.75, 0.75, 2.1);
  // street name signs at junctions
  NODES.forEach((n, i) => {
    if (ADJ[i].length < 3) return;
    const names = [...new Set(ADJ[i].map(ei => ROADS[EDGES[ei].r].name).filter(Boolean))];
    if (names.length < 2) return;
    // a corner: offset from the junction between two of its edges
    const e0 = EDGES[ADJ[i][0]], e1 = EDGES[ADJ[i][1]];
    const dir = (e) => { const p = e.a === i ? e.pts[1] : e.pts[e.pts.length - 2]; const dx = p[0] - n[0], dz = p[1] - n[1], L = Math.hypot(dx, dz); return [dx / L, dz / L]; };
    let [ax, az] = dir(e0), [bx, bz] = dir(e1);
    let cx = ax + bx, cz = az + bz; const L = Math.hypot(cx, cz) || 1; cx /= L; cz /= L;
    const wmax = Math.max(...ADJ[i].map(ei => ROADS[EDGES[ei].r].w));
    const px = n[0] + cx * (wmax / 2 + 4.5), pz = n[1] + cz * (wmax / 2 + 4.5);
    const g = new THREE.Group();
    const pole = new THREE.Mesh(poleG, poleM); pole.scale.y = 3.3; g.add(pole);
    names.slice(0, 2).forEach((nm, k) => {
      const e = EDGES[ADJ[i].find(ei => ROADS[EDGES[ei].r].name === nm)];
      const [dx, dz] = dir(e);
      // two single-sided plates back to back so the name reads correctly from both sides
      for (const flip of [0, Math.PI]) {
        const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.36), new THREE.MeshLambertMaterial({ map: nameSignTex(nm) }));
        plate.position.y = 3.0 + k * 0.4; plate.rotation.y = Math.atan2(dx, dz) + Math.PI / 2 + flip;
        g.add(plate);
      }
    });
    g.position.set(px, terrainH(px, pz), pz);
    addCircle(px, pz, 0.15, 'sign');
    add(g);
  });
  // speed limit signs a little way into every named road
  const limited = new Set();
  EDGES.forEach((e, ei) => {
    const r = ROADS[e.r];
    if (!r.name || r.name === 'Sage Canyon School' || e.len < 60) return;
    const key = r.name + (ei % 3);
    if (limited.has(key)) return; limited.add(key);
    const a = e.pts[0], b = e.pts[1];
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
    const t = Math.min(30, L * 0.6);
    const x = a[0] + dx / L * t + (-dz / L) * (r.w / 2 + 1.3), z = a[1] + dz / L * t + (dx / L) * (r.w / 2 + 1.3);
    signPost(x, z, Math.atan2(-dx, -dz), limitTex(r.name === 'Carmel Mountain Rd' ? 40 : 25), 0.6, 0.75);
  });
  // school zone signs on Harvest Run Dr either side of the school
  for (const [x, z, a] of [[-215, 112, 2.0], [40, 204, -1.15], [-310, 60, 2.4]]) signPost(x, z, a, schoolTex, 0.75, 0.92);
  // street lights: tall poles every ~45 m, alternating sides
  const lampPts = [];
  ROADS.forEach((r) => {
    if (r.name === 'Sage Canyon School') return;
    let acc = 20, side = 1;
    for (let k = 0; k < r.pts.length - 1; k++) {
      const a = r.pts[k], b = r.pts[k + 1]; const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
      while (acc < L) {
        const t = acc / L, off = (r.w / 2 + 1.0) * side;
        const x = a[0] + dx * t - dz / L * off, z = a[1] + dz * t + dx / L * off;
        const nr = nearestRoad(x, z);
        if (nr && nr.edge > 0.4) lampPts.push([x, z, Math.atan2(dz / L * side, -dx / L * side), r.name === 'Carmel Mountain Rd' ? 9 : 7]);
        acc += r.name === 'Carmel Mountain Rd' ? 40 : 48; side = -side;
      }
      acc -= L;
    }
  });
  const lp = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.13, 1, 6).translate(0, 0.5, 0), new THREE.MeshLambertMaterial({ color: '#7d8287' }), lampPts.length);
  const arm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 0.08, 1.6).translate(0, 0, 0.8), new THREE.MeshLambertMaterial({ color: '#7d8287' }), lampPts.length);
  const headM = new THREE.MeshBasicMaterial({ color: '#d6d6c8' });
  const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.35, 0.12, 0.6), headM, lampPts.length);
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), v = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  lampPts.forEach(([x, z, a, h], i) => {
    const y = terrainH(x, z);
    M.compose(v.set(x, y, z), q.identity(), sv.set(1, h, 1)); lp.setMatrixAt(i, M);
    q.setFromAxisAngle(up, a);
    M.compose(v.set(x, y + h, z), q, sv.set(1, 1, 1)); arm.setMatrixAt(i, M);
    const hx = x + Math.sin(a) * 1.5, hz = z + Math.cos(a) * 1.5;
    M.compose(v.set(hx, y + h - 0.05, hz), q, sv.set(1, 1, 1)); heads.setMatrixAt(i, M);
    addCircle(x, z, 0.18, 'pole');
  });
  lp.castShadow = true; add(lp); add(arm); add(heads);
  out.lampHeads = headM; out.lampPts = lampPts;
  // pools of light under the lamps at night
  const poolTex = canvasTex(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 2, 32, 32, 32); gr.addColorStop(0, 'rgba(255,220,160,0.9)'); gr.addColorStop(1, 'rgba(255,220,160,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); });
  const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(14, 14).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }), lampPts.length);
  lampPts.forEach(([x, z, a], i) => { const hx = x + Math.sin(a) * 1.5, hz = z + Math.cos(a) * 1.5; M.compose(v.set(hx, terrainH(hx, hz) + 0.06, hz), q.identity(), sv.set(1, 1, 1)); pools.setMatrixAt(i, M); });
  pools.renderOrder = 2; add(pools); out.pools = pools;
  // traffic signals at the two Carmel Mountain Rd junctions
  for (const n of MAP.signals) {
    const [nx, nz] = NODES[n];
    const heads_ = [];
    for (const ei of ADJ[n]) {
      const e = EDGES[ei], r = ROADS[e.r];
      const p = e.a === n ? e.pts[1] : e.pts[e.pts.length - 2];
      let dx = p[0] - nx, dz = p[1] - nz; const L = Math.hypot(dx, dz); dx /= L; dz /= L;
      // pole on the right-hand kerb of the approach, arm over the lanes
      const wmax = Math.max(...ADJ[n].map(f => ROADS[EDGES[f].r].w));
      const back = wmax / 2 + 3;
      // the pole stands on the right-hand kerb of a car arriving along this edge (heading -dx,-dz; its right is dz,-dx)
      const px = nx + dx * back + dz * (r.w / 2 + 1.2), pz = nz + dz * back - dx * (r.w / 2 + 1.2);
      const g = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 6, 8).translate(0, 3, 0), poleM); g.add(pole);
      const armLen = r.w / 2 + 0.5;
      const armM = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, armLen).translate(0, 0, armLen / 2), poleM); armM.position.y = 5.8; g.add(armM);
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.1, 0.3), new THREE.MeshLambertMaterial({ color: '#2b2b20' }));
      box.position.set(0, 5.3, armLen - 0.8); g.add(box);
      const lamps = ['#ff2a1a', '#ffb000', '#20e070'].map((c, k) => {
        const m = new THREE.Mesh(new THREE.CircleGeometry(0.12, 12), new THREE.MeshBasicMaterial({ color: '#222' }));
        m.position.set(0, 5.62 - k * 0.32, armLen - 0.8 + 0.16); m.userData.on = new THREE.Color(c); g.add(m); return m;
      });
      g.position.set(px, terrainH(px, pz), pz);
      // arm points across the road (toward the left of the arriving car), lamps face the arriving car
      g.lookAt(px + dx, terrainH(px, pz), pz + dz);
      // after lookAt, +Z faces the approach; rotate the arm to point toward the road centre
      armM.rotation.y = -Math.PI / 2; box.position.set(-(armLen - 0.8), 5.3, 0); lamps.forEach((m, k) => m.position.set(-(armLen - 0.8), 5.62 - k * 0.32, 0.16));
      addCircle(px, pz, 0.25, 'pole');
      add(g);
      heads_.push({ ei, road: r.name, lamps, axis: Math.abs(dx) > Math.abs(dz) ? 'x' : 'z', dir: [dx, dz] });
    }
    out.signals.push({ node: n, heads: heads_ });
  }
  // road-closed barricades where streets run off the map
  const barTex = canvasTex(256, 64, (g, w, h) => {
    for (let x = -64; x < w + 64; x += 32) { g.fillStyle = (x / 32) % 2 ? '#fff' : '#e8541e'; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 32, 0); g.lineTo(x + 32 - 24, h); g.lineTo(x - 24, h); g.fill(); }
  });
  const closedTex = canvasTex(256, 96, (g, w, h) => { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.strokeStyle = '#111'; g.lineWidth = 6; g.strokeRect(4, 4, w - 8, h - 8); g.fillStyle = '#111'; g.font = 'bold 44px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('ROAD CLOSED', w / 2, h / 2 + 2); });
  for (const n of MAP.ends) {
    const e = EDGES[ADJ[n][0]], r = ROADS[e.r];
    const p = e.a === n ? e.pts[1] : e.pts[e.pts.length - 2];
    let dx = p[0] - NODES[n][0], dz = p[1] - NODES[n][1]; const L = Math.hypot(dx, dz); dx /= L; dz /= L;
    const bx = NODES[n][0] + dx * 9, bz = NODES[n][1] + dz * 9;
    const g = new THREE.Group();
    const board = new THREE.Mesh(new THREE.BoxGeometry(r.w + 3, 0.5, 0.12), [poleM, poleM, poleM, poleM, new THREE.MeshLambertMaterial({ map: barTex }), new THREE.MeshLambertMaterial({ map: barTex })]);
    board.position.y = 1.1; g.add(board);
    const b2 = board.clone(); b2.position.y = 0.45; g.add(b2);
    for (const s of [-1, 1]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.4, 0.5), poleM); leg.position.set(s * (r.w / 2 + 1), 0.7, 0); g.add(leg); }
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.9), new THREE.MeshLambertMaterial({ map: closedTex, side: THREE.DoubleSide })); sign.position.y = 1.95; g.add(sign);
    g.position.set(bx, terrainH(bx, bz), bz); g.rotation.y = Math.atan2(dx, dz);
    for (let s = -r.w / 2 - 1; s <= r.w / 2 + 1; s += 1.2) addCircle(bx + dz * s, bz - dx * s, 0.7, 'barrier');
    add(g);
  }
  // mailboxes at the driveways, and parked cars on some of them
  const boxes = HOUSES.filter(h => h.drive && h.num);
  const mbPost = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 1.05, 0.1).translate(0, 0.52, 0), new THREE.MeshLambertMaterial({ color: '#f2efe8' }), boxes.length);
  const mbBox = new THREE.InstancedMesh(new THREE.BoxGeometry(0.28, 0.3, 0.5), new THREE.MeshLambertMaterial({ color: '#2a2d31' }), boxes.length);
  boxes.forEach((h, i) => {
    const fx = Math.sin(h.front), fz = Math.cos(h.front);
    const x = h.drive[0] - fx * 1.2 + fz * 2.4, z = h.drive[1] - fz * 1.2 - fx * 2.4;
    const y = terrainH(x, z);
    q.setFromAxisAngle(up, h.front);
    M.compose(v.set(x, y, z), q, sv.set(1, 1, 1)); mbPost.setMatrixAt(i, M);
    M.compose(v.set(x, y + 1.15, z), q, sv.set(1, 1, 1)); mbBox.setMatrixAt(i, M);
    h.mailbox = [x, z];
  });
  add(mbPost); add(mbBox);
  return out;
}

// ---------- parked cars (simple shapes) ----------
function buildParked(scene) {
  const list = HOUSES.filter(h => h.drive && h.num && rnd() < 0.42);
  const KINDS = ['sedan', 'suv', 'minivan'];
  const COLS = ['#f4f4f4', '#1a1a1a', '#8d949a', '#2c4a7a', '#7a1c1c', '#c9c9c9', '#3a5a40', '#d9d2c3', '#5b6f8a'];
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
  const cars = list.map(h => ({ h, kind: pick(KINDS), color: pick(COLS) }));
  const meshes = {};
  for (const k of KINDS) {
    const n = cars.filter(c => c.kind === k).length;
    const g = mergedVehicle(k);
    const paint = new THREE.InstancedMesh(g.paint, new THREE.MeshLambertMaterial({ color: '#fff', vertexColors: true }), Math.max(1, n));
    const fixed = new THREE.InstancedMesh(g.fixed, new THREE.MeshLambertMaterial({ vertexColors: true }), Math.max(1, n));
    paint.count = fixed.count = n;
    paint.castShadow = fixed.castShadow = true;
    scene.add(paint, fixed);
    meshes[k] = { paint, fixed, i: 0 };
  }
  const out = [];
  for (const car of cars) {
    const h = car.h, fx = Math.sin(h.front), fz = Math.cos(h.front);
    const x = h.drive[0] - fx * 4.2, z = h.drive[1] - fz * 4.2;   // halfway up the driveway
    const y = terrainH(x, z);
    const heading = h.front;   // backed in, nose to the street
    const m = meshes[car.kind], idx = m.i++;
    q.setFromAxisAngle(up, heading);
    M.compose(v.set(x, y, z), q, s); m.paint.setMatrixAt(idx, M); m.fixed.setMatrixAt(idx, M);
    m.paint.setColorAt(idx, c.set(car.color));
    const col = addBox(x, z, 1.95, 4.8, -heading, 'parked');
    const entry = {
      x, z, h: heading, kind: car.kind, color: car.color, col, hidden: false,
      hide() { M.makeScale(0, 0, 0); m.paint.setMatrixAt(idx, M); m.fixed.setMatrixAt(idx, M); m.paint.instanceMatrix.needsUpdate = m.fixed.instanceMatrix.needsUpdate = true; col.off = true; entry.hidden = true; },
      show() { q.setFromAxisAngle(up, heading); M.compose(v.set(x, y, z), q, s.set(1, 1, 1)); m.paint.setMatrixAt(idx, M); m.fixed.setMatrixAt(idx, M); m.paint.instanceMatrix.needsUpdate = m.fixed.instanceMatrix.needsUpdate = true; col.off = false; entry.hidden = false; },
    };
    out.push(entry);
  }
  for (const k of KINDS) if (meshes[k].paint.instanceColor) meshes[k].paint.instanceColor.needsUpdate = true;
  return out;
}

// ---------- Sage Canyon School and the park ----------
function buildSchool(scene) {
  const g = new THREE.Group();
  const [sx, sz] = MAP.school;
  // sign by the drop-off
  const signTex = canvasTex(512, 160, (c, w, h) => {
    c.fillStyle = '#6b4a2b'; c.fillRect(0, 0, w, h); c.fillStyle = '#f3ead6'; c.fillRect(10, 10, w - 20, h - 20);
    c.fillStyle = '#2d5a3a'; c.font = 'bold 50px Georgia, serif'; c.textAlign = 'center'; c.fillText('Sage Canyon', w / 2, 70);
    c.font = 'bold 34px Georgia, serif'; c.fillText('SCHOOL', w / 2, 120);
  });
  const sign = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.0, 0.25), [0, 0, 0, 0, 1, 1].map(() => new THREE.MeshLambertMaterial({ map: signTex })));
  const px = -92, pz = 92;
  sign.position.set(px, 0.9, pz); sign.rotation.y = 0.2; g.add(sign); addBox(px, pz, 3.2, 0.4, -0.2, 'sign');
  // flagpole with the US flag
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 9, 8).translate(0, 4.5, 0), new THREE.MeshLambertMaterial({ color: '#ddd' }));
  pole.position.set(-82, 0, 70); g.add(pole); addCircle(-82, 70, 0.2, 'pole');
  const flagTex = canvasTex(190, 100, (c, w, h) => {
    for (let i = 0; i < 13; i++) { c.fillStyle = i % 2 ? '#fff' : '#b22234'; c.fillRect(0, i * h / 13, w, h / 13 + 1); }
    c.fillStyle = '#3c3b6e'; c.fillRect(0, 0, w * 0.4, h * 7 / 13);
    c.fillStyle = '#fff'; for (let y = 0; y < 5; y++) for (let x = 0; x < 6; x++) c.fillRect(6 + x * 12, 5 + y * 10, 3, 3);
  });
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.0, 8, 1), new THREE.MeshLambertMaterial({ map: flagTex, side: THREE.DoubleSide }));
  flag.position.set(-82 + 0.95, 8.3, 70); g.add(flag);
  // playground structures (blue, from the satellite view) and a lunch shelter
  const blue = new THREE.MeshLambertMaterial({ color: '#2f7fd0' }), yellow = new THREE.MeshLambertMaterial({ color: '#f2c230' }), red = new THREE.MeshLambertMaterial({ color: '#d84a3a' });
  const playground = (x, z, s = 1) => {
    const p = new THREE.Group();
    const deck = new THREE.Mesh(new THREE.BoxGeometry(3, 0.2, 3), blue); deck.position.y = 1.6; p.add(deck);
    for (const [a, b] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.2), yellow); post.position.set(a, 1.6, b); p.add(post); }
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.4, 1.2, 4), blue); roof.position.y = 3.8; roof.rotation.y = Math.PI / 4; p.add(roof);
    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.1, 3.6), red); slide.position.set(0, 0.85, 3.0); slide.rotation.x = 0.48; p.add(slide);
    p.position.set(x, terrainH(x, z), z); p.scale.setScalar(s); g.add(p);
    addCircle(x, z, 2.4 * s, 'play');
  };
  playground(-123, 8); playground(-26, -12, 1.2);
  const shelter = new THREE.Mesh(new THREE.BoxGeometry(14, 0.3, 6), new THREE.MeshLambertMaterial({ color: '#e4e4e4' })); shelter.position.set(-40, 3.2, 12); shelter.rotation.y = 1.35; g.add(shelter);
  // the field north of the school (green on the satellite view) gets goals
  scene.add(g);
  return { flag };
}
function buildPark(scene) {
  const [px, pz] = MAP.park;
  const g = new THREE.Group();
  const white = new THREE.MeshLambertMaterial({ color: '#f5f5f5' });
  for (const s of [-1, 1]) {
    const goal = new THREE.Group();
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 7.3), white); bar.position.y = 2.4; goal.add(bar);
    for (const t of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.4, 0.12), white); p.position.set(0, 1.2, t * 3.6); goal.add(p); addCircle(px + s * 47, pz + t * 3.6, 0.15, 'goal'); }
    goal.position.set(px + s * 47, terrainH(px + s * 47, pz), pz); g.add(goal);
  }
  // restrooms
  const rr = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 4), new THREE.MeshLambertMaterial({ color: '#c9b08c' }));
  const rx = px - 25, rz = pz + 50; rr.position.set(rx, 1.5, rz); rr.castShadow = true; g.add(rr); addBox(rx, rz, 6, 4, 0, 'building');
  const rroof = new THREE.Mesh(new THREE.ConeGeometry(4.6, 1.4, 4), new THREE.MeshLambertMaterial({ color: '#7d5a3c' })); rroof.position.set(rx, 3.7, rz); rroof.rotation.y = Math.PI / 4; rroof.scale.z = 0.7; g.add(rroof);
  // benches
  for (let i = 0; i < 6; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.45, 0.5), new THREE.MeshLambertMaterial({ color: '#7b5532' }));
    const bx = px - 60 + i * 22, bz = pz + 40;
    b.position.set(bx, 0.45, bz); g.add(b);
  }
  scene.add(g);
}

// ---------- sky ----------
export function buildSky(scene) {
  const geo = new THREE.SphereGeometry(4000, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color('#4a8fd8') }, bottom: { value: new THREE.Color('#cfe3f1') }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color('#fff3d0') } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunCol; varying vec3 vP;
      void main(){ float h = clamp(vP.y*1.6+0.05,0.0,1.0); vec3 c = mix(bottom, top, pow(h,0.7));
        float s = max(dot(normalize(vP), normalize(sunDir)), 0.0); c += sunCol * (pow(s, 600.0)*2.0 + pow(s, 8.0)*0.25);
        gl_FragColor = vec4(c,1.0); }`,
  });
  const sky = new THREE.Mesh(geo, mat); sky.renderOrder = -1; scene.add(sky);
  // a few clouds
  const ct = canvasTex(256, 128, (g, w, h) => { for (let i = 0; i < 26; i++) { const x = 40 + rnd() * 176, y = 50 + rnd() * 40, r = 18 + rnd() * 30; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,0.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); } });
  const clouds = new THREE.Group();
  const cm = new THREE.MeshBasicMaterial({ map: ct, transparent: true, depthWrite: false, fog: false });
  for (let i = 0; i < 24; i++) {
    const c = new THREE.Mesh(new THREE.PlaneGeometry(500, 250), cm);
    const a = rnd() * 6.28, r = 900 + rnd() * 1800;
    c.position.set(Math.cos(a) * r, 320 + rnd() * 250, Math.sin(a) * r); c.lookAt(0, 0, 0); clouds.add(c);
  }
  scene.add(clouds);
  return { sky, mat, clouds, cloudMat: cm };
}

export function buildWorld(scene, groundTex) {
  const terrain = buildTerrain(scene, groundTex);
  const houses = buildHouses(scene);
  buildHouseExtras(scene);
  const roads = buildRoads(scene);
  buildTrees(scene);
  const furn = buildFurniture(scene);
  const parked = buildParked(scene);
  const school = buildSchool(scene);
  buildPark(scene);
  return { terrain, houses, furn, parked, school, roads };
}
