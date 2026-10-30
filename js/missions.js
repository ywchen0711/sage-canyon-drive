// Missions. Each one gets the game API `M` (see main.js) in setup/update.
import { ADDRESSED, HOUSES, ROADS, EDGES, NODES, nearestRoad, route, edgePoint, terrainH } from './roads.js';
import { MAP } from './mapdata.js';

const rnd = Math.random;
export const SCHOOL_DROP = { x: -127.7, z: 91.0, h: Math.PI / 2 };
export const PARK_SPOT = { x: -233, z: 90 };
export const PIZZA_SHOP = { x: 262, z: -8, h: Math.PI / 2 };

const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
export const addr = h => `${h.num} ${h.street}`;
function housesNear(x, z, rmin, rmax, n, exclude = []) {
  const list = ADDRESSED.filter(h => { const d = Math.hypot(h.x - x, h.z - z); return d > rmin && d < rmax && !exclude.includes(h); });
  const out = [];
  while (out.length < n && list.length) out.push(list.splice(Math.floor(rnd() * list.length), 1)[0]);
  return out;
}
// the kerb in front of a house, where you stop
export function kerb(h) {
  const r = nearestRoad(h.drive[0], h.drive[1]);
  const back = Math.max(0, r.w / 2 - 2.6);
  return { x: r.qx + (h.drive[0] - r.qx) / (r.d || 1) * back, z: r.qz + (h.drive[1] - r.qz) / (r.d || 1) * back };
}
function stars3(score, a, b, c) { return score >= c ? 3 : score >= b ? 2 : score >= a ? 1 : 0; }
function penaltyLines(M) {
  const v = M.viol, L = [];
  if (v.speed) L.push(M.T(`超速 ${v.speed} 次`, `Speeding ×${v.speed}`));
  if (v.stop) L.push(M.T(`沒有停車再開 ${v.stop} 次`, `Rolled a stop sign ×${v.stop}`));
  if (v.red) L.push(M.T(`闖紅燈 ${v.red} 次`, `Ran a red light ×${v.red}`));
  if (v.crash) L.push(M.T(`碰撞 ${v.crash} 次`, `Bumps ×${v.crash}`));
  if (v.side) L.push(M.T(`開錯邊 ${v.side} 次`, `Wrong side of the road ×${v.side}`));
  if (v.ped) L.push(M.T(`嚇到行人 ${v.ped} 次`, `Scared pedestrians ×${v.ped}`));
  return L;
}
const penalty = v => v.speed * 5 + v.stop * 8 + v.red * 12 + v.crash * 6 + v.side * 4 + v.ped * 8;

// a run of pick-ups: kids waiting at houses; stop at the kerb to collect
function pickupRun(M, houses, opts) {
  const S = { list: houses.map(h => ({ h, k: kerb(h), done: false })), got: 0 };
  for (const p of S.list) {
    p.kid = M.person({ kid: true, backpack: ['#e85d5d', '#4c8be0', '#f2c230', '#5fbf6a'][Math.floor(rnd() * 4)] }, p.h.mailbox ? p.h.mailbox[0] : p.h.drive[0], p.h.mailbox ? p.h.mailbox[1] : p.h.drive[1]);
    p.kid.wave = true;
    p.mk = M.marker(p.k.x, p.k.z, { color: opts.color || '#ffd23f', label: opts.label ? opts.label(p) : addr(p.h) });
  }
  return S;
}
function pickupTick(M, S, dt, onGet) {
  let nearest = null, nd = 1e9;
  for (const p of S.list) {
    if (p.done) continue;
    const d = M.dist(p.k.x, p.k.z);
    if (d < nd) { nd = d; nearest = p; }
    p.kid.face(M.player.x, M.player.z);
    if (M.stoppedAt(p.k.x, p.k.z, 7)) {
      p.done = true; S.got++; p.mk.remove();
      p.kid.walkTo(M.player.x, M.player.z, () => p.kid.remove());
      M.sfx('door'); M.sfx('ding');
      onGet && onGet(p);
    }
  }
  if (nearest) M.gps(nearest.k.x, nearest.k.z);
  return nearest;
}

