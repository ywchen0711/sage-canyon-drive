// Crisp 3D streets on top of the painted ground: asphalt, kerbs, sidewalks, lane markings, crosswalks and stop bars.
import * as THREE from '../lib/three.module.min.js';
import { MAP } from './mapdata.js';
import { ROADS, NODES, EDGES, ADJ, terrainH } from './roads.js';

export const ROAD_Y = 0.03, WALK_Y = 0.14, LINE_Y = 0.045;
const rnd = (() => { let s = 4242; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();

function tex(w, h, draw, rep = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8; return t;
}
const asphaltTex = tex(512, 512, (g, w, h) => {
  g.fillStyle = '#56585c'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 26000; i++) { const v = 60 + rnd() * 70; g.fillStyle = `rgba(${v},${v},${v + 3},${0.25 + rnd() * 0.35})`; g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2); }
  // patches and cracks
  for (let i = 0; i < 5; i++) { g.fillStyle = `rgba(30,30,32,${0.12 + rnd() * 0.12})`; g.fillRect(rnd() * w, rnd() * h, 40 + rnd() * 120, 30 + rnd() * 80); }
  g.strokeStyle = 'rgba(25,25,25,0.45)'; g.lineWidth = 1.5;
  for (let i = 0; i < 9; i++) { g.beginPath(); let x = rnd() * w, y = rnd() * h; g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (rnd() - 0.5) * 50; y += (rnd() - 0.5) * 50; g.lineTo(x, y); } g.stroke(); }
});
const walkTex = tex(256, 256, (g, w, h) => {
  g.fillStyle = '#c9c5bb'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 6000; i++) { const v = 170 + rnd() * 60; g.fillStyle = `rgba(${v},${v - 3},${v - 10},0.5)`; g.fillRect(rnd() * w, rnd() * h, 2, 2); }
  g.fillStyle = 'rgba(90,85,75,0.55)';
  for (let k = 0; k <= 2; k++) { g.fillRect(0, k * 128 - 1, w, 3); g.fillRect(k * 128 - 1, 0, 3, h); }
});
const curbM = new THREE.MeshLambertMaterial({ color: '#b8b4aa', side: THREE.DoubleSide });
const asphaltM = new THREE.MeshLambertMaterial({ map: asphaltTex, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2, side: THREE.DoubleSide });
const walkM = new THREE.MeshLambertMaterial({ map: walkTex, side: THREE.DoubleSide });
const whiteM = new THREE.MeshLambertMaterial({ color: '#f2f2ee', polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, side: THREE.DoubleSide });
const yellowM = new THREE.MeshLambertMaterial({ color: '#f0c43a', polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, side: THREE.DoubleSide });
const medianM = new THREE.MeshLambertMaterial({ color: '#6f9a4e', side: THREE.DoubleSide });

