// Full-screen map: drag to pan, wheel or pinch to zoom, tap to set a waypoint.
import { MAP } from './mapdata.js';
import { getMapCanvas } from './hud.js';

const PPM = 2;
export function createBigMap(opts) {
  const wrap = document.getElementById('bigmap');
  const cv = document.getElementById('bigmapCanvas');
  const g = cv.getContext('2d');
  const S = { open: false, cx: 0, cz: 0, zoom: 1, drag: null, pinch: null, moved: false };
  const size = () => { const r = cv.getBoundingClientRect(); cv.width = r.width * devicePixelRatio; cv.height = r.height * devicePixelRatio; };
  const toScreen = (x, z) => [cv.width / 2 + (x - S.cx) * S.zoom * devicePixelRatio, cv.height / 2 + (z - S.cz) * S.zoom * devicePixelRatio];
  const toWorld = (sx, sy) => [S.cx + (sx * devicePixelRatio - cv.width / 2) / (S.zoom * devicePixelRatio), S.cz + (sy * devicePixelRatio - cv.height / 2) / (S.zoom * devicePixelRatio)];
  function draw() {
    if (!S.open) return;
    const d = opts.data();
    g.fillStyle = '#cfc9b6'; g.fillRect(0, 0, cv.width, cv.height);
    const m = getMapCanvas();
    const [x0, y0] = toScreen(MAP.xmin, MAP.zmin);
    const sc = S.zoom * devicePixelRatio / PPM;
    g.imageSmoothingEnabled = true;
    g.drawImage(m, x0, y0, m.width * sc, m.height * sc);
    const dpr = devicePixelRatio;
    // route
    if (d.route && d.route.length > 1) {
      g.strokeStyle = '#1aa35a'; g.lineWidth = 6 * dpr; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath();
      d.route.forEach((p, i) => { const [sx, sy] = toScreen(p[0], p[1]); i ? g.lineTo(sx, sy) : g.moveTo(sx, sy); }); g.stroke();
    }
    // blips
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const b of d.blips) {
      const [sx, sy] = toScreen(b.x, b.z);
      g.fillStyle = 'rgba(255,255,255,0.85)'; g.beginPath(); g.arc(sx, sy, 15 * dpr, 0, 7); g.fill();
      g.font = `${18 * dpr}px Arial`; g.fillText(b.icon, sx, sy + 1 * dpr);
      if (S.zoom > 1.4 && b.label) { g.font = `bold ${11 * dpr}px Arial`; g.fillStyle = '#333'; g.fillText(b.label, sx, sy + 24 * dpr); }
    }
    for (const s of d.stars || []) { const [sx, sy] = toScreen(s[0], s[1]); g.font = `${20 * dpr}px Arial`; g.fillStyle = '#e0a800'; g.fillText('★', sx, sy); }
    if (d.waypoint) {
      const [sx, sy] = toScreen(d.waypoint.x, d.waypoint.z);
      g.fillStyle = '#c03ad6'; g.beginPath(); g.moveTo(sx, sy); g.arc(sx, sy - 22 * dpr, 11 * dpr, Math.PI * 0.8, Math.PI * 2.2); g.closePath(); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(sx, sy - 22 * dpr, 4.5 * dpr, 0, 7); g.fill();
    }
    // the player
    const [px, py] = toScreen(d.x, d.z);
    g.save(); g.translate(px, py); g.rotate(Math.PI - d.h);
    g.fillStyle = '#1e7bff'; g.strokeStyle = '#fff'; g.lineWidth = 3 * dpr;
    g.beginPath(); g.moveTo(0, -14 * dpr); g.lineTo(10 * dpr, 10 * dpr); g.lineTo(0, 5 * dpr); g.lineTo(-10 * dpr, 10 * dpr); g.closePath(); g.fill(); g.stroke();
    g.restore();
    // north arrow and scale
    g.fillStyle = '#c33'; g.font = `bold ${16 * dpr}px Arial`; g.fillText('N ▲', cv.width - 40 * dpr, 30 * dpr);
    const bar = 100 * S.zoom * dpr; g.fillStyle = '#333'; g.fillRect(20 * dpr, cv.height - 30 * dpr, bar, 4 * dpr);
    g.font = `${12 * dpr}px Arial`; g.textAlign = 'left'; g.fillText('100 m', 20 * dpr, cv.height - 42 * dpr);
    requestAnimationFrame(draw);
  }
  function open() {
    S.open = true; wrap.classList.remove('hidden'); size();
    const d = opts.data(); S.cx = d.x; S.cz = d.z;
    S.zoom = Math.min(cv.width, cv.height) / devicePixelRatio / (MAP.xmax - MAP.xmin) * 1.05;
    S.cx = (S.cx + (MAP.xmin + MAP.xmax) / 2) / 2; S.cz = (S.cz + (MAP.zmin + MAP.zmax) / 2) / 2;
    draw();
  }
  function close() { S.open = false; wrap.classList.add('hidden'); opts.onClose && opts.onClose(); }
  cv.addEventListener('pointerdown', e => { S.drag = { x: e.clientX, y: e.clientY, cx: S.cx, cz: S.cz }; S.moved = false; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', e => {
    if (!S.drag || S.pinch) return;
    const dx = e.clientX - S.drag.x, dy = e.clientY - S.drag.y;
    if (Math.hypot(dx, dy) > 6) S.moved = true;
    S.cx = S.drag.cx - dx / S.zoom; S.cz = S.drag.cz - dy / S.zoom;
  });
  cv.addEventListener('pointerup', e => {
    if (S.drag && !S.moved && !S.pinch) { const r = cv.getBoundingClientRect(); const [x, z] = toWorld(e.clientX - r.left, e.clientY - r.top); opts.onWaypoint(x, z); }
    S.drag = null;
  });
  cv.addEventListener('wheel', e => { e.preventDefault(); S.zoom = Math.min(8, Math.max(0.4, S.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15))); }, { passive: false });
  cv.addEventListener('touchstart', e => { if (e.touches.length === 2) { const [a, b] = e.touches; S.pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), z: S.zoom }; } }, { passive: true });
  cv.addEventListener('touchmove', e => { if (S.pinch && e.touches.length === 2) { const [a, b] = e.touches; S.zoom = Math.min(8, Math.max(0.4, S.pinch.z * Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / S.pinch.d)); } }, { passive: true });
  cv.addEventListener('touchend', e => { if (e.touches.length < 2) setTimeout(() => { S.pinch = null; }, 50); });
  document.getElementById('bmClose').onclick = close;
  document.getElementById('bmClear').onclick = () => opts.onWaypoint(null);
  document.getElementById('bmPlus').onclick = () => { S.zoom = Math.min(8, S.zoom * 1.3); };
  document.getElementById('bmMinus').onclick = () => { S.zoom = Math.max(0.4, S.zoom / 1.3); };
  document.getElementById('bmMe').onclick = () => { const d = opts.data(); S.cx = d.x; S.cz = d.z; };
  addEventListener('resize', () => { if (S.open) size(); });
  return { open, close, get isOpen() { return S.open; } };
}
