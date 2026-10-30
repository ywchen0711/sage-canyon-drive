// Synthesised sound: engine, tyres, horn, bumps, chimes, jingles and the GPS voice.
let ctx = null, master = null, muted = false;
let eng = null, tyre = null, siren = null, jingle = null;

export function audioInit() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain(); master.gain.value = muted ? 0 : 0.8; master.connect(ctx.destination);
  // engine: two detuned saws through a low-pass
  const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
  o1.type = 'sawtooth'; o2.type = 'square'; lp.type = 'lowpass'; lp.frequency.value = 400; g.gain.value = 0;
  o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(master); o1.start(); o2.start();
  eng = { o1, o2, lp, g };
  // tyre squeal: band-passed noise
  const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = nb.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const ns = ctx.createBufferSource(); ns.buffer = nb; ns.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 6;
  const tg = ctx.createGain(); tg.gain.value = 0; ns.connect(bp); bp.connect(tg); tg.connect(master); ns.start();
  // rumble on dirt
  const lp2 = ctx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 160;
  const rg = ctx.createGain(); rg.gain.value = 0; ns.connect(lp2); lp2.connect(rg); rg.connect(master);
  tyre = { tg, rg, noise: nb };
}
export function setMute(m) { muted = m; if (master) master.gain.value = m ? 0 : 0.8; if (m) speechSynthesis.cancel(); }
export const isMuted = () => muted;

export function engineSound(speed, throttle, kind, drift, rough) {
  if (!ctx) return;
  const big = kind === 'bus' || kind === 'garbage';
  const gear = Math.min(5, Math.floor(speed / 9));
  const rpm = 0.25 + ((speed - gear * 9) / 9) * 0.5 + throttle * 0.25;
  const base = big ? 34 : kind === 'sports' ? 62 : 48;
  const f = base * (1 + rpm * (big ? 1.2 : 2.2));
  const t = ctx.currentTime;
  eng.o1.frequency.setTargetAtTime(f, t, 0.05); eng.o2.frequency.setTargetAtTime(f * 0.5 * 1.01, t, 0.05);
  eng.lp.frequency.setTargetAtTime(220 + throttle * 700 + speed * 12, t, 0.08);
  eng.g.gain.setTargetAtTime(0.05 + throttle * 0.07 + (big ? 0.04 : 0), t, 0.1);
  tyre.tg.gain.setTargetAtTime(Math.min(0.18, Math.max(0, drift - 2.5) * 0.03), t, 0.05);
  tyre.rg.gain.setTargetAtTime(rough ? Math.min(0.35, speed * 0.03) : 0, t, 0.1);
}
export function engineOff() { if (eng) { eng.g.gain.setTargetAtTime(0, ctx.currentTime, 0.1); tyre.tg.gain.setTargetAtTime(0, ctx.currentTime, 0.05); tyre.rg.gain.setTargetAtTime(0, ctx.currentTime, 0.05); } }

function tone(f, dur, type = 'sine', vol = 0.2, when = 0, slide) {
  if (!ctx) return;
  const t = ctx.currentTime + when, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t); if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
}
function noise(dur, f, vol, when = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + when, s = ctx.createBufferSource(); s.buffer = tyre.noise;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = f;
  const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(lp); lp.connect(g); g.connect(master); s.start(t, Math.random()); s.stop(t + dur);
}
let hornOn = null;
export function horn(on, kind) {
  if (!ctx) return;
  if (on && !hornOn) {
    const g = ctx.createGain(); g.gain.value = 0.12; g.connect(master);
    const big = kind === 'bus' || kind === 'garbage';
    const os = [big ? 220 : 400, big ? 277 : 500].map(f => { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f; o.connect(g); o.start(); return o; });
    hornOn = { g, os };
  } else if (!on && hornOn) { hornOn.os.forEach(o => o.stop()); hornOn.g.disconnect(); hornOn = null; }
}
export function sfx(name, v = 1) {
  if (!ctx) return;
  switch (name) {
    case 'bump': noise(0.25, 300, 0.5 * v); tone(70, 0.2, 'sine', 0.4 * v, 0, 40); break;
    case 'crash': noise(0.5, 900, 0.7 * v); tone(90, 0.4, 'square', 0.15 * v, 0, 40); noise(0.4, 3000, 0.15 * v, 0.05); break;
    case 'ding': tone(988, 0.15, 'sine', 0.25); tone(1319, 0.35, 'sine', 0.25, 0.1); break;
    case 'coin': tone(1047, 0.08, 'square', 0.12); tone(1568, 0.25, 'square', 0.12, 0.07); break;
    case 'star': [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.25, 'triangle', 0.18, i * 0.07)); break;
    case 'win': [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, i === 5 ? 0.6 : 0.18, 'triangle', 0.22, i * 0.13)); break;
    case 'fail': [392, 330, 262].forEach((f, i) => tone(f, 0.35, 'sawtooth', 0.12, i * 0.22)); break;
    case 'warn': tone(880, 0.12, 'square', 0.12); tone(880, 0.12, 'square', 0.12, 0.18); break;
    case 'tick': tone(1800, 0.02, 'square', 0.05); break;
    case 'beep': tone(1200, 0.08, 'sine', 0.1); break;
    case 'bark': tone(420, 0.09, 'sawtooth', 0.25, 0, 260); tone(400, 0.1, 'sawtooth', 0.22, 0.16, 240); break;
    case 'bell': for (let i = 0; i < 6; i++) tone(1400, 0.12, 'square', 0.08, i * 0.09); break;
    case 'trash': noise(0.6, 600, 0.5); tone(120, 0.3, 'square', 0.1, 0.2, 80); break;
    case 'door': noise(0.12, 500, 0.4); tone(160, 0.08, 'sine', 0.2); break;
    case 'kid': tone(700, 0.12, 'triangle', 0.15, 0, 900); tone(900, 0.15, 'triangle', 0.15, 0.12, 1100); break;
  }
}
export function sirenOn(on) {
  if (!ctx) return;
  if (on && !siren) {
    const o = ctx.createOscillator(), g = ctx.createGain(), l = ctx.createOscillator(), lg = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.value = 700; l.frequency.value = 0.6; lg.gain.value = 300;
    l.connect(lg); lg.connect(o.frequency); g.gain.value = 0.06; o.connect(g); g.connect(master); o.start(); l.start();
    siren = { o, l, g };
  } else if (!on && siren) { siren.o.stop(); siren.l.stop(); siren = null; }
}
// "Turkey in the Straw"-style ice cream jingle, played as a loop
export function jingleOn(on) {
  if (!ctx) return;
  if (on && !jingle) {
    const notes = [523, 523, 587, 659, 659, 587, 523, 440, 392, 392, 440, 523, 587, 523, 440, 392, 523, 523, 587, 659, 784, 659, 587, 523, 587, 659, 587, 523, 440, 523, 0, 0];
    let i = 0;
    jingle = setInterval(() => { const f = notes[i++ % notes.length]; if (f) { tone(f * 2, 0.16, 'triangle', 0.07); tone(f * 4, 0.08, 'sine', 0.03); } }, 190);
  } else if (!on && jingle) { clearInterval(jingle); jingle = null; }
}
export function say(text, lang = 'zh') {
  if (muted || !window.speechSynthesis) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang === 'zh' ? 'zh-TW' : 'en-US'; u.rate = 1.05;
  speechSynthesis.speak(u);
}