// geometry builder that collects triangles with world-space UVs
function Builder() {
  const p = [], uv = [], n = [];
  return {
    tri(a, b, c, s = 0.25) {
      for (const v of [a, b, c]) { p.push(v[0], v[1], v[2]); uv.push(v[0] * s, v[2] * s); }
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const L = Math.hypot(nx, ny, nz) || 1;
      if (ny < 0 && Math.abs(ny) > 0.5) { nx = -nx; ny = -ny; nz = -nz; }
      for (let i = 0; i < 3; i++) n.push(nx / L, ny / L, nz / L);
    },
    quad(a, b, c, d, s) { this.tri(a, b, c, s); this.tri(a, c, d, s); },
    mesh(mat) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
      const m = new THREE.Mesh(g, mat); m.receiveShadow = true; return m;
    },
  };
}
// densify a polyline so it follows the terrain and curves smoothly
function dense(pts, step = 3) {
  const out = [];
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k], b = pts[k + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / step));
    for (let i = 0; i < n; i++) out.push([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]);
  }
  out.push(pts[pts.length - 1].slice());
  return out;
}
// left/right offset points with mitred joins
function offsets(pts, off) {
  return pts.map((p, k) => {
    const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)];
    let dx = b[0] - a[0], dz = b[1] - a[1]; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    return [p[0] - dz * off, p[1] + dx * off];
  });
}
function ribbon(B, pts, o0, o1, y0, y1 = y0) {
  const A = offsets(pts, o0), C = offsets(pts, o1);
  for (let k = 0; k < pts.length - 1; k++) {
    const h = (x, z, y) => [x, terrainH(x, z) + y, z];
    B.quad(h(A[k][0], A[k][1], y0), h(C[k][0], C[k][1], y1), h(C[k + 1][0], C[k + 1][1], y1), h(A[k + 1][0], A[k + 1][1], y0));
  }
}
function disc(B, x, z, r, y, seg = 28) {
  const c = [x, terrainH(x, z) + y, z];
  for (let i = 0; i < seg; i++) {
    const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
    const p0 = [x + Math.cos(a0) * r, 0, z + Math.sin(a0) * r], p1 = [x + Math.cos(a1) * r, 0, z + Math.sin(a1) * r];
    p0[1] = terrainH(p0[0], p0[2]) + y; p1[1] = terrainH(p1[0], p1[2]) + y;
    B.tri(c, p1, p0);
  }
}
function ring(B, x, z, r0, r1, y0, y1, seg = 32) {
  for (let i = 0; i < seg; i++) {
    const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
    const P = (r, a, y) => { const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; return [px, terrainH(px, pz) + y, pz]; };
    B.quad(P(r0, a0, y0), P(r0, a1, y0), P(r1, a1, y1), P(r1, a0, y1));
  }
}

const deg = NODES.map((_, i) => ADJ[i].length);
const junctions = NODES.map((n, i) => deg[i] >= 3 ? { x: n[0], z: n[1], r: Math.max(...ADJ[i].map(e => ROADS[EDGES[e].r].w)) / 2 } : null).filter(Boolean);
const deadEnds = MAP.dead.map(n => { const e = EDGES[ADJ[n][0]]; return { x: NODES[n][0], z: NODES[n][1], r: ROADS[e.r].w * 0.9 }; });
// split a dense polyline into runs that stay clear of junctions (and dead-end bulbs)
function clearRuns(pts, pad, bulbPad = null) {
  const runs = []; let cur = [];
  for (const p of pts) {
    let blocked = junctions.some(j => Math.hypot(p[0] - j.x, p[1] - j.z) < j.r + pad);
    if (!blocked && bulbPad != null) blocked = deadEnds.some(d => Math.hypot(p[0] - d.x, p[1] - d.z) < d.r + bulbPad);
    if (blocked) { if (cur.length > 1) runs.push(cur); cur = []; } else cur.push(p);
  }
  if (cur.length > 1) runs.push(cur);
  return runs;
}
function dashed(B, pts, off, on, gap, width, y) {
  let acc = 0, draw = true, seg = [pts[0]];
  for (let k = 0; k < pts.length - 1; k++) {
    let a = pts[k]; const b = pts[k + 1];
    let L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (L > 0) {
      const lim = draw ? on : gap, take = Math.min(L, lim - acc);
      const t = take / L, q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      seg.push(q); acc += take; L -= take; a = q;
      if (acc >= lim - 1e-6) { if (draw && seg.length > 1) ribbon(B, seg, off - width / 2, off + width / 2, y); draw = !draw; acc = 0; seg = [q]; }
    }
  }
  if (draw && seg.length > 1) ribbon(B, seg, off - width / 2, off + width / 2, y);
}

