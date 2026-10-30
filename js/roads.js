// Street network queries: nearest road, surface, terrain height and GPS routing.
import { MAP } from './mapdata.js';

export const ROADS = MAP.roads;
export const NODES = MAP.nodes;
export const EDGES = MAP.edges;
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;

export const LIMIT = name => name === 'Carmel Mountain Rd' ? 40 : 25;   // mph
export const MPH = 2.23694;

// ---------- spatial grid of road segments ----------
const CELL = 24;
const grid = new Map();
const segs = [];
ROADS.forEach((r, ri) => {
  for (let k = 0; k < r.pts.length - 1; k++) {
    const a = r.pts[k], b = r.pts[k + 1];
    const s = { ri, k, ax: a[0], az: a[1], bx: b[0], bz: b[1], w: r.w };
    s.len = Math.hypot(s.bx - s.ax, s.bz - s.az);
    segs.push(s);
    const pad = r.w / 2 + 6;
    const x0 = Math.floor((Math.min(a[0], b[0]) - pad) / CELL), x1 = Math.floor((Math.max(a[0], b[0]) + pad) / CELL);
    const z0 = Math.floor((Math.min(a[1], b[1]) - pad) / CELL), z1 = Math.floor((Math.max(a[1], b[1]) + pad) / CELL);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const key = x * 4096 + z;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(s);
    }
  }
});
const deadR = MAP.dead.map(n => {
  const e = EDGES.find(e => e.a === n || e.b === n);
  return { x: NODES[n][0], z: NODES[n][1], r: ROADS[e.r].w * 0.9, ri: e.r };
});

// nearest road to (x,z): { ri, d (to centreline), edge (signed distance past the kerb), tx,tz (direction), name }
export function nearestRoad(x, z) {
  let list = grid.get(Math.floor(x / CELL) * 4096 + Math.floor(z / CELL));
  if (!list) list = segs;   // far from every street: search them all
  let best = null;
  if (list) for (const s of list) {
    const dx = s.bx - s.ax, dz = s.bz - s.az;
    let t = ((x - s.ax) * dx + (z - s.az) * dz) / (s.len * s.len);
    t = clamp(t, 0, 1);
    const qx = s.ax + dx * t, qz = s.az + dz * t;
    const d = Math.hypot(x - qx, z - qz);
    const edge = d - s.w / 2;
    if (!best || edge < best.edge) best = { ri: s.ri, k: s.k, t, d, edge, qx, qz, tx: dx / s.len, tz: dz / s.len, w: s.w };
  }
  for (const c of deadR) {
    const d = Math.hypot(x - c.x, z - c.z);
    if (d < c.r + 4 && (!best || d - c.r < best.edge)) {
      const r = ROADS[c.ri];
      best = best && best.ri === c.ri ? { ...best, edge: Math.min(best.edge, d - c.r) } : { ri: c.ri, k: 0, t: 0, d, edge: d - c.r, qx: c.x, qz: c.z, tx: 1, tz: 0, w: r.w };
    }
  }
  if (best) best.name = ROADS[best.ri].name;
  return best;
}

// ---------- terrain ----------
const H = MAP.hgt;
const hbytes = Uint8Array.from(atob(H.b64), c => c.charCodeAt(0));
const X0 = MAP.xmin, Z0 = MAP.zmin;
function hcell(i, j) {
  i = clamp(i, 0, H.nx - 1); j = clamp(j, 0, H.nz - 1);
  return -hbytes[j * H.nx + i] / 4;
}
// fade canyons out at the map border so the world meets the plain beyond it
function borderFade(x, z) {
  const m = Math.min(x - MAP.xmin, MAP.xmax - x, z - MAP.zmin, MAP.zmax - z);
  return clamp(m / 40, 0, 1);
}
export function terrainH(x, z) {
  const fx = (x - X0) / H.cell, fz = (z - Z0) / H.cell;
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
  const h = lerp(lerp(hcell(i, j), hcell(i + 1, j), u), lerp(hcell(i, j + 1), hcell(i + 1, j + 1), u), v);
  return h * borderFade(x, z);
}

// surface: 0 road, 1 sidewalk/drive, 2 lawn, 3 park grass, 4 canyon dirt
export const SCHOOL_LOTS = [[-143.2, -9.3, -71.9, 49.6], [-68.8, -24.8, 14.9, 24.8], [-71.9, 83.7, -0.6, 120.9]];
export function surfaceAt(x, z) {
  const r = nearestRoad(x, z);
  if (r && r.edge < 0) return 0;
  if (r && r.edge < 2.4) return 1;
  for (const [x0, z0, x1, z1] of SCHOOL_LOTS) if (x > x0 && x < x1 && z > z0 && z < z1) return 0;
  const h = terrainH(x, z);
  if (h < -0.6) return 4;
  const px = MAP.park;
  if (Math.hypot((x - px[0]) / 150, (z - px[1]) / 60) < 1) return 3;
  return 2;
}

// ---------- graph & routing ----------
export const ADJ = NODES.map(() => []);
EDGES.forEach((e, i) => { ADJ[e.a].push(i); ADJ[e.b].push(i); });
export const other = (e, n) => e.a === n ? e.b : e.a;

