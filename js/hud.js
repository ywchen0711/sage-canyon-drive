// Heads-up display drawn on a 2D canvas: street name, GPS, mini-map, speedometer, mission panel.
import { MAP } from './mapdata.js';
import { ROADS, HOUSES, LIMIT, MPH, terrainH } from './roads.js';

const PPM = 2;   // mini-map pixels per metre
let mapCanvas = null;
function buildMap() {
  const w = Math.ceil((MAP.xmax - MAP.xmin) * PPM), h = Math.ceil((MAP.zmax - MAP.zmin) * PPM);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#e9e6dc'; g.fillRect(0, 0, w, h);
  // canyons from the height field
  const H = MAP.hgt, bytes = Uint8Array.from(atob(H.b64), ch => ch.charCodeAt(0));
  const cs = H.cell * PPM;
  for (let j = 0; j < H.nz; j++) for (let i = 0; i < H.nx; i++) {
    const v = bytes[j * H.nx + i];
    if (v > 2) { g.fillStyle = `rgb(${190 - v * 0.6},${214 - v * 0.5},${168 - v * 0.6})`; g.fillRect(i * cs - cs / 2, j * cs - cs / 2, cs + 1, cs + 1); }
  }
  const P = (x, z) => [(x - MAP.xmin) * PPM, (z - MAP.zmin) * PPM];
  // park
  const pk = P(MAP.park[0], MAP.park[1]); g.fillStyle = '#b9dfa5'; g.beginPath(); g.ellipse(pk[0], pk[1], 140 * PPM, 55 * PPM, 0, 0, 7); g.fill();
  // houses
  g.fillStyle = '#cfc8b8';
  for (const b of HOUSES) {
    g.save(); const [x, y] = P(b.x, b.z); g.translate(x, y); g.rotate(b.ang);
    g.fillStyle = b.school ? '#d6b98a' : '#d3cbbb'; g.fillRect(-b.w / 2 * PPM, -b.d / 2 * PPM, b.w * PPM, b.d * PPM); g.restore();
  }
  // roads
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const pass of [0, 1]) for (const r of ROADS) {
    g.strokeStyle = pass ? (r.name === 'Carmel Mountain Rd' ? '#ffd27a' : '#ffffff') : '#a9a49a';
    g.lineWidth = (r.w + (pass ? 0 : 2)) * PPM;
    g.beginPath(); r.pts.forEach((p, i) => { const [x, y] = P(p[0], p[1]); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
  }
  for (const n of MAP.dead) {
    const e = MAP.edges.find(e => e.a === n || e.b === n), r = ROADS[e.r];
    const [x, y] = P(MAP.nodes[n][0], MAP.nodes[n][1]); g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, r.w * 0.9 * PPM, 0, 7); g.fill();
  }
  // street names along the longest segment of each road
  g.font = 'bold 15px Arial'; g.fillStyle = '#5a5850'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const seen = new Set();
  for (const r of ROADS) {
    if (!r.name || seen.has(r.name) || r.name === 'Sage Canyon School') continue;
    let best = null;
    for (const rr of ROADS.filter(q => q.name === r.name)) for (let k = 0; k < rr.pts.length - 1; k++) {
      const a = rr.pts[k], b = rr.pts[k + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (!best || L > best.L) best = { a, b, L };
    }
    seen.add(r.name);
    const [x1, y1] = P(best.a[0], best.a[1]), [x2, y2] = P(best.b[0], best.b[1]);
    let ang = Math.atan2(y2 - y1, x2 - x1); if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI;
    g.save(); g.translate((x1 + x2) / 2, (y1 + y2) / 2); g.rotate(ang); g.fillText(r.name, 0, 0); g.restore();
  }
  const sc = P(MAP.school[0], MAP.school[1]); g.fillStyle = '#7a5a2a'; g.font = 'bold 18px Arial'; g.fillText('🏫 Sage Canyon School', sc[0], sc[1]);
  g.fillText('🌳 Sage Canyon Park', pk[0], pk[1] - 20);
  mapCanvas = c;
  return c;
}
export function getMapCanvas() { return mapCanvas || buildMap(); }

function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function arrowIcon(g, x, y, s, dir) {
  g.save(); g.translate(x, y); g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineWidth = s * 0.16; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath();
  if (dir === 'straight') { g.moveTo(0, s * 0.5); g.lineTo(0, -s * 0.3); g.stroke(); g.beginPath(); g.moveTo(-s * 0.25, -s * 0.15); g.lineTo(0, -s * 0.45); g.lineTo(s * 0.25, -s * 0.15); g.stroke(); }
  else if (dir === 'arrive') { g.beginPath(); g.arc(0, -s * 0.1, s * 0.26, 0, 7); g.stroke(); g.beginPath(); g.arc(0, -s * 0.1, s * 0.08, 0, 7); g.fill(); }
  else {
    const k = dir === 'right' ? 1 : -1;
    g.moveTo(-k * s * 0.15, s * 0.5); g.lineTo(-k * s * 0.15, 0); g.quadraticCurveTo(-k * s * 0.15, -s * 0.2, k * s * 0.15, -s * 0.2); g.lineTo(k * s * 0.3, -s * 0.2); g.stroke();
    g.beginPath(); g.moveTo(k * s * 0.15, -s * 0.42); g.lineTo(k * s * 0.42, -s * 0.2); g.lineTo(k * s * 0.15, 0.02 * s); g.stroke();
  }
  g.restore();
}

export function drawHUD(g, W, H, S) {
  const dpr = S.dpr, sc = Math.min(W, H * 1.6) / 1100 * dpr;
  g.clearRect(0, 0, W, H);
  if (!S.player) return;
  const P = S.player;
  const mph = P.speed * MPH;
  // ---- street name (top centre) ----
  if (S.street) {
    g.font = `bold ${22 * sc}px Arial`;
    const tw = g.measureText(S.street).width + 40 * sc;
    const x = W / 2 - tw / 2, y = 12 * sc;
    g.fillStyle = 'rgba(29,107,59,0.92)'; rr(g, x, y, tw, 40 * sc, 6 * sc); g.fill();
    g.strokeStyle = '#fff'; g.lineWidth = 2 * sc; rr(g, x + 4 * sc, y + 4 * sc, tw - 8 * sc, 32 * sc, 4 * sc); g.stroke();
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(S.street, W / 2, y + 21 * sc);
    // speed limit sign
    const lim = S.limit;
    const lx = W / 2 + tw / 2 + 12 * sc, ly = y - 2 * sc;
    g.fillStyle = '#fff'; rr(g, lx, ly, 40 * sc, 50 * sc, 4 * sc); g.fill(); g.strokeStyle = '#111'; g.lineWidth = 2 * sc; rr(g, lx + 3 * sc, ly + 3 * sc, 34 * sc, 44 * sc, 3 * sc); g.stroke();
    g.fillStyle = '#111'; g.font = `bold ${7 * sc}px Arial`; g.fillText('SPEED', lx + 20 * sc, ly + 11 * sc); g.fillText('LIMIT', lx + 20 * sc, ly + 18 * sc);
    g.font = `bold ${20 * sc}px Arial`; g.fillText(String(lim), lx + 20 * sc, ly + 34 * sc);
  }
  // ---- GPS card (top right) ----
  if (S.nav) {
    const w = 250 * sc, h = 80 * sc, x = W - w - 14 * sc, y = 12 * sc;
    g.fillStyle = 'rgba(16,110,70,0.93)'; rr(g, x, y, w, h, 10 * sc); g.fill();
    arrowIcon(g, x + 40 * sc, y + 42 * sc, 52 * sc, S.nav.dir);
    g.fillStyle = '#fff'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.font = `bold ${24 * sc}px Arial`; g.fillText(S.nav.dist, x + 78 * sc, y + 34 * sc);
    g.font = `${15 * sc}px Arial`;
    let t = S.nav.text; while (g.measureText(t).width > w - 88 * sc && t.length > 4) t = t.slice(0, -2);
    g.fillText(t, x + 78 * sc, y + 60 * sc);
  }
  // ---- mission panel (top left) ----
  if (S.mission) {
    const w = 270 * sc, x = 14 * sc, y = 12 * sc;
    let h = 50 * sc + (S.clockText ? 34 * sc : 0);
    g.fillStyle = 'rgba(20,24,34,0.78)'; rr(g, x, y, w, h, 10 * sc); g.fill();
    g.fillStyle = '#ffd23f'; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.font = `bold ${17 * sc}px Arial`;
    g.fillText(S.mission, x + 14 * sc, y + 30 * sc);
    if (S.clockText) { g.fillStyle = S.clockWarn ? '#ff6b5a' : '#fff'; g.font = `bold ${22 * sc}px Arial`; g.fillText(S.clockText, x + 14 * sc, y + 64 * sc); }
    if (S.passenger) { g.fillStyle = '#9fd8ff'; g.font = `${13 * sc}px Arial`; g.textAlign = 'right'; g.fillText('👤 ' + S.passenger, x + w - 12 * sc, y + 30 * sc); }
  }
  // ---- tip ----
  if (S.tip) {
    g.font = `${16 * sc}px Arial`;
    const lines = wrap(g, S.tip, 430 * sc);
    const w = 460 * sc, h = (lines.length * 22 + 20) * sc, x = W / 2 - w / 2, y = H - h - 24 * sc - (S.touch ? 150 * sc : 0);
    g.fillStyle = 'rgba(255,250,235,0.94)'; rr(g, x, y, w, h, 10 * sc); g.fill();
    g.fillStyle = '#3a3020'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    lines.forEach((l, i) => g.fillText(l, W / 2, y + (28 + i * 22) * sc));
  }
  // ---- toast ----
  if (S.toast && S.toast.t > 0) {
    g.globalAlpha = Math.min(1, S.toast.t * 2);
    g.font = `bold ${26 * sc}px Arial`; g.textAlign = 'center'; g.textBaseline = 'middle';
    const tw = g.measureText(S.toast.text).width + 50 * sc;
    g.fillStyle = S.toast.bad ? 'rgba(200,40,30,0.9)' : 'rgba(20,24,34,0.82)'; rr(g, W / 2 - tw / 2, H * 0.24, tw, 50 * sc, 25 * sc); g.fill();
    g.fillStyle = '#fff'; g.fillText(S.toast.text, W / 2, H * 0.24 + 26 * sc);
    g.globalAlpha = 1;
  }
  // ---- mini-map (bottom left) ----
  if (S.showMap) {
    const R = 105 * sc, cx = 14 * sc + R, cy = H - R - 14 * sc - (S.touch ? 120 * sc : 0);
    const m = getMapCanvas(), zoom = sc * (S.bigMap ? 0.55 : 0.85);
    g.save(); g.beginPath(); g.arc(cx, cy, R, 0, 7); g.clip();
    g.fillStyle = '#d9d4c4'; g.fillRect(cx - R, cy - R, R * 2, R * 2);
    g.translate(cx, cy); g.rotate(Math.PI + P.h); g.scale(zoom, zoom);   // heading up
    g.translate(-(P.x - MAP.xmin) * PPM, -(P.z - MAP.zmin) * PPM);
    g.drawImage(m, 0, 0);
    const toM = (x, z) => [(x - MAP.xmin) * PPM, (z - MAP.zmin) * PPM];
    if (S.routePts && S.routePts.length > 1) {
      g.strokeStyle = '#1aa35a'; g.lineWidth = 7; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath();
      S.routePts.forEach((p, i) => { const [x, y] = toM(p[0], p[1]); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
    }
    for (const c of S.cars || []) { const [x, y] = toM(c.x, c.z); g.fillStyle = '#7a8088'; g.fillRect(x - 4, y - 4, 8, 8); }
    for (const k of S.markers || []) {
      const [x, y] = toM(k.x, k.z); g.fillStyle = k.color; g.strokeStyle = '#fff'; g.lineWidth = 3;
      g.beginPath(); g.arc(x, y, k.r ? k.r * PPM : 9, 0, 7); g.globalAlpha = k.r ? 0.35 : 1; g.fill(); g.globalAlpha = 1; if (!k.r) g.stroke();
    }
    for (const s of S.stars || []) { const [x, y] = toM(s[0], s[1]); g.fillStyle = '#ffcc00'; g.font = '20px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.save(); g.translate(x, y); g.rotate(-(Math.PI + P.h)); g.fillText('★', 0, 0); g.restore(); }
    if (S.home) { const [x, y] = toM(S.home.x, S.home.z); g.save(); g.translate(x, y); g.rotate(-(Math.PI + P.h)); g.font = '22px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('🏠', 0, 0); g.restore(); }
    g.restore();
    // player arrow
    g.fillStyle = '#1e7bff'; g.strokeStyle = '#fff'; g.lineWidth = 2 * sc;
    g.beginPath(); g.moveTo(cx, cy - 11 * sc); g.lineTo(cx + 8 * sc, cy + 8 * sc); g.lineTo(cx, cy + 4 * sc); g.lineTo(cx - 8 * sc, cy + 8 * sc); g.closePath(); g.fill(); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 4 * sc; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.stroke();
    // north
    // north (map up) after the heading-up rotation
    g.fillStyle = '#d33'; g.font = `bold ${13 * sc}px Arial`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('N', cx - Math.sin(P.h) * (R - 12 * sc), cy + Math.cos(P.h) * (R - 12 * sc));
  }
  // ---- money and wanted stars (top right, under the GPS card) ----
  if (S.money != null) {
    const x = W - 14 * sc, y = (S.nav ? 104 : 14) * sc;
    g.textAlign = 'right'; g.textBaseline = 'top'; g.font = `bold ${26 * sc}px Arial`;
    g.lineWidth = 5 * sc; g.strokeStyle = 'rgba(0,0,0,0.6)'; g.strokeText(`$${S.money}`, x, y); g.fillStyle = '#7dff8a'; g.fillText(`$${S.money}`, x, y);
    if (S.wanted != null) {
      g.font = `${24 * sc}px Arial`;
      const flash = S.wanted > 0 && Math.floor(performance.now() / 300) % 2;
      for (let i = 0; i < 3; i++) {
        const on = i < S.wanted;
        g.fillStyle = on ? (flash ? '#ffffff' : '#ffcc00') : 'rgba(255,255,255,0.25)';
        g.strokeText('★', x - i * 26 * sc, y + 34 * sc); g.fillText('★', x - i * 26 * sc, y + 34 * sc);
      }
    }
  }
  if (S.prompt) {
    g.font = `bold ${19 * sc}px Arial`; g.textAlign = 'center'; g.textBaseline = 'middle';
    const tw = g.measureText(S.prompt).width + 36 * sc, y = H * 0.68 - (S.touch ? 60 * sc : 0);
    g.fillStyle = 'rgba(20,24,34,0.85)'; rr(g, W / 2 - tw / 2, y - 21 * sc, tw, 42 * sc, 21 * sc); g.fill();
    g.strokeStyle = '#ffd23f'; g.lineWidth = 2 * sc; g.stroke();
    g.fillStyle = '#fff'; g.fillText(S.prompt, W / 2, y + 1 * sc);
  }
  // ---- speedometer (bottom right) ----
  if (!S.onFoot) {
    const R = 70 * sc, cx = W - R - 22 * sc, cy = H - R - 18 * sc - (S.touch ? 140 * sc : 0);
    g.fillStyle = 'rgba(20,24,34,0.8)'; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.fill();
    const over = mph > S.limit + 4;
    const max = S.maxMph || 80;
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 8 * sc; g.beginPath(); g.arc(cx, cy, R - 12 * sc, a0, a1); g.stroke();
    g.strokeStyle = over ? '#ff5544' : '#4cd964'; g.beginPath(); g.arc(cx, cy, R - 12 * sc, a0, a0 + (a1 - a0) * Math.min(1, mph / max)); g.stroke();
    // limit tick
    const la = a0 + (a1 - a0) * S.limit / max;
    g.strokeStyle = '#ffd23f'; g.lineWidth = 4 * sc; g.beginPath(); g.moveTo(cx + Math.cos(la) * (R - 20 * sc), cy + Math.sin(la) * (R - 20 * sc)); g.lineTo(cx + Math.cos(la) * (R - 3 * sc), cy + Math.sin(la) * (R - 3 * sc)); g.stroke();
    g.fillStyle = over ? '#ff7766' : '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `bold ${34 * sc}px Arial`; g.fillText(String(Math.round(mph)), cx, cy - 2 * sc);
    g.font = `${12 * sc}px Arial`; g.fillStyle = '#bbb'; g.fillText('mph', cx, cy + 22 * sc);
    g.font = `bold ${15 * sc}px Arial`; g.fillStyle = P.vf < -0.3 ? '#ffb000' : '#9fd8ff'; g.fillText(P.vf < -0.3 ? 'R' : 'D', cx, cy + 44 * sc);
    g.font = `${11 * sc}px Arial`; g.fillStyle = '#999'; g.fillText(`${Math.round(P.speed * 3.6)} km/h`, cx, cy - 30 * sc);
    if (S.health != null && S.health < 100) {
      const w = 110 * sc, hx = cx - w / 2, hy = cy - R - 16 * sc;
      g.fillStyle = 'rgba(0,0,0,0.6)'; rr(g, hx, hy, w, 9 * sc, 4 * sc); g.fill();
      g.fillStyle = S.health > 50 ? '#4cd964' : S.health > 20 ? '#ffb000' : '#ff4433'; rr(g, hx, hy, w * Math.max(0, S.health) / 100, 9 * sc, 4 * sc); g.fill();
      g.font = `${11 * sc}px Arial`; g.fillStyle = '#fff'; g.fillText('🔧', hx - 10 * sc, hy + 5 * sc);
    }
  }
  // ---- stars counter ----
  if (S.starCount != null) {
    g.fillStyle = 'rgba(20,24,34,0.7)'; rr(g, 14 * sc, (S.mission ? 100 : 12) * sc, 120 * sc, 36 * sc, 8 * sc); g.fill();
    g.fillStyle = '#ffcc00'; g.font = `bold ${18 * sc}px Arial`; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(`★ ${S.starCount}/20`, 26 * sc, (S.mission ? 118 : 30) * sc);
  }
}
function wrap(g, text, w) {
  const out = []; let line = '';
  const tokens = text.match(/[　-鿿＀-￯]|[^\s　-鿿＀-￯]+\s*|\s+/g) || [];
  for (const t of tokens) {
    if (g.measureText(line + t).width > w && line) { out.push(line.trim()); line = t.trimStart(); } else line += t;
  }
  if (line.trim()) out.push(line.trim());
  return out;
}