export function buildRoads(scene) {
  const asphalt = Builder(), walk = Builder(), curb = Builder(), white = Builder(), yellow = Builder(), median = Builder();
  for (const r of ROADS) {
    const pts = dense(r.pts);
    const hw = r.w / 2;
    ribbon(asphalt, pts, -hw, hw, ROAD_Y);
    if (r.name === 'Sage Canyon School') continue;
    // sidewalks with a kerb face, stopping short of junctions
    for (const run of clearRuns(pts, 2.6, 2.4)) {
      for (const s of [1, -1]) {
        const a = s * hw, b = s * (hw + 2.2);
        ribbon(walk, run, s > 0 ? a : b, s > 0 ? b : a, WALK_Y);
        ribbon(curb, run, a, a, s > 0 ? ROAD_Y : WALK_Y, s > 0 ? WALK_Y : ROAD_Y);
      }
    }
    // markings
    if (r.name === 'Carmel Mountain Rd') {
      for (const run of clearRuns(pts, 9)) {
        for (const s of [1, -1]) {
          ribbon(yellow, run, s * 2.0 - 0.07, s * 2.0 + 0.07, LINE_Y);
          dashed(white, run, s * 5.6, 3, 9, 0.13, LINE_Y);
          ribbon(white, run, s * 9.3 - 0.07, s * 9.3 + 0.07, LINE_Y);
        }
        // raised planted median
        ribbon(median, run, -1.6, 1.6, 0.2);
        ribbon(curb, run, -1.6, -1.6, ROAD_Y, 0.2); ribbon(curb, run, 1.6, 1.6, 0.2, ROAD_Y);
      }
    } else if (r.name === 'Harvest Run Dr' && r.w > 10) {
      for (const run of clearRuns(pts, 4)) for (const s of [1, -1]) ribbon(yellow, run, s * 0.2 - 0.06, s * 0.2 + 0.06, LINE_Y);
    } else if (r.w >= 10.5 && r.name) {
      for (const run of clearRuns(pts, 4)) dashed(yellow, run, 0, 3, 9, 0.12, LINE_Y);
    }
  }
  // junction fills and cul-de-sac bulbs with a kerb and sidewalk ring
  for (const j of junctions) disc(asphalt, j.x, j.z, j.r + 0.6, ROAD_Y);
  for (const d of deadEnds) {
    disc(asphalt, d.x, d.z, d.r, ROAD_Y);
    ring(curb, d.x, d.z, d.r, d.r, ROAD_Y, WALK_Y);
    ring(walk, d.x, d.z, d.r, d.r + 2.2, WALK_Y, WALK_Y);
  }
  // crosswalks
  for (const [cx, cz, ang, w] of MAP.xwalks) {
    const dx = Math.sin(ang), dz = Math.cos(ang), nx = -dz, nz = dx;
    for (let s = -w / 2 + 0.6; s < w / 2; s += 1.2) {
      const x = cx + nx * s, z = cz + nz * s;
      const P = (u, v) => { const px = x + dx * u + nx * v, pz = z + dz * u + nz * v; return [px, terrainH(px, pz) + LINE_Y, pz]; };
      white.quad(P(-1.5, -0.3), P(-1.5, 0.3), P(1.5, 0.3), P(1.5, -0.3));
    }
  }
  // stop bars on the right-hand half of minor approaches
  for (const s of MAP.stops) {
    const e = EDGES[s[4]], w = ROADS[e.r].w;
    const hx = Math.sin(s[2]), hz = Math.cos(s[2]);           // heading of the arriving car
    const rx = -hz, rz = hx;                                  // its right
    const cx = s[0] - rx * (w / 2 + 1.2), cz = s[1] - rz * (w / 2 + 1.2);   // road centre at the line
    const P = (u, v) => { const px = cx + hx * u + rx * v, pz = cz + hz * u + rz * v; return [px, terrainH(px, pz) + LINE_Y, pz]; };
    white.quad(P(-0.25, 0.1), P(-0.25, w / 2 - 0.1), P(0.25, w / 2 - 0.1), P(0.25, 0.1));
    // "STOP" isn't painted; a short dash marks the centre line instead
    yellow.quad(P(-6, -0.06), P(-6, 0.06), P(-0.4, 0.06), P(-0.4, -0.06));
  }
  const g = new THREE.Group();
  g.add(asphalt.mesh(asphaltM), walk.mesh(walkM), curb.mesh(curbM), white.mesh(whiteM), yellow.mesh(yellowM), median.mesh(medianM));
  scene.add(g);
  return g;
}