// project a point onto the nearest edge: { ei, s (arc length from a), x, z }
export function onEdge(x, z) {
  let best = null;
  EDGES.forEach((e, ei) => {
    let acc = 0;
    for (let k = 0; k < e.pts.length - 1; k++) {
      const a = e.pts[k], b = e.pts[k + 1];
      const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
      const t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (L * L), 0, 1);
      const qx = a[0] + dx * t, qz = a[1] + dz * t, d = Math.hypot(x - qx, z - qz);
      if (!best || d < best.d) best = { ei, s: acc + t * L, x: qx, z: qz, d, tx: dx / L, tz: dz / L };
      acc += L;
    }
  });
  return best;
}

// point at arc length s along an edge (forward from node a)
export function edgePoint(e, s) {
  let acc = 0;
  for (let k = 0; k < e.pts.length - 1; k++) {
    const a = e.pts[k], b = e.pts[k + 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (s <= acc + L || k === e.pts.length - 2) {
      const t = clamp((s - acc) / L, 0, 1);
      return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, tx: (b[0] - a[0]) / L, tz: (b[1] - a[1]) / L };
    }
    acc += L;
  }
}

// shortest route from a point to a point, as a list of [x,z] plus the node path for turn-by-turn
export function route(fx, fz, tx, tz) {
  const A = onEdge(fx, fz), B = onEdge(tx, tz);
  const ea = EDGES[A.ei], eb = EDGES[B.ei];
  if (A.ei === B.ei) {
    const pts = [];
    const n = 12;
    for (let i = 0; i <= n; i++) { const p = edgePoint(ea, lerp(A.s, B.s, i / n)); pts.push([p.x, p.z]); }
    return { pts, len: Math.abs(B.s - A.s), turns: [] };
  }
  const dist = new Float64Array(NODES.length).fill(Infinity), prev = new Int32Array(NODES.length).fill(-1), via = new Int32Array(NODES.length).fill(-1);
  dist[ea.a] = A.s; dist[ea.b] = ea.len - A.s;
  const done = new Uint8Array(NODES.length);
  for (;;) {
    let u = -1, best = Infinity;
    for (let i = 0; i < NODES.length; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
    if (u < 0) break;
    done[u] = 1;
    for (const ei of ADJ[u]) {
      const e = EDGES[ei];
      if (ROADS[e.r].oneway && e.a !== u) continue;
      const v = other(e, u), nd = dist[u] + e.len;
      if (nd < dist[v]) { dist[v] = nd; prev[v] = u; via[v] = ei; }
    }
  }
  const costA = dist[eb.a] + B.s, costB = dist[eb.b] + (eb.len - B.s);
  let end = costA <= costB ? eb.a : eb.b;
  const nodes = [];
  for (let n = end; n >= 0; n = prev[n]) nodes.unshift(n);
  const pts = [[A.x, A.z]];
  const pushEdge = (e, from, s0, s1) => {
    const n = Math.max(2, Math.ceil(Math.abs(s1 - s0) / 6));
    for (let i = 1; i <= n; i++) { const p = edgePoint(e, lerp(s0, s1, i / n)); pts.push([p.x, p.z]); }
  };
  pushEdge(ea, null, A.s, nodes[0] === ea.a ? 0 : ea.len);
  const edgesUsed = [A.ei];
  for (let i = 1; i < nodes.length; i++) {
    const ei = via[nodes[i]], e = EDGES[ei];
    pushEdge(e, nodes[i - 1], e.a === nodes[i - 1] ? 0 : e.len, e.a === nodes[i - 1] ? e.len : 0);
    edgesUsed.push(ei);
  }
  pushEdge(eb, end, end === eb.a ? 0 : eb.len, B.s);
  edgesUsed.push(B.ei);
  // turn-by-turn: at each node, compare headings in and out
  const turns = [];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i], ein = EDGES[edgesUsed[i]], eout = EDGES[edgesUsed[i + 1]];
    if (!ein || !eout || ein === eout) continue;
    const dirIn = edgeDirAt(ein, n, true), dirOut = edgeDirAt(eout, n, false);
    const cross = dirIn[0] * dirOut[1] - dirIn[1] * dirOut[0];
    const dot = dirIn[0] * dirOut[0] + dirIn[1] * dirOut[1];
    const ang = Math.atan2(cross, dot);
    const nameIn = ROADS[ein.r].name, nameOut = ROADS[eout.r].name;
    if (Math.abs(ang) > 0.5 || (nameIn !== nameOut && ADJ[n].length > 2)) {
      turns.push({ x: NODES[n][0], z: NODES[n][1], dir: Math.abs(ang) < 0.35 ? 'straight' : ang > 0 ? 'right' : 'left', road: nameOut, node: n });
    }
  }
  return { pts, len: Math.min(costA, costB), turns, nodes };
}
// unit direction of an edge at node n: arriving into n (inbound) or leaving n
function edgeDirAt(e, n, inbound) {
  const p = e.pts;
  let a, b;
  if (e.a === n) { a = p[0]; b = p[1]; } else { a = p[p.length - 1]; b = p[p.length - 2]; }
  let dx = b[0] - a[0], dz = b[1] - a[1];
  if (inbound) { dx = -dx; dz = -dz; }
  const L = Math.hypot(dx, dz) || 1;
  return [dx / L, dz / L];
}

// addresses
export const HOUSES = MAP.blds.map((b, i) => ({ i, x: b[0], z: b[1], w: b[2], d: b[3], ang: b[4], school: !!b[5], front: b[6], num: b[7], street: b[8], drive: b[9] }))
  ;
export const ADDRESSED = HOUSES.filter(h => h.num && h.drive);
export function houseAt(street, i) {
  const list = ADDRESSED.filter(h => h.street === street);
  return list[((i % list.length) + list.length) % list.length];
}
