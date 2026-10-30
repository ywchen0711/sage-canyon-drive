// Looks: environment lighting, post-processing, and foliage made of leaf cards.
import * as THREE from '../lib/three.module.min.js';
import { EffectComposer } from '../lib/addons/EffectComposer.js';
import { RenderPass } from '../lib/addons/RenderPass.js';
import { UnrealBloomPass } from '../lib/addons/UnrealBloomPass.js';
import { OutputPass } from '../lib/addons/OutputPass.js';
import { ShaderPass } from '../lib/addons/ShaderPass.js';

const rnd = (() => { let s = 777; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
function canvas(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); return c; }
function tex(w, h, draw, srgb = true) { const t = new THREE.CanvasTexture(canvas(w, h, draw)); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }

// ---------- environment map from the sky (gives cars and windows something to reflect) ----------
export function makeEnv(renderer, skyMesh) {
  const pm = new THREE.PMREMGenerator(renderer);
  const s = new THREE.Scene();
  const sky = skyMesh.clone(); sky.material = skyMesh.material; s.add(sky);
  // a warm ground plane so reflections are not all sky
  const ground = new THREE.Mesh(new THREE.CircleGeometry(3000, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#7b7462' }));
  ground.position.y = -20; s.add(ground);
  const rt = pm.fromScene(s, 0.02, 1, 5000);
  pm.dispose();
  return rt.texture;
}

// ---------- post-processing: soft bloom and a gentle colour grade ----------
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, sat: { value: 1.14 }, contrast: { value: 1.12 }, warm: { value: 0.03 }, vig: { value: 0.32 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float sat, contrast, warm, vig; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb = mix(vec3(l), c.rgb, sat);
      c.rgb = (c.rgb - 0.5) * contrast + 0.5;
      c.rgb += vec3(warm, warm * 0.4, -warm);
      vec2 d = vUv - 0.5; c.rgb *= 1.0 - dot(d, d) * vig * 1.6;
      gl_FragColor = vec4(clamp(c.rgb, 0.0, 1.0), c.a);
    }`,
};
export function makeComposer(renderer, scene, camera) {
  const size = renderer.getSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.22, 0.45, 0.9);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  return { composer, bloom, grade };
}

// ---------- leaves ----------
// drawn light and slightly green so per-instance colours set the actual hue
export const leafTex = tex(256, 256, (g, w, h) => {
  g.clearRect(0, 0, w, h);
  for (let i = 0; i < 220; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 118, x = w / 2 + Math.cos(a) * r, y = h / 2 + Math.sin(a) * r;
    const L = 12 + rnd() * 12, W = L * (0.38 + rnd() * 0.2);
    const v = 150 + rnd() * 105;
    g.save(); g.translate(x, y); g.rotate(rnd() * Math.PI * 2);
    g.fillStyle = `rgb(${v * 0.82 | 0},${v | 0},${v * 0.62 | 0})`;
    g.beginPath(); g.ellipse(0, 0, L / 2, W / 2, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = `rgba(40,60,20,0.35)`; g.lineWidth = 1; g.beginPath(); g.moveTo(-L / 2, 0); g.lineTo(L / 2, 0); g.stroke();
    g.restore();
  }
});
export const frondTex = tex(256, 64, (g, w, h) => {
  g.clearRect(0, 0, w, h);
  g.strokeStyle = '#d8e6b0'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
  for (let x = 6; x < w - 4; x += 5) {
    const len = (h / 2 - 3) * Math.sin(Math.PI * Math.min(1, x / w * 1.1)) * (0.8 + rnd() * 0.2);
    const v = 170 + rnd() * 70;
    g.strokeStyle = `rgb(${v * 0.8 | 0},${v | 0},${v * 0.55 | 0})`; g.lineWidth = 2.4;
    for (const s of [-1, 1]) { g.beginPath(); g.moveTo(x, h / 2); g.quadraticCurveTo(x + 6, h / 2 + s * len * 0.6, x + 12, h / 2 + s * len); g.stroke(); }
  }
});
export const barkTex = tex(64, 256, (g, w, h) => {
  g.fillStyle = '#7a634c'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 400; i++) { const v = 70 + rnd() * 70; g.fillStyle = `rgba(${v},${v * 0.82 | 0},${v * 0.65 | 0},0.6)`; g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 3, 4 + rnd() * 14); }
});
barkTex.wrapS = barkTex.wrapT = THREE.RepeatWrapping;

// a crown of crossed leaf cards inside a unit ellipsoid, with normals pointing out from the centre
export function crownGeometry(cards = 16, cardSize = 1.05, squash = 0.85) {
  const P = [], N = [], U = [];
  for (let i = 0; i < cards; i++) {
    const th = rnd() * Math.PI * 2, ph = Math.acos(2 * rnd() - 1), r = 0.45 + 0.5 * Math.cbrt(rnd());
    const cx = Math.sin(ph) * Math.cos(th) * r, cy = Math.cos(ph) * r * squash, cz = Math.sin(ph) * Math.sin(th) * r;
    // random card orientation
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * Math.PI, rnd() * Math.PI, rnd() * Math.PI));
    const ax = new THREE.Vector3(1, 0, 0).applyQuaternion(q).multiplyScalar(cardSize / 2);
    const ay = new THREE.Vector3(0, 1, 0).applyQuaternion(q).multiplyScalar(cardSize / 2);
    const c = new THREE.Vector3(cx, cy, cz);
    const corners = [c.clone().sub(ax).sub(ay), c.clone().add(ax).sub(ay), c.clone().add(ax).add(ay), c.clone().sub(ax).add(ay)];
    const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (const k of [0, 1, 2, 0, 2, 3]) {
      const v = corners[k]; P.push(v.x, v.y, v.z); U.push(...uvs[k]);
      const n = v.clone().add(new THREE.Vector3(0, 0.25, 0)).normalize(); N.push(n.x, n.y, n.z);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  return g;
}
// palm crown: drooping fronds, each a bent strip
export function palmGeometry(fronds = 11) {
  const P = [], N = [], U = [];
  for (let f = 0; f < fronds; f++) {
    const a = f / fronds * Math.PI * 2 + rnd() * 0.3, ca = Math.cos(a), sa = Math.sin(a);
    const up = 0.35 + rnd() * 0.5, len = 3.2 + rnd() * 0.8, W = 0.75;
    const seg = 5, pts = [];
    for (let i = 0; i <= seg; i++) { const t = i / seg; pts.push([ca * len * t, up * t * 2 - t * t * 2.4, sa * len * t]); }
    for (let i = 0; i < seg; i++) {
      const [x0, y0, z0] = pts[i], [x1, y1, z1] = pts[i + 1];
      const sx = -sa * W / 2, sz = ca * W / 2;
      const quad = [[x0 - sx, y0, z0 - sz, i / seg, 0], [x1 - sx, y1, z1 - sz, (i + 1) / seg, 0], [x1 + sx, y1, z1 + sz, (i + 1) / seg, 1], [x0 + sx, y0, z0 + sz, i / seg, 1]];
      for (const k of [0, 1, 2, 0, 2, 3]) { const q = quad[k]; P.push(q[0], q[1], q[2]); U.push(q[3], q[4]); N.push(0, 1, 0); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  return g;
}
export function foliageMaterial(map) {
  const m = new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85, metalness: 0 });
  return m;
}
export function foliageDepth(map) {
  return new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.5 });
}