export const MISSIONS = [
  {
    id: 'learn', icon: '🚦', vehicle: 'suv', tod: 'day',
    zh: '學開車', en: 'Driving lesson',
    dzh: '從家裡出發，學會油門、煞車、轉彎和停車，跟著 GPS 開到 Sage Canyon School。', den: 'Leave home, learn throttle, brakes, steering and stop signs, and follow the GPS to Sage Canyon School.',
    setup(M) {
      M.startAtHome();
      const S = { step: 0, t: 0 };
      M.goal = M.marker(SCHOOL_DROP.x, SCHOOL_DROP.z, { color: '#4cd964', label: 'Sage Canyon School' });
      M.gps(SCHOOL_DROP.x, SCHOOL_DROP.z);
      M.tip(M.T('按 W（或 ↑）踩油門，S（或 ↓）煞車／倒車，A、D 轉方向盤。', 'W (or ↑) is the throttle, S (or ↓) brakes and reverses, A and D steer.'));
      return S;
    },
    update(M, S, dt) {
      S.t += dt;
      const sp = M.player.speed;
      if (S.step === 0 && sp > 3) { S.step = 1; M.tip(M.T('很好！跟著路上的綠色箭頭走，右上角會說下一個路口要往哪轉。', 'Nice! Follow the green arrows on the road; the panel at the top tells you the next turn.')); }
      if (S.step === 1 && S.t > 12) { S.step = 2; M.tip(M.T('看到紅色 STOP 牌子時，要在白線前完全停下來，再繼續開。', 'At a red STOP sign, come to a complete stop before the white line, then go.')); }
      if (S.step === 2 && S.t > 26) { S.step = 3; M.tip(M.T('住宅區速限 25 mph，學校附近也是 25 mph。右下角的速度表變紅就是太快了。', 'Neighbourhood streets are 25 mph, the school zone too. The speedometer turns red when you are too fast.')); }
      if (M.stoppedAt(SCHOOL_DROP.x, SCHOOL_DROP.z, 9)) {
        const p = penalty(M.viol);
        M.win(stars3(100 - p, 40, 70, 92), [M.T(`時間 ${fmt(S.t)}`, `Time ${fmt(S.t)}`), ...penaltyLines(M)]);
      }
    },
  },
  {
    id: 'school', icon: '🏫', vehicle: 'suv', tod: 'morning',
    zh: '送 Jasper 上學', en: 'Take Jasper to school',
    dzh: '早上 7:52，鐘聲 8:00 響！把 Jasper 從家裡安全準時送到學校門口。', den: '7:52 am and the bell rings at 8:00! Get Jasper from home to the school gate safely and on time.',
    setup(M) {
      M.startAtHome();
      const r = route(M.player.x, M.player.z, SCHOOL_DROP.x, SCHOOL_DROP.z);
      const S = { limit: Math.round(r.len / 9 + 25), t: 0 };
      M.goal = M.marker(SCHOOL_DROP.x, SCHOOL_DROP.z, { color: '#4cd964', label: M.T('學校門口', 'School gate') });
      M.gps(SCHOOL_DROP.x, SCHOOL_DROP.z);
      M.passenger('Jasper');
      M.tip(M.T(`${fmt(S.limit)} 之內到學校。別超速，STOP 要停！`, `Reach school within ${fmt(S.limit)}. No speeding, stop at every STOP!`));
      M.spawnSchoolKids();
      return S;
    },
    update(M, S, dt) {
      S.t += dt; M.clock(S.limit - S.t, 7 * 60 + 52 + S.t * 8 / S.limit);
      if (S.t > S.limit && !S.late) { S.late = true; M.sfx('bell'); M.msg(M.T('噹噹噹～上課鐘響了！還是要安全開到學校。', 'The bell! Still drive safely to school.')); }
      if (M.stoppedAt(SCHOOL_DROP.x, SCHOOL_DROP.z, 9)) {
        M.sfx('door');
        const p = penalty(M.viol) + (S.late ? 30 : 0);
        M.win(stars3(100 - p, 30, 65, 90), [M.T(`用時 ${fmt(S.t)}${S.late ? '（遲到）' : '（準時）'}`, `Time ${fmt(S.t)} ${S.late ? '(late)' : '(on time)'}`), ...penaltyLines(M)], M.T('Jasper：「謝謝！放學見～」', 'Jasper: "Thanks! See you after school!"'));
      }
    },
  },
  {
    id: 'carpool', icon: '🧒', vehicle: 'minivan', tod: 'morning',
    zh: '共乘接同學', en: 'Carpool',
    dzh: '開廂型車去接 3 位同學（順序自己決定），再一起到學校。停在他們家門口就會上車。', den: 'Pick up 3 classmates in any order, then drive everyone to school. Stop at their kerb and they hop in.',
    setup(M) {
      M.startAtHome();
      const kids = housesNear(M.player.x, M.player.z, 60, 420, 3);
      const S = pickupRun(M, kids, {});
      S.t = 0; S.phase = 0;
      M.passenger('Jasper');
      M.tip(M.T('黃色圓圈是同學家。停在圓圈裡，同學就會上車。', 'Yellow rings are classmates’ homes. Stop inside one and they climb in.'));
      return S;
    },
    update(M, S, dt) {
      S.t += dt; M.clock(null, null, `${S.got}/3`);
      if (S.phase === 0) {
        pickupTick(M, S, dt, () => { M.say(M.T('早安！', 'Good morning!')); });
        if (S.got === 3) { S.phase = 1; M.goal = M.marker(SCHOOL_DROP.x, SCHOOL_DROP.z, { color: '#4cd964', label: 'Sage Canyon School' }); M.gps(SCHOOL_DROP.x, SCHOOL_DROP.z); M.msg(M.T('大家都上車了！出發去學校。', 'Everyone’s aboard! Off to school.')); }
      } else if (M.stoppedAt(SCHOOL_DROP.x, SCHOOL_DROP.z, 9)) {
        const p = penalty(M.viol) + Math.max(0, S.t - 240) * 0.2;
        M.win(stars3(100 - p, 30, 65, 90), [M.T(`用時 ${fmt(S.t)}`, `Time ${fmt(S.t)}`), ...penaltyLines(M)]);
      }
    },
  },
  {
    id: 'pizza', icon: '🍕', vehicle: 'pizza', tod: 'sunset',
    zh: '披薩外送', en: 'Pizza delivery',
    dzh: '五個訂單！每個披薩只有幾分鐘的熱度，送晚了小費就變少。', den: 'Five orders! Each pizza only stays hot for a few minutes; late pizzas earn smaller tips.',
    setup(M) {
      M.startAt(PIZZA_SHOP.x, PIZZA_SHOP.z, PIZZA_SHOP.h);
      const S = { n: 0, tips: 0, t: 0, houses: housesNear(PIZZA_SHOP.x, PIZZA_SHOP.z, 80, 450, 5) };
      this.next(M, S);
      return S;
    },
    next(M, S) {
      const h = S.houses[S.n];
      S.cur = { h, k: kerb(h), heat: 0, max: Math.round(route(M.player.x, M.player.z, kerb(h).x, kerb(h).z).len / 9 + 25) };
      S.mk = M.marker(S.cur.k.x, S.cur.k.z, { color: '#ff8c3a', label: '🍕 ' + addr(h) });
      M.gps(S.cur.k.x, S.cur.k.z);
      M.msg(M.T(`訂單 ${S.n + 1}/5：${addr(h)}`, `Order ${S.n + 1}/5: ${addr(h)}`));
      M.say(M.T(`送到 ${addr(h)}`, `Deliver to ${addr(h)}`));
    },
    update(M, S, dt) {
      S.t += dt; S.cur.heat += dt;
      const left = S.cur.max - S.cur.heat;
      M.clock(left, null, `${S.n}/5  💵 $${S.tips}`);
      if (M.stoppedAt(S.cur.k.x, S.cur.k.z, 7)) {
        const tip = left > 0 ? 5 + Math.round(left / S.cur.max * 10) : 2;
        S.tips += tip; S.mk.remove(); M.sfx('coin');
        M.msg(M.T(`送達！小費 $${tip}`, `Delivered! Tip $${tip}`));
        S.n++;
        if (S.n >= 5) {
          const p = penalty(M.viol);
          return M.win(stars3(S.tips * 1.4 - p, 40, 75, 95), [M.T(`小費共 $${S.tips}`, `Tips $${S.tips}`), ...penaltyLines(M)]);
        }
        this.next(M, S);
      }
    },
  },
  {
    id: 'icecream', icon: '🍦', vehicle: 'icecream', tod: 'day',
    zh: '冰淇淋車', en: 'Ice cream truck',
    dzh: '音樂一響，小朋友就跑出來了！4 分鐘內賣冰淇淋給 10 個小朋友。開慢一點他們才追得上。', den: 'When the music plays the kids come running! Serve 10 children in 4 minutes. Drive slowly so they can catch you.',
    setup(M) {
      const h = ADDRESSED.find(h => h.street === 'Foxhound Way') || ADDRESSED[0];
      const k = kerb(h); M.startAt(k.x, k.z, null);
      M.jingle(true);
      const S = { t: 0, served: 0, kids: [], spawn: 0 };
      M.tip(M.T('小朋友在路邊揮手時，開到他旁邊停下來就能賣冰淇淋。', 'When a child waves at the kerb, stop beside them to serve an ice cream.'));
      return S;
    },
    update(M, S, dt) {
      S.t += dt; const left = 240 - S.t;
      M.clock(left, null, `🍦 ${S.served}/10`);
      S.spawn -= dt;
      if (S.kids.length < 3 && S.spawn <= 0) {
        S.spawn = 4;
        const [h] = housesNear(M.player.x, M.player.z, 40, 160, 1, S.kids.map(k => k.h));
        if (h) {
          const k = kerb(h);
          const kid = M.person({ kid: true }, h.mailbox ? h.mailbox[0] : k.x, h.mailbox ? h.mailbox[1] : k.z); kid.wave = true;
          S.kids.push({ h, k, kid, mk: M.marker(k.x, k.z, { color: '#f07cb0', label: '🍦', small: true }), life: 45 });
        }
      }
      let near = null, nd = 1e9;
      for (const c of [...S.kids]) {
        c.life -= dt; c.kid.face(M.player.x, M.player.z);
        const d = M.dist(c.k.x, c.k.z); if (d < nd) { nd = d; near = c; }
        if (M.stoppedAt(c.k.x, c.k.z, 8)) {
          S.served++; M.sfx('coin'); M.sfx('kid'); c.mk.remove(); c.kid.cheer(); setTimeout(() => c.kid.remove(), 1500);
          S.kids.splice(S.kids.indexOf(c), 1);
        } else if (c.life <= 0) { c.mk.remove(); c.kid.remove(); S.kids.splice(S.kids.indexOf(c), 1); }
      }
      if (near) M.gps(near.k.x, near.k.z);
      if (S.served >= 10 || left <= 0) {
        M.jingle(false);
        const sc = S.served * 10 - penalty(M.viol) + (S.served >= 10 ? Math.max(0, left) / 3 : 0);
        if (S.served < 5) return M.fail(M.T(`只賣出 ${S.served} 支，再試一次！`, `Only ${S.served} served, try again!`));
        M.win(stars3(sc, 50, 90, 115), [M.T(`賣出 ${S.served} 支冰淇淋`, `${S.served} ice creams served`), ...penaltyLines(M)]);
      }
    },
  },
  {
    id: 'trash', icon: '🗑️', vehicle: 'garbage', tod: 'morning',
    zh: '垃圾收集日', en: 'Trash day',
    dzh: '開大垃圾車，把 Harvest Run Dr 和 Whispering Hills Ln 的 12 個垃圾桶倒乾淨。垃圾桶要在車子右邊。', den: 'Drive the garbage truck and empty 12 bins on Harvest Run Dr and Whispering Hills Ln. Keep the bins on your right.',
    setup(M) {
      const list = ADDRESSED.filter(h => ['Whispering Hills Ln', 'Harvest Run Dr', 'Quaker Hill Ln'].includes(h.street) && h.z > 120);
      const pick = []; while (pick.length < 12 && list.length) pick.push(list.splice(Math.floor(rnd() * list.length), 1)[0]);
      const S = { t: 0, bins: pick.map(h => { const k = kerb(h); const b = M.bin(k.x, k.z, h); return { h, k, b, done: false }; }), got: 0 };
      const st = edgePoint(EDGES.find(e => ROADS[e.r].name === 'Harvest Run Dr' && e.len > 60), 10);
      M.startAt(-140, 105, Math.PI / 2 + 0.4);
      M.tip(M.T('把垃圾桶放在車子右邊，停下來，手臂就會自動把它倒進車裡。', 'Pull up with the bin on your right and stop: the arm empties it for you.'));
      return S;
    },
    update(M, S, dt) {
      S.t += dt; const left = 300 - S.t;
      M.clock(left, null, `🗑️ ${S.got}/12`);
      let near = null, nd = 1e9;
      for (const b of S.bins) {
        if (b.done) continue;
        const d = M.dist(b.b.x, b.b.z); if (d < nd) { nd = d; near = b; }
        if (M.player.speed < 0.8 && d < 6) {
          // must be on the right-hand side
          const fx = Math.sin(M.player.h), fz = Math.cos(M.player.h);
          const side = (b.b.x - M.player.x) * -fz + (b.b.z - M.player.z) * fx;
          if (side > 0.5) { b.done = true; S.got++; M.sfx('trash'); b.b.empty(); M.armLift(); }
          else if (!b.warned) { b.warned = true; M.msg(M.T('垃圾桶要在右邊喔！', 'The bin has to be on your right!')); }
        }
      }
      if (near) M.gps(near.b.x, near.b.z);
      if (S.got >= 12) return M.win(stars3(100 - penalty(M.viol) + left / 6, 40, 70, 95), [M.T(`用時 ${fmt(S.t)}`, `Time ${fmt(S.t)}`), ...penaltyLines(M)]);
      if (left <= 0) M.fail(M.T('時間到了，還有垃圾桶沒倒。', 'Time’s up with bins still full.'));
    },
  },
  {
    id: 'bus', icon: '🚌', vehicle: 'bus', tod: 'morning',
    zh: '校車司機', en: 'School bus driver',
    dzh: '開黃色校車到 4 個公車站接小朋友，最後送到學校。校車很長，轉彎要轉大一點！', den: 'Drive the yellow bus to 4 stops to pick up children, then to school. It’s long: take the corners wide!',
    setup(M) {
      const stops = [[-313.7, -177.3], [-84.3, -182.3], [275.3, -17.4], [-121.5, 223.2]].map(([x, z]) => { const r = nearestRoad(x, z); return { x: r.qx - r.tz * (r.w / 2 - 2.5), z: r.qz + r.tx * (r.w / 2 - 2.5) }; });
      const S = { t: 0, list: stops.map((p, i) => ({ p, n: 2 + (i % 3), done: false })), got: 0, kids: 0, phase: 0 };
      for (const s of S.list) {
        s.mk = M.marker(s.p.x, s.p.z, { color: '#ffd23f', label: `🚏 ${M.T('公車站', 'Bus stop')} ${S.list.indexOf(s) + 1}` });
        s.people = []; for (let i = 0; i < s.n; i++) { const k = M.person({ kid: true, backpack: '#4c8be0' }, s.p.x + (i - 1) * 0.9 + 2, s.p.z + 2.5); k.wave = true; s.people.push(k); }
      }
      M.startAt(-164.9, 104.2, Math.PI / 2);
      M.tip(M.T('停在公車站的黃色圓圈裡，紅色 STOP 臂會伸出來，小朋友就會上車。', 'Stop in the yellow ring at each bus stop: the STOP arm swings out and the children board.'));
      return S;
    },
    update(M, S, dt) {
      S.t += dt; M.clock(null, null, `🚏 ${S.got}/4  🧒 ${S.kids}`);
      if (S.phase === 0) {
        let near = null, nd = 1e9;
        for (const s of S.list) {
          if (s.done) continue;
          const d = M.dist(s.p.x, s.p.z); if (d < nd) { nd = d; near = s; }
          s.people.forEach(k => k.face(M.player.x, M.player.z));
          if (M.stoppedAt(s.p.x, s.p.z, 9)) {
            s.done = true; S.got++; S.kids += s.n; s.mk.remove(); M.busArm(true); M.sfx('door');
            s.people.forEach((k, i) => setTimeout(() => k.walkTo(M.player.x, M.player.z, () => k.remove()), i * 400));
            setTimeout(() => M.busArm(false), 2500);
          }
        }
        if (near) M.gps(near.p.x, near.p.z);
        if (S.got === 4) { S.phase = 1; M.goal = M.marker(SCHOOL_DROP.x, SCHOOL_DROP.z, { color: '#4cd964', label: 'Sage Canyon School' }); M.gps(SCHOOL_DROP.x, SCHOOL_DROP.z); M.msg(M.T('全部接到了！去學校。', 'Everyone’s on! To school.')); }
      } else if (M.stoppedAt(SCHOOL_DROP.x, SCHOOL_DROP.z, 12)) {
        M.win(stars3(100 - penalty(M.viol) - Math.max(0, S.t - 300) * 0.15, 30, 65, 90), [M.T(`載了 ${S.kids} 位小朋友，用時 ${fmt(S.t)}`, `${S.kids} children, ${fmt(S.t)}`), ...penaltyLines(M)]);
      }
    },
  },
  {
    id: 'test', icon: '📋', vehicle: 'sedan', tod: 'day',
    zh: '駕照考試', en: 'Driving test',
    dzh: '考官坐在旁邊！依序通過 6 個檢查點，遵守 STOP、紅綠燈、速限、靠右行駛。扣分超過 20 分就不及格。', den: 'The examiner is watching! Pass 6 checkpoints in order, obeying stop signs, lights, speed limits and keeping right. Lose more than 20 points and you fail.',
    setup(M) {
      const pts = [[-200, -95], [-60, -78], [205, -70], [179.2, 50.8], [142, 161.2], [-127.7, 91]].map(([x, z]) => { const r = nearestRoad(x, z); return { x: r.qx, z: r.qz }; });
      M.startAt(-282.7, -62, Math.PI / 2);
      const S = { pts, i: 0, t: 0 };
      S.mk = M.marker(pts[0].x, pts[0].z, { color: '#4cd964', label: '1' }); M.gps(pts[0].x, pts[0].z);
      M.passenger(M.T('考官', 'Examiner'));
      M.tip(M.T('考官會檢查：STOP 完全停車、紅燈停、速限 25/40 mph、靠右開、不要碰撞。', 'The examiner checks full stops, red lights, the 25/40 mph limits, keeping right, and no bumps.'));
      return S;
    },
    update(M, S, dt) {
      S.t += dt;
      const lost = penalty(M.viol);
      M.clock(null, null, `${M.T('分數', 'Score')} ${Math.max(0, 100 - lost)}`);
      if (lost > 20) return M.fail(M.T('扣分超過 20 分，這次沒有通過。下次加油！', 'More than 20 points lost: not this time. Try again!'));
      const p = S.pts[S.i];
      if (M.dist(p.x, p.z) < 9) {
        S.mk.remove(); M.sfx('ding'); S.i++;
        if (S.i >= S.pts.length) return M.win(stars3(100 - lost, 80, 90, 100), [M.T(`得分 ${100 - lost} / 100`, `Score ${100 - lost} / 100`), ...penaltyLines(M)], M.T('考官：「恭喜，你通過了！」', 'Examiner: "Congratulations, you passed!"'));
        const q = S.pts[S.i]; S.mk = M.marker(q.x, q.z, { color: '#4cd964', label: String(S.i + 1) }); M.gps(q.x, q.z);
      }
    },
  },
  {
    id: 'dog', icon: '🐶', vehicle: 'suv', tod: 'sunset',
    zh: '找走失的狗狗', en: 'Find the lost dog',
    dzh: '鄰居的狗狗 Mochi 跑進峽谷裡了！跟著叫聲（越近越大聲）開下去找牠，再把牠送回家。', den: 'The neighbours’ dog Mochi ran into the canyon! Follow the barking (louder when you are close), find him and bring him home.',
    setup(M) {
      // somewhere down in a canyon, not too deep
      let x, z, tries = 0;
      do { x = (rnd() - 0.5) * 700; z = (rnd() - 0.5) * 700; tries++; } while ((terrainH(x, z) > -3 || terrainH(x, z) < -14) && tries < 2000);
      M.startAtHome();
      const S = { t: 0, dog: M.dog(x, z), found: false, bark: 0, x, z };
      S.area = M.marker(x + (rnd() - 0.5) * 40, z + (rnd() - 0.5) * 40, { color: '#ffb000', label: M.T('最後看到 Mochi 的地方', 'Mochi last seen here'), r: 45 });
      M.gps(S.area.x, S.area.z);
      M.tip(M.T('峽谷裡是泥土路，開慢一點。聽聲音找狗狗！', 'The canyon is dirt: go slow and listen for the barking!'));
      return S;
    },
    update(M, S, dt) {
      S.t += dt; M.clock(null, null, S.found ? '🐶 ✓' : '🐶 ?');
      const d = M.dist(S.x, S.z);
      if (!S.found) {
        S.bark -= dt;
        if (S.bark <= 0) { S.bark = 2.2; M.sfx('bark', Math.max(0.1, 1 - d / 250)); }
        S.dog.look(M.player.x, M.player.z);
        if (d < 30) M.gps(S.x, S.z);
        if (d < 8 && M.player.speed < 2) {
          S.found = true; S.area.remove(); S.dog.remove(); M.sfx('bark'); M.sfx('ding');
          M.passenger('Mochi 🐶');
          M.msg(M.T('找到 Mochi 了！送牠回家。', 'Found Mochi! Take him home.'));
          M.goHome();
        }
      } else if (M.stoppedAtHome()) {
        M.win(stars3(100 - penalty(M.viol) - Math.max(0, S.t - 150) * 0.2, 30, 65, 90), [M.T(`用時 ${fmt(S.t)}`, `Time ${fmt(S.t)}`), ...penaltyLines(M)], M.T('鄰居：「謝謝你找到 Mochi！」', 'Neighbour: "Thank you for finding Mochi!"'));
      }
    },
  },
  {
    id: 'police', icon: '🚓', vehicle: 'police', tod: 'day',
    zh: '警車追逐', en: 'Police chase',
    dzh: '有輛紅色跑車在社區裡超速亂開！開警車追上去，碰它 3 下讓它停下來。', den: 'A red sports car is speeding around the neighbourhood! Chase it in the police car and bump it 3 times to stop it.',
    setup(M) {
      M.startAt(-60, -78, Math.PI / 2);
      M.siren(true);
      const S = { t: 0, hits: 0, cool: 0, sp: M.speeder() };
      M.tip(M.T('追逐時可以超速，但不要撞到別的車和房子。', 'You may speed during the chase, but don’t hit other cars or houses.'));
      M.rules(false);
      return S;
    },
    update(M, S, dt) {
      S.t += dt; S.cool -= dt;
      const left = 180 - S.t;
      M.clock(left, null, `🚨 ${S.hits}/3`);
      M.gps(S.sp.x, S.sp.z, true);
      if (S.sp.hitByPlayer && S.cool <= 0) { S.hits++; S.cool = 1.5; S.sp.hitByPlayer = false; M.sfx('crash', 0.6); M.msg(M.T(`碰到了！${S.hits}/3`, `Got it! ${S.hits}/3`)); }
      S.sp.hitByPlayer = false;
      if (S.hits >= 3) { S.sp.stop(); M.siren(false); return M.win(stars3(left, 20, 80, 120), [M.T(`用時 ${fmt(S.t)}`, `Time ${fmt(S.t)}`)], M.T('「逮到你了！以後不准在社區飆車！」', '"Gotcha! No speeding in the neighbourhood!"')); }
      if (left <= 0) { M.siren(false); M.fail(M.T('讓它跑掉了…再試一次！', 'It got away… try again!')); }
    },
  },
  {
    id: 'race', icon: '🏁', vehicle: 'sports', tod: 'sunset',
    zh: 'Carmel Mountain 計時賽', en: 'Carmel Mountain time trial',
    dzh: '開紅色跑車繞一圈：Carmel Mountain Rd → Harvest Run Dr → 學校 → Hunters Glen。依序穿過 10 個拱門，越快越好。', den: 'A lap in the sports car: Carmel Mountain Rd → Harvest Run Dr → the school → Hunters Glen. Pass 10 gates in order, as fast as you can.',
    setup(M) {
      const way = [[-330, -60], [-150, -80], [50, -73], [205, -72], [205, 30], [160, 150], [100, 215], [-20, 160], [-200, 100], [-340, -5]];
      const gates = way.map(([x, z]) => { const r = nearestRoad(x, z); return { x: r.qx, z: r.qz, h: Math.atan2(r.tx, r.tz), w: r.w }; });
      M.startAt(gates[9].x, gates[9].z, null);
      M.rules(false);
      const S = { gates, i: 0, t: 0, started: false };
      S.g = M.gate(gates[0]); M.gps(gates[0].x, gates[0].z);
      M.tip(M.T('計時賽不算超速，但撞到東西會損失時間。', 'Speeding doesn’t count here, but hitting things costs time.'));
      return S;
    },
    update(M, S, dt) {
      if (M.player.speed > 0.5) S.started = true;
      if (S.started) S.t += dt;
      M.clock(null, null, `🏁 ${S.i}/10  ⏱ ${S.t.toFixed(1)}s`);
      const g = S.gates[S.i];
      if (M.dist(g.x, g.z) < g.w / 2 + 3) {
        S.g.remove(); M.sfx('ding'); S.i++;
        if (S.i >= S.gates.length) {
          const t = S.t + M.viol.crash * 3;
          return M.win(t < 95 ? 3 : t < 120 ? 2 : 1, [M.T(`成績 ${t.toFixed(1)} 秒`, `Time ${t.toFixed(1)} s`), M.T('三星 < 95 秒，兩星 < 120 秒', '3★ under 95 s, 2★ under 120 s')]);
        }
        S.g = M.gate(S.gates[S.i]); M.gps(S.gates[S.i].x, S.gates[S.i].z);
      }
    },
  },
  {
    id: 'night', icon: '🌙', vehicle: 'minivan', tod: 'night',
    zh: '晚上接球隊', en: 'Night pick-up',
    dzh: '足球練習結束了！晚上開去 Sage Canyon 公園接 Jasper 和隊友，再一一送回家。', den: 'Soccer practice is over! Drive to Sage Canyon Park at night, pick up Jasper and his teammates, and take each one home.',
    setup(M) {
      M.startAtHome();
      const S = { t: 0, phase: 0, homes: housesNear(PARK_SPOT.x, PARK_SPOT.z, 120, 500, 2) };
      S.mk = M.marker(PARK_SPOT.x, PARK_SPOT.z, { color: '#4cd964', label: 'Sage Canyon Park' }); M.gps(PARK_SPOT.x, PARK_SPOT.z);
      S.kids = [0, 1, 2].map(i => { const k = M.person({ kid: true, shirt: '#d02020' }, PARK_SPOT.x + i * 1.2 - 1, PARK_SPOT.z - 6); k.wave = true; return k; });
      M.tip(M.T('晚上車燈會自動打開。按 L 可以開關車燈。', 'Your headlights are on at night. Press L to toggle them.'));
      return S;
    },
    update(M, S, dt) {
      S.t += dt; M.clock(null, null, ['⚽', '🏠 1/2', '🏠 2/2', '🏠'][S.phase]);
      if (S.phase === 0) {
        S.kids.forEach(k => k.face(M.player.x, M.player.z));
        if (M.stoppedAt(PARK_SPOT.x, PARK_SPOT.z, 10)) {
          S.mk.remove(); M.sfx('door'); S.kids.forEach((k, i) => setTimeout(() => k.walkTo(M.player.x, M.player.z, () => k.remove()), i * 300));
          M.passenger('Jasper + 2'); S.phase = 1; this.nextHome(M, S);
        }
      } else if (S.phase <= 2) {
        if (M.stoppedAt(S.k.x, S.k.z, 7)) { S.mk.remove(); M.sfx('door'); M.say(M.T('謝謝，晚安！', 'Thanks, good night!')); S.phase++; if (S.phase <= 2) this.nextHome(M, S); else { M.goHome(); } }
      } else if (M.stoppedAtHome()) {
        M.win(stars3(100 - penalty(M.viol) - Math.max(0, S.t - 300) * 0.15, 30, 65, 90), [M.T(`用時 ${fmt(S.t)}`, `Time ${fmt(S.t)}`), ...penaltyLines(M)]);
      }
    },
    nextHome(M, S) {
      const h = S.homes[S.phase - 1]; S.k = kerb(h);
      S.mk = M.marker(S.k.x, S.k.z, { color: '#ffd23f', label: addr(h) }); M.gps(S.k.x, S.k.z);
      M.msg(M.T(`送隊友回家：${addr(h)}`, `Drop a teammate at ${addr(h)}`));
    },
  },
  {
    id: 'parking', icon: '🅿️', vehicle: 'suv', tod: 'day',
    zh: '停車挑戰', en: 'Parking challenge',
    dzh: '把車停進學校停車場發亮的車位，車頭朝內、停在格子正中間。停得越準分數越高！', den: 'Park in the glowing bay in the school car park, nose in and centred. The neater, the better!',
    setup(M) {
      const bays = [];
      for (let i = 0; i < 11; i++) bays.push({ x: (570 + i * 9 + 4.5 - 676) * 0.62, z: (828 - 680) * 0.62, h: Math.PI });
      const bay = bays[2 + Math.floor(rnd() * 7)];
      M.startAt(-34.7, 142.6, -Math.PI / 2);
      const S = { bay, t: 0, still: 0, mk: M.bay(bay) };
      M.parkedCars(bays.filter(b => b !== bay));
      M.gps(bay.x, bay.z);
      M.tip(M.T('慢慢開，車子在格子裡停好 2 秒就算完成。', 'Go slowly. Hold still inside the bay for 2 seconds to finish.'));
      return S;
    },
    update(M, S, dt) {
      S.t += dt; M.clock(90 - S.t);
      const P = M.player, b = S.bay;
      const dx = P.x - b.x, dz = P.z - b.z;
      const off = Math.hypot(dx, dz);
      let ang = Math.abs(((P.h - b.h) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
      if (off < 2.2 && P.speed < 0.2) S.still += dt; else S.still = 0;
      if (S.still > 2) {
        S.mk.remove();
        const score = 100 - off * 30 - ang * 60 - M.viol.crash * 15;
        return M.win(stars3(score, 40, 65, 85), [M.T(`偏離中心 ${off.toFixed(2)} m，角度 ${(ang * 57.3).toFixed(0)}°`, `${off.toFixed(2)} m off centre, ${(ang * 57.3).toFixed(0)}° off`), ...(M.viol.crash ? [M.T(`碰撞 ${M.viol.crash} 次`, `Bumps ×${M.viol.crash}`)] : [])]);
      }
      if (S.t > 90) M.fail(M.T('時間到！', 'Time’s up!'));
    },
  },
];

export const FREE = {
  id: 'free', icon: '⭐', zh: '自由開車 + 找星星', en: 'Free drive + star hunt',
  dzh: '想去哪就去哪！社區裡藏了 20 顆星星，有些在峽谷裡。找齊它們！', den: 'Go anywhere you like! 20 stars are hidden around the neighbourhood, some down in the canyons. Find them all!',
};
// fixed star spots: road ends, canyon floors, the park, the school yard
export const STARS = (() => {
  const out = [];
  const R = (() => { let s = 99; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  for (const n of MAP.dead.slice(0, 8)) out.push([NODES[n][0], NODES[n][1]]);
  while (out.length < 15) {
    const x = (R() - 0.5) * 760, z = (R() - 0.5) * 760, h = terrainH(x, z);
    if (h < -4 && h > -15 && out.every(p => Math.hypot(p[0] - x, p[1] - z) > 90)) out.push([x, z]);
  }
  out.push([-233, 60], [-110, 20], [-30, -10], [262, -8], [300, -330]);
  return out.slice(0, 20);
})();
