// The neighbourhood: terrain from the traced map, houses from the map's footprints, trees, signs and the school.
import * as THREE from '../lib/three.module.min.js';
import { MAP } from './mapdata.js';
import { ROADS, NODES, EDGES, ADJ, terrainH, nearestRoad, HOUSES, clamp, SHOPS } from './roads.js';
import { buildRoads } from './roadmesh.js';
import { mergedVehicle } from './car.js';
import { leafTex, frondTex, barkTex, crownGeometry, palmGeometry, foliageMaterial, foliageDepth } from './gfx.js';

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
function stucco(g, w, h) {
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < w * h / 18; i++) { const v = rnd(); g.fillStyle = v > 0.5 ? `rgba(255,255,255,${(v - 0.5) * 0.5})` : `rgba(90,80,60,${(0.5 - v) * 0.16})`; g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2); }
}
// a window with trim, sill, mullions and a sky reflection
function windowAt(g, x, y, w, h, shutters) {
  g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x - 7, y - 5, w + 14, h + 14);
  g.fillStyle = '#f7f4ee'; g.fillRect(x - 8, y - 8, w + 16, h + 16);
  const gr = g.createLinearGradient(x, y, x + w * 0.4, y + h);
  gr.addColorStop(0, '#b9d4ea'); gr.addColorStop(0.45, '#5f7d96'); gr.addColorStop(1, '#2c3e50');
  g.fillStyle = gr; g.fillRect(x, y, w, h);
  g.fillStyle = 'rgba(255,255,255,0.22)'; g.beginPath(); g.moveTo(x + w * 0.15, y); g.lineTo(x + w * 0.45, y); g.lineTo(x, y + h * 0.55); g.lineTo(x, y + h * 0.25); g.fill();
  g.fillStyle = '#f7f4ee'; g.fillRect(x + w / 2 - 2, y, 4, h); g.fillRect(x, y + h / 2 - 2, w, 4);
  g.fillStyle = '#e9e3d6'; g.fillRect(x - 12, y + h + 6, w + 24, 8);   // sill
  g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(x - 12, y + h + 14, w + 24, 4);
  if (shutters) { g.fillStyle = shutters; for (const sx of [x - 34, x + w + 12]) { g.fillRect(sx, y - 6, 22, h + 12); g.fillStyle = 'rgba(0,0,0,0.25)'; for (let k = 0; k < h; k += 8) g.fillRect(sx + 2, y + k, 18, 2); g.fillStyle = shutters; } }
}
const wallTex = canvasTex(256, 192, (g, w, h) => { stucco(g, w, h); windowAt(g, 84, 46, 88, 84); }, true);
const entryTex = canvasTex(512, 384, (g, w, h) => {
  stucco(g, w, h);
  for (const x of [70, 214, 360]) windowAt(g, x, 46, 84, 84);              // upper floor
  windowAt(g, 70, 238, 92, 92); windowAt(g, 352, 238, 92, 92);             // ground floor
  // front door under an arch
  g.fillStyle = '#efe8da'; g.beginPath(); g.moveTo(206, 384); g.lineTo(206, 250); g.arc(256, 250, 50, Math.PI, 0); g.lineTo(306, 384); g.fill();
  g.fillStyle = '#6b3f22'; g.beginPath(); g.moveTo(218, 384); g.lineTo(218, 254); g.arc(256, 254, 38, Math.PI, 0); g.lineTo(294, 384); g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 3; for (const yy of [290, 340]) g.strokeRect(226, yy, 60, 40);
  g.fillStyle = '#e0b85a'; g.beginPath(); g.arc(282, 330, 4, 0, 7); g.fill();
  g.fillStyle = '#2b2b2b'; g.fillRect(186, 250, 8, 14); g.fillRect(318, 250, 8, 14);   // lamps
});
const garageTex = canvasTex(256, 192, (g, w, h) => {
  stucco(g, w, h);
  g.fillStyle = '#e9e3d6'; g.fillRect(18, 40, 220, 152);
  g.fillStyle = '#f5f2ea'; g.fillRect(26, 48, 204, 144);
  for (let y = 50; y < 192; y += 28) { g.fillStyle = '#e7e2d6'; g.fillRect(30, y, 196, 24); g.strokeStyle = 'rgba(0,0,0,0.16)'; g.lineWidth = 2; g.strokeRect(30, y, 196, 24); }
  for (let x = 40; x < 220; x += 37) { g.fillStyle = '#5f7d96'; g.fillRect(x, 54, 26, 14); }
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(18, 186, 220, 6);
});
const trimTex = canvasTex(64, 64, (g, w, h) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(0,0,0,${rnd() * 0.06})`; g.fillRect(rnd() * w, rnd() * h, 2, 2); } }, true);
// lit windows for night
const wallGlow = canvasTex(256, 192, (g, w, h) => { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); g.fillStyle = '#ffd48a'; g.fillRect(84, 46, 88, 84); g.fillStyle = '#000'; g.fillRect(126, 46, 4, 84); g.fillRect(84, 86, 88, 4); }, true);
const entryGlow = canvasTex(512, 384, (g, w, h) => {
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h); g.fillStyle = '#ffd48a';
  for (const x of [70, 360]) g.fillRect(x, 46, 84, 84);
  g.fillStyle = '#6a4a28'; g.fillRect(214, 46, 84, 84);
  g.fillStyle = '#ffd48a'; g.fillRect(70, 238, 92, 92); g.fillRect(352, 238, 92, 92);
  g.fillStyle = '#ffe6a0'; g.fillRect(184, 248, 12, 18); g.fillRect(316, 248, 12, 18);
});
const garageGlow = canvasTex(256, 192, (g, w, h) => { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); });
// Spanish barrel tiles
const roofTex = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#c9c9c9'; g.fillRect(0, 0, w, h);
  const rows = 8, cols = 8, rh = h / rows, cw = w / cols;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = c * cw, y = r * rh;
    const gr = g.createLinearGradient(x, 0, x + cw, 0);
    const v = 0.85 + rnd() * 0.3;
    gr.addColorStop(0, `rgba(60,60,60,${0.5})`); gr.addColorStop(0.35, `rgba(255,255,255,${0.35 * v})`); gr.addColorStop(0.6, `rgba(255,255,255,${0.15 * v})`); gr.addColorStop(1, 'rgba(40,40,40,0.55)');
    g.fillStyle = `rgb(${215 * v | 0},${215 * v | 0},${215 * v | 0})`; g.fillRect(x + 1, y, cw - 2, rh);
    g.fillStyle = gr; g.fillRect(x + 1, y, cw - 2, rh);
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x, y + rh - 4, cw, 4);
  }
}, true);

const WALLS = ['#efe3cc', '#e8d6b8', '#f3ece0', '#dcc8a8', '#e9dccb', '#f5efe6', '#d8c4a4', '#e4d2bf', '#cfc4b3', '#ead2b6', '#f2e6d0', '#d9cbb5'];
const ROOFC = ['#b9603a', '#a8522f', '#c46d42', '#9e5b38', '#8f5d48', '#b4704a', '#7d6e66', '#a06446'];

function buildHouses(scene) {
  const mkB = () => ({ p: [], uv: [], c: [], n: [] });
  const W = mkB(), E = mkB(), Gd = mkB(), R = mkB(), Tr = mkB();
  const col = new THREE.Color();
  const push = (B, v, uv, c, n) => { B.p.push(v[0], v[1], v[2]); B.uv.push(uv[0], uv[1]); B.c.push(c.r, c.g, c.b); B.n.push(n[0], n[1], n[2]); };
  // a wall quad a-b (bottom) c-d (top), darker at the foot for a little ambient occlusion
  const wallQuad = (B, a, b, c, d, uvs, color, nrm) => {
    const dark = color.clone().multiplyScalar(0.62);
    const cs = [dark, dark, color, color];
    for (const k of [0, 2, 1, 0, 3, 2]) push(B, [a, b, c, d][k], uvs[k], cs[k], nrm);   // wound to face outward
  };
  const tri = (B, a, b, c, color, e) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const L = Math.hypot(nx, ny, nz); nx /= L; ny /= L; nz /= L;
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
    // tiles run along the eave (e) and up the slope
    const ex = e ? e[0] : 1, ez = e ? e[1] : 0;
    for (const v of [a, b, c]) push(B, v, [(v[0] * ex + v[2] * ez) * 0.9, v[1] * 1.7], color, [nx, ny, nz]);
  };
  // hip roof over a rectangle given a local→world mapping P(u, v, y)
  const hipRoof = (P, hw, hd, y, rise, rc, ca, sa) => {
    const o = 0.5, Hw = hw + o, Hd = hd + o, yt = y + rise;
    const eu = [ca, sa], ev = [-sa, ca];   // world directions of local u and v
    if (Hw >= Hd) {
      const r = Math.max(0.01, Hw - Hd), r1 = P(-r, 0, yt), r2 = P(r, 0, yt);
      tri(R, P(-Hw, -Hd, y), r1, r2, rc, eu); tri(R, P(-Hw, -Hd, y), r2, P(Hw, -Hd, y), rc, eu);
      tri(R, P(Hw, Hd, y), r2, r1, rc, eu); tri(R, P(Hw, Hd, y), r1, P(-Hw, Hd, y), rc, eu);
      tri(R, P(-Hw, Hd, y), r1, P(-Hw, -Hd, y), rc, ev); tri(R, P(Hw, -Hd, y), r2, P(Hw, Hd, y), rc, ev);
    } else {
      const r = Math.max(0.01, Hd - Hw), r1 = P(0, -r, yt), r2 = P(0, r, yt);
      tri(R, P(Hw, -Hd, y), r1, r2, rc, ev); tri(R, P(Hw, -Hd, y), r2, P(Hw, Hd, y), rc, ev);
      tri(R, P(-Hw, Hd, y), r2, r1, rc, ev); tri(R, P(-Hw, Hd, y), r1, P(-Hw, -Hd, y), rc, ev);
      tri(R, P(-Hw, -Hd, y), r1, P(Hw, -Hd, y), rc, eu); tri(R, P(Hw, Hd, y), r2, P(-Hw, Hd, y), rc, eu);
    }
    // fascia (the thick edge of the eaves) and the shaded soffit under the overhang
    const fc = new THREE.Color('#f3eee4'), sc = new THREE.Color('#9c968a');
    const ring = [[-Hw, -Hd], [Hw, -Hd], [Hw, Hd], [-Hw, Hd]], inner = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
    for (let k = 0; k < 4; k++) {
      const [u0, v0] = ring[k], [u1, v1] = ring[(k + 1) % 4];
      const a = P(u0, v0, y - 0.3), b = P(u1, v1, y - 0.3), c = P(u1, v1, y), d = P(u0, v0, y);
      const nx = (b[2] - a[2]), nz = -(b[0] - a[0]), L = Math.hypot(nx, nz) || 1;
      for (const q of [a, b, c, a, c, d]) push(Tr, q, [0, 0], fc, [-nx / L, 0, -nz / L]);
      const [i0, j0] = inner[k], [i1, j1] = inner[(k + 1) % 4];
      const s0 = P(u0, v0, y - 0.3), s1 = P(u1, v1, y - 0.3), s2 = P(i1, j1, y - 0.05), s3 = P(i0, j0, y - 0.05);
      for (const q of [s0, s1, s2, s0, s2, s3]) push(Tr, q, [0, 0], sc, [0, -1, 0]);
    }
  };
  const box4 = (P, hw, hd, ht, color, frontIx, frontB, frontUV, ca, sa) => {
    // four walls; face frontIx goes into builder frontB with frontUV
    const faces = [[[-hw, -hd], [hw, -hd]], [[hw, -hd], [hw, hd]], [[hw, hd], [-hw, hd]], [[-hw, hd], [-hw, -hd]]];
    const lnorm = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    faces.forEach(([a, b], i) => {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const A = P(a[0], a[1], -1.5), B_ = P(b[0], b[1], -1.5), C = P(b[0], b[1], ht), D = P(a[0], a[1], ht);
      const [lu, lv] = lnorm[i]; const nrm = [lu * ca - lv * sa, 0, lu * sa + lv * ca];
      if (i === frontIx && frontB) wallQuad(frontB, A, B_, C, D, frontUV, color, nrm);
      else wallQuad(W, A, B_, C, D, [[0, -0.5], [L / 4, -0.5], [L / 4, ht / 3], [0, ht / 3]], color, nrm);
    });
  };
  const SCHOOLC = new THREE.Color('#d9c7a5');
  for (const h of HOUSES) {
    const cx = h.x, cz = h.z, y0 = terrainH(cx, cz);
    const ca = Math.cos(h.ang), sa = Math.sin(h.ang);
    const hw = h.w / 2, hd = h.d / 2;
    const P = (u, v, y) => [cx + u * ca - v * sa, y0 + y, cz + u * sa + v * ca];
    if (h.school) {
      const ht = 4.6;
      box4(P, hw, hd, ht, SCHOOLC, -1, null, null, ca, sa);
      const rc = new THREE.Color('#a3a8ad');
      const o = 0.6;
      for (const q of [P(-hw - o, -hd - o, ht), P(hw + o, hd + o, ht), P(hw + o, -hd - o, ht), P(-hw - o, -hd - o, ht), P(-hw - o, hd + o, ht), P(hw + o, hd + o, ht)]) push(R, q, [q[0] * 0.2, q[2] * 0.2], rc, [0, 1, 0]);
      addBox(cx, cz, h.w, h.d, h.ang, 'school');
      Object.assign(h, { ht, rise: 0, along: true, y0 });
      continue;
    }
    const big = h.w * h.d;
    const stories = big > 230 ? (rnd() < 0.75 ? 2 : 1) : (rnd() < 0.45 ? 2 : 1);
    const ht = stories * 3.0 + 0.4;
    col.set(pick(WALLS));
    const rc = new THREE.Color(pick(ROOFC));
    // which face points to the street
    const fx = Math.sin(h.front), fz = Math.cos(h.front);
    const lnorm = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    let fi = 0, bd = -2;
    lnorm.forEach(([lu, lv], i) => { const d = (lu * ca - lv * sa) * fx + (lu * sa + lv * ca) * fz; if (d > bd) { bd = d; fi = i; } });
    const faceLen = fi % 2 === 0 ? h.w : h.d, faceDepth = fi % 2 === 0 ? h.d : h.w;
    const wing = faceLen > 11 && faceDepth > 8;
    const v0 = stories === 2 ? 0 : 0.5;
    const entryUV = [[0, -0.05], [1, -0.05], [1, 1 - v0], [0, 1 - v0]];
    box4(P, hw, hd, ht, col, fi, E, entryUV, ca, sa);
    const rise = Math.min(hw, hd) * 0.48;
    hipRoof(P, hw, hd, ht, rise, rc, ca, sa);
    addBox(cx, cz, h.w + 0.4, h.d + 0.4, h.ang, 'house');
    if (wing) {
      // a one-storey garage wing pushed out toward the street at one end of the front
      const [lu, lv] = lnorm[fi];
      const au = lv, av = -lu;   // along the front face (local), chosen so wing-local +v points to the street
      const gw = 6.4, gd = 6.6, out = 3.0, side = rnd() < 0.5 ? 1 : -1;
      const off = side * (faceLen / 2 - gw / 2);
      const faceC = [lu * (fi % 2 === 0 ? 0 : hw) + 0, lv * (fi % 2 === 0 ? hd : 0)];
      const cu = faceC[0] + au * off + lu * (out - gd / 2), cv = faceC[1] + av * off + lv * (out - gd / 2);
      const Pw = (u, v, y) => P(cu + au * u + lu * v, cv + av * u + lv * v, y);
      // in wing-local coords, +v points to the street; the street face is index 2 of box4 ([hw,hd]→[-hw,hd])
      const wca = au * ca - av * sa, wsa = au * sa + av * ca;   // world direction of wing-local u
      const wht = 3.3;
      box4(Pw, gw / 2, gd / 2, wht, col, 2, Gd, [[0, -0.05], [1, -0.05], [1, 1], [0, 1]], wca, wsa);
      hipRoof(Pw, gw / 2, gd / 2, wht, 1.4, rc, wca, wsa);
      const [wx, , wz] = Pw(0, 0, 0);
      addBox(wx, wz, gw + 0.3, gd + 0.3, Math.atan2(wsa, wca), 'house');
      h.wing = { x: wx, z: wz };
    }
    Object.assign(h, { ht, rise, along: h.w >= h.d, y0, fi });
  }
  const mk = (B, map, glow, rough = 0.92) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(B.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(B.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(B.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(B.c, 3));
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map, vertexColors: true, emissiveMap: glow || null, emissive: '#000000', roughness: rough, metalness: 0, side: glow ? THREE.FrontSide : THREE.DoubleSide }));
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m); return m;
  };
  const walls = mk(W, wallTex, wallGlow), fronts = mk(E, entryTex, entryGlow), garages = mk(Gd, garageTex, garageGlow), roofs = mk(R, roofTex, null, 0.72), trim = mk(Tr, trimTex, null, 0.9);
  return { walls, fronts, garages, roofs, trim };
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
  const sh = new THREE.InstancedMesh(crownGeometry(9, 1.0, 0.75), foliageMaterial(leafTex), shrubs.length);
  sh.customDepthMaterial = foliageDepth(leafTex);
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
  const tm = new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1, metalness: 0 });
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
      .replace('#include <map_fragment>', '#include <map_fragment>\nvec3 dtl = texture2D(detailMap, vDet).rgb * texture2D(detailMap, vDet * 0.13).rgb;\nfloat mac = texture2D(detailMap, vDet * 0.011).r * texture2D(detailMap, vDet * 0.0037).r;\ndiffuseColor.rgb *= (0.55 + dtl * 1.1) * (0.8 + mac * 0.55);\ndiffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.1, 1.02, 0.82), clamp(mac * 1.6 - 0.5, 0.0, 1.0));');
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
  // a continuous ridge of hills on the horizon (Black Mountain rises to the east)
  {
    const seg = 160, rows = 6, P = [], C = [], I = [];
    const noise = (a, k) => Math.sin(a * 3 + k) * 0.5 + Math.sin(a * 7.3 + k * 2.1) * 0.3 + Math.sin(a * 17.1 + k * 0.7) * 0.2;
    const col = new THREE.Color(), near = new THREE.Color('#8b8a62'), far = new THREE.Color('#9aa3a8');
    for (let r = 0; r <= rows; r++) for (let i = 0; i <= seg; i++) {
      const a = i / seg * Math.PI * 2, t = r / rows;
      const R = 1500 + t * 1300;
      let h = (0.5 + 0.5 * noise(a, r * 0.9)) * (60 + t * 180);
      const bm = Math.exp(-((a - 0.25) ** 2) / 0.04); h += bm * 260 * (0.4 + t * 0.6);   // Black Mountain
      if (r === 0) h = 0;
      P.push(Math.cos(a) * R, h - 6, Math.sin(a) * R);
      col.copy(near).lerp(far, t).multiplyScalar(0.85 + 0.25 * (h / 300)); C.push(col.r, col.g, col.b);
    }
    for (let r = 0; r < rows; r++) for (let i = 0; i < seg; i++) {
      const a = r * (seg + 1) + i, b = a + 1, c = a + seg + 1, d = c + 1;
      I.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.setIndex(I); g.computeVertexNormals();
    const hills = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    scene.add(hills);
  }
  return m;
}

// ---------- vegetation ----------
function buildTrees(scene) {
  const T = MAP.trees.filter(t => Object.values(SHOPS).every(sp => Math.hypot(t[0] - sp.x, t[1] - sp.z) > 16));
  const kinds = [[], [], [], []];
  for (const t of T) kinds[t[2]].push(t);
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const c = new THREE.Color();
  const make = (geo, mat, list, f, depth) => {
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
    im.count = list.length;
    list.forEach((t, i) => { f(t, i, im); });
    im.castShadow = true; im.receiveShadow = true;
    if (depth) im.customDepthMaterial = depth;
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    scene.add(im); return im;
  };
  const trunkG = new THREE.CylinderGeometry(0.14, 0.26, 1, 8); trunkG.translate(0, 0.5, 0);
  const trunkM = new THREE.MeshStandardMaterial({ map: barkTex, roughness: 0.95 });
  const leafM = foliageMaterial(leafTex), leafD = foliageDepth(leafTex);
  // shade trees: a trunk, two forks and a leafy crown
  const round = kinds[0];
  const crownA = crownGeometry(22, 1.0, 0.8), crownB = crownGeometry(14, 0.9, 0.75);
  make(trunkG, trunkM, round, (t, i, im) => {
    const h = 2.4 + rnd() * 1.8, y = terrainH(t[0], t[1]);
    M.compose(v.set(t[0], y, t[1]), q.setFromAxisAngle(up, rnd() * 6), s.set(1, h, 1)); im.setMatrixAt(i, M); t.h = h; t.y = y;
    addCircle(t[0], t[1], 0.45, 'tree');
  });
  const tops = [], subs = [];
  for (const t of round) {
    const r = 2.0 + rnd() * 1.5, hue = 0.2 + rnd() * 0.1, sat = 0.38 + rnd() * 0.2, lit = 0.3 + rnd() * 0.1;
    tops.push({ x: t[0], y: t.y + t.h + r * 0.6, z: t[1], r, hue, sat, lit });
    for (let k = 0; k < 2; k++) { const a = rnd() * 6.28, d = r * 0.5; subs.push({ x: t[0] + Math.cos(a) * d, y: t.y + t.h + r * (0.15 + rnd() * 0.4), z: t[1] + Math.sin(a) * d, r: r * 0.65, hue, sat, lit: lit - 0.04 }); }
  }
  const crownF = (b, i, im) => { M.compose(v.set(b.x, b.y, b.z), q.setFromAxisAngle(up, rnd() * 6), s.set(b.r, b.r, b.r)); im.setMatrixAt(i, M); im.setColorAt(i, c.setHSL(b.hue, b.sat, b.lit)); };
  make(crownA, leafM, tops, crownF, leafD);
  make(crownB, leafM, subs, crownF, leafD);
  // palms: tall curved-looking trunks with a crown of fronds
  const palms = kinds[1];
  const ptrunk = new THREE.CylinderGeometry(0.15, 0.25, 1, 8); ptrunk.translate(0, 0.5, 0);
  make(ptrunk, new THREE.MeshStandardMaterial({ map: barkTex, color: '#b8a58a', roughness: 0.9 }), palms, (t, i, im) => {
    const h = 7 + rnd() * 6, y = terrainH(t[0], t[1]);
    M.compose(v.set(t[0], y, t[1]), q.identity(), s.set(1, h, 1)); im.setMatrixAt(i, M); t.h = h; t.y = y;
    addCircle(t[0], t[1], 0.35, 'tree');
  });
  const frondM = foliageMaterial(frondTex), frondD = foliageDepth(frondTex);
  make(palmGeometry(12), frondM, palms, (t, i, im) => {
    M.compose(v.set(t[0], t.y + t.h, t[1]), q.setFromAxisAngle(up, rnd() * 6), s.set(1, 1, 1)); im.setMatrixAt(i, M);
    im.setColorAt(i, c.setHSL(0.2 + rnd() * 0.05, 0.45, 0.36 + rnd() * 0.08));
  }, frondD);
  // Italian cypress / pines along Carmel Mountain Rd: tall narrow leaf-card columns
  const pines = kinds[2];
  const colG = crownGeometry(26, 0.8, 1.0); colG.scale(1, 1, 1);
  make(trunkG, trunkM, pines, (t, i, im) => { const y = terrainH(t[0], t[1]); t.y = y; M.compose(v.set(t[0], y, t[1]), q.identity(), s.set(0.8, 1.5, 0.8)); im.setMatrixAt(i, M); addCircle(t[0], t[1], 0.5, 'tree'); });
  make(colG, leafM, pines, (t, i, im) => {
    const h = 6 + rnd() * 4, r = 1.1 + rnd() * 0.4;
    M.compose(v.set(t[0], t.y + 1.2 + h / 2, t[1]), q.setFromAxisAngle(up, rnd() * 6), s.set(r, h / 2, r)); im.setMatrixAt(i, M);
    im.setColorAt(i, c.setHSL(0.27 + rnd() * 0.05, 0.4, 0.22 + rnd() * 0.06));
  }, leafD);
  // chaparral: low, grey-green and olive scrub
  const bush = kinds[3];
  const bm = make(crownGeometry(7, 1.15, 0.6), leafM, bush, (t, i, im) => {
    const r = 0.9 + rnd() * 1.4, y = terrainH(t[0], t[1]);
    M.compose(v.set(t[0], y + r * 0.45, t[1]), q.setFromAxisAngle(up, rnd() * 6), s.set(r * (1 + rnd() * 0.4), r * 0.8, r)); im.setMatrixAt(i, M);
    im.setColorAt(i, c.setHSL(0.14 + rnd() * 0.12, 0.22 + rnd() * 0.18, 0.3 + rnd() * 0.12));
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
    const paint = new THREE.InstancedMesh(g.paint, new THREE.MeshStandardMaterial({ color: '#fff', vertexColors: true, metalness: 0.3, roughness: 0.35 }), Math.max(1, n));
    const fixed = new THREE.InstancedMesh(g.fixed, new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.4, roughness: 0.3 }), Math.max(1, n));
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
