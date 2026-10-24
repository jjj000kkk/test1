// node tools/mechanics-check.mjs：用真實物理檢查每種平台的效果（沒有畫面）
import { CONFIG, FX, AUDIO } from '../js/config.js';
import { Kind } from '../js/kinds.js';
import { createPlatform, Portal } from '../js/platform-types.js';
import { PlatformGenerator } from '../js/platforms.js';
import { Player } from '../js/player.js';
import { stepWorld } from '../js/world.js';
import { seededRandom } from '../js/utils.js';

let fails = 0;
const check = (name, ok, info = '') => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : '')); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

function world(platforms, { x, onIdx = 0, H = 700 } = {}) {
  const pl = new Player();
  const st = { player: pl, platforms, rise: 0, H, floor: 0, depth: 0, over: false, fxRng: seededRandom(5) };
  const g = platforms[onIdx];
  pl.x = x ?? g.cx - pl.w / 2; pl.y = g.y - pl.h; pl.ground = g;
  return st;
}
const run = (st, secs, axis = 0, ev = {}) => { for (let i = 0; i < secs * 120 && !st.over; i++) stepWorld(st, 1 / 120, axis, ev); };
const P = (kind, i, x, y, o) => createPlatform(kind, i, x, y, o);

// 滑冰：按一下就以固定速度滑出去；不看力道；放開不減速；踩到一般平台才恢復
{
  const mk = () => world([P(Kind.ICE, 1, 0, 300, {})], { x: 4 });
  const weak = mk(); run(weak, 0.4, 0.2);
  const strong = mk(); run(strong, 0.4, 1);
  check('滑冰：按多大力都以同一個速度滑出去', near(weak.player.vx, FX.ICE_SLIDE_SPEED, 0.01) && near(strong.player.vx, FX.ICE_SLIDE_SPEED, 0.01), `弱=${weak.player.vx.toFixed(1)} 強=${strong.player.vx.toFixed(1)}`);
  check('滑冰：滑行速度是原本中速（142）的 1.5 倍', near(FX.ICE_SLIDE_SPEED, 142 * 1.5, 1), `speed=${FX.ICE_SLIDE_SPEED}`);
  const tap = mk(); run(tap, 0.15, 1); const vTap = tap.player.vx; run(tap, 0.1, 0);
  check('滑冰：放開按鍵速度不變', near(tap.player.vx, vTap, 0.01) && vTap > 0, `vx=${vTap.toFixed(1)}→${tap.player.vx.toFixed(1)}`);
  const rev = world([P(Kind.ICE, 1, 100, 300, {})], { x: 130 }); rev.player.vx = FX.ICE_SLIDE_SPEED; rev.player.slide = true; run(rev, 0.75, -0.3);
  check('滑冰：按反方向以同樣速度反向滑', near(rev.player.vx, -FX.ICE_SLIDE_SPEED, 0.01), `vx=${rev.player.vx.toFixed(1)}`);
  const st2 = world([P(Kind.ICE, 1, 0, 300), P(Kind.NORMAL, 2, 90, 300)], { x: 40 });
  st2.player.vx = 120; st2.player.slide = true;
  run(st2, 0.6, 0);
  check('滑冰：滑到一般平台後恢復減速', st2.player.ground && st2.player.ground.kind === Kind.NORMAL && Math.abs(st2.player.vx) < 1, `ground=${st2.player.ground && st2.player.ground.kind} vx=${st2.player.vx.toFixed(1)}`);
  const st3 = world([P(Kind.ICE, 1, 0, 300)], { x: 40 });
  st3.player.vx = -150; st3.player.slide = true;
  run(st3, 1, 0);
  check('滑冰：撞牆停下', st3.player.x === 0 && st3.player.vx === 0, `x=${st3.player.x}`);
  const st4 = world([P(Kind.ICE, 1, 100, 300)], { x: 150 });
  st4.player.vx = 100; st4.player.slide = true;
  run(st4, 0.4, 0);
  check('滑冰：滑出邊緣的空中也保留速度', st4.player.ground === null && near(st4.player.vx, 100, 0.01), `vx=${st4.player.vx.toFixed(1)}`);
}
// 泥沼
{
  const st = world([P(Kind.SLIME, 1, 100, 300)]);
  run(st, 0.2, 1);
  check('泥沼：速度降到約 38%', near(st.player.vx / CONFIG.MOVE_SPEED, 0.5 / 1.3, 0.01), `ratio=${(st.player.vx / CONFIG.MOVE_SPEED).toFixed(3)}`);
}
// 滾輪
{
  const st = world([P(Kind.CONVEYOR, 1, 100, 300, { dir: 1 })]);
  const x0 = st.player.x; run(st, 0.4, 0);
  check('滾輪：每秒推 72px', near((st.player.x - x0) / 0.4, 72, 1), `Δx=${(st.player.x - x0).toFixed(1)}`);
}
// 彈簧
{
  const sp = P(Kind.SPRING, 1, 100, 500);
  const st = world([sp]); st.player.y = 450; st.player.ground = null; st.player.vy = 200;
  let vy = null; run(st, 0.3, 0, { spring: () => { vy = st.player.vy; } });
  const base = Math.sqrt(2 * CONFIG.GRAVITY * 150);
  check('彈簧：衝力是原本的 1.25 倍', vy !== null && near(-vy / base, 1.25, 0.001), `vy=${vy && vy.toFixed(0)} base=${base.toFixed(0)}`);
  check('彈簧：上方安全判定 1.8 倍彈跳高度', near(FX.SPRING_GUARD_RATIO * FX.SPRING_HEIGHT, 1.8 * 150 * 1.25 * 1.25, 0.5), `reach=${(FX.SPRING_GUARD_RATIO * FX.SPRING_HEIGHT).toFixed(0)}px`);
  const sp2 = P(Kind.SPRING, 1, 100, 140);
  const st2 = world([sp2]); st2.player.y = 100; st2.player.ground = null; st2.player.vy = 100;
  run(st2, 0.5);
  check('彈簧：靠近天花板時彈跳高度被壓低，不會撞進刺針', st2.player.y >= CONFIG.CEILING_Y && st2.player.hp === CONFIG.MAX_HP_UNITS, `y=${st2.player.y.toFixed(0)}`);
}
// 碎石
{
  const c = P(Kind.FLIP, 1, 100, 300);
  const st = world([c]);
  stepWorld(st, 1 / 120, 0, {}); c.onLand(st.player, { emit() {} });
  run(st, 0.55); const before = c.solid;
  run(st, 0.1); 
  check('碎石：0.6 秒內可站、之後碎裂', before === true && c.solid === false && c.state === 'gone', `state=${c.state}`);
  check('碎石：沒有進度條所需欄位被渲染用（progress 0~1）', c.progress === 0 || (c.progress >= 0 && c.progress <= 1));
}
// 傳送門：0.3 秒預告 → 傳到目標安全平台正上方 200px 的高空
{
  const H = 1000;
  // 14 層、每層 70px 往下排；portalAt 是傳送門所在的層；kinds 依序循環使用
  const build = (kinds, portalAt) => kinds.map((k, i) => P(i === portalAt ? Kind.PORTAL : k, i, 20 + ((i * 37) % 250), 130 + i * 70));
  const useOnce = (kinds, portalAt, seed) => {
    const plats = build(kinds, portalAt);
    const portal = plats[portalAt];
    const st = world(plats, { H, onIdx: portalAt });
    st.fxRng = seededRandom(seed);
    const ev = { portalArm: () => { ev.armed = (ev.armed || 0) + 1; }, portal: () => { ev.tp = true; } };
    portal.onLand(st.player, { emit: (n, p) => ev[n] && ev[n](p), platforms: st.platforms, H, rise: 0, random: st.fxRng, teleport() {}, teleportAir() {} });
    return { st, portal, ev };
  };
  const N = Kind.NORMAL; const SP = Kind.SPIKES; const FL = Kind.FLIP; const PH = Kind.PHANTOM;
  const mixed = [N, N, N, N, N, SP, N, FL, N, PH, N, N, N, N];
  const idxOf = (portal, pd) => pd.dest.index - portal.index;
  const stats = { up: 0, down: 0, bad: 0, ceil: 0, range: 0, n: 0 };
  for (let t = 1; t <= 400; t++) {
    const { portal } = useOnce(mixed, 8, t);
    const pd = portal.pending; if (!pd) continue;
    stats.n++; (pd.dest.index < portal.index ? stats.up++ : stats.down++);
    if (pd.dest.isSpikes || [FL, PH, Kind.PORTAL].includes(pd.dest.kind)) stats.bad++;
    if (pd.dest.y - CONFIG.CEILING_Y < FX.PORTAL_CEILING_SAFE) stats.ceil++;
    if (idxOf(portal, pd) < -FX.PORTAL_UP_RANGE) stats.range++;
  }
  check('傳送門：約 70% 往上、30% 往下', stats.up / stats.n > 0.62 && stats.up / stats.n < 0.78 && stats.down > 30, JSON.stringify(stats));
  check('傳送門：目標只會是安全平台（沒有尖刺 / 碎石 / 幻影 / 傳送門）', stats.bad === 0 && stats.n > 100);
  check('傳送門：目標離天花板尖刺至少 250px', stats.ceil === 0);
  check('傳送門：往上只找上方 6 層之內', stats.range === 0);

  // 保證發動：嚴格條件（離天花板 250px、畫面下緣 110px、落下路徑無尖刺）都找不到目標時，逐級放寬，踩了一定會傳
  {
    const kinds = [N, N, N, FL, Kind.PORTAL, N, N, N, N, N];
    let armed = 0; let relaxed = 0; let safe = 0; const Hs = 480;
    for (let t = 1; t <= 200; t++) {
      const plats = kinds.map((k, i) => P(k, i, 20 + ((i * 37) % 250), 130 + i * 70));
      const portal = plats[4]; const st = world(plats, { H: Hs, onIdx: 4 }); st.fxRng = seededRandom(t);
      portal.onLand(st.player, { emit() {}, platforms: st.platforms, H: Hs, rise: 0, random: st.fxRng, teleport() {}, teleportAir() {} });
      if (!portal.pending) continue;
      armed++; if (portal.pending.level > 0) relaxed++;
      if (Portal.canLandOn(portal.pending.dest)) safe++;
      let sp = null;
      for (let i = 0; i < 60 && st.player.warp; i++) { st.platforms.forEach((q) => q.update(1 / 120)); stepWorld(st, 1 / 120, 0, {}); }
      sp = st.player; if (st.player.warp || sp.y < CONFIG.CEILING_Y) armed--;
    }
    check('傳送門：嚴格條件找不到目標時逐級放寬，踩了一定會傳送', armed === 200 && relaxed === 200 && safe === 200, `armed=${armed} relaxed=${relaxed} safe=${safe}`);
  }
  // 端到端：玩家從上方掉到傳送門上（走真正的落地判定），一定會發出預告、消失、傳送
  {
    let ok = 0; const Nn = 150;
    for (let t = 1; t <= Nn; t++) {
      const plats = mixed.map((k, i) => P(i === 8 ? Kind.PORTAL : k, i, 20 + ((i * 37) % 250), 130 + i * 70));
      const portal = plats[8];
      const st = world(plats, { H, onIdx: 7 }); st.fxRng = seededRandom(t);
      const pl = st.player; pl.ground = null; pl.x = portal.cx - pl.w / 2; pl.y = portal.y - pl.h - 60; pl.vy = 0;
      const got = { arm: 0, tp: 0 };
      const ev = { portalArm: () => got.arm++, portal: () => got.tp++ };
      for (let i = 0; i < 120 * 1.5 && got.tp === 0 && !st.over; i++) { plats.forEach((q) => q.update(1 / 120)); stepWorld(st, 1 / 120, 0, ev); }
      if (got.arm === 1 && got.tp === 1 && portal.dead && !pl.warp) ok++;
    }
    check('傳送門：從空中真正踩上去（落地判定）一定會預告並傳送', ok === Nn, `${ok}/${Nn}`);
  }
  // 落點安全保護：離天花板尖刺 < 100px 且正下方安全平台 < 150px → 往正下方移 150px（X 不變）
  {
    const dest = P(N, 5, 100, 350); const mid = P(N, 4, 90, 250);
    const near = Portal.spawnPoint(dest, [mid, dest]);
    const plain = Portal.spawnPoint(P(N, 5, 100, 640), [P(N, 5, 100, 640)]);
    check('傳送門：落點太靠天花板且下方平台太近 → 往下移 150px，X 不變', near.shifted && near.blocked === false && near.x === plain.x - 0 + (near.x - plain.x) && near.y === 120 + FX.PORTAL_NEAR_FLOOR && near.x === Portal.spawnPoint(dest).x, `y=${near.y} shifted=${near.shifted}`);
    check('傳送門：離天花板夠遠就不移位', plain.shifted === false && plain.y === 640 - FX.PORTAL_DROP_HEIGHT - CONFIG.PLAYER_H);
    const farDest = P(N, 5, 100, 420); const noMid = Portal.spawnPoint(farDest, [farDest]);
    check('傳送門：只有離天花板近（下方平台夠遠）不移位', !noMid.shifted || farDest.y - FX.PORTAL_DROP_HEIGHT - CONFIG.PLAYER_H - CONFIG.CEILING_Y >= FX.PORTAL_NEAR_CEILING, `y=${noMid.y} shifted=${noMid.shifted}`);
    const clampDest = P(N, 5, 100, 330); const cd = Portal.spawnPoint(clampDest, [clampDest]);
    check('傳送門：移位後不會穿過目標平台', cd.y + CONFIG.PLAYER_H <= clampDest.y - 10 + 0.001, `feet=${cd.y + CONFIG.PLAYER_H} dest=${clampDest.y}`);
    const blocker = P(N, 6, 90, 380);
    const bl = Portal.spawnPoint(dest, [mid, dest, blocker]);
    const wide = P(N, 7, 0, 380); wide.w = 400;
    const bl2 = Portal.spawnPoint(dest, [mid, dest, wide]);
    check('傳送門：整排都被擋住時才標記被擋住', bl.shifted && bl.blocked === false && bl2.shifted && bl2.blocked === true);
    const portal = P(Kind.PORTAL, 9, 100, 600);
    check('傳送門：整排被擋住的目標在嚴格 / 放寬條件下不選，最後一級才接受（保證發動）', !portal.usable(dest, [mid, dest, wide], 900, 0, 0) && !portal.usable(dest, [mid, dest, wide], 900, 0, 1) && portal.usable(dest, [mid, dest, wide], 900, 0, 3));
  }
  // 原子化傳送：動畫顯示的位置 = 實際傳送位置，角色只被設定一次位置，不會先到 A 又瞬移到 B
  {
    let same = 0; let once = 0; let n = 0; let moved = 0;
    const Hs = 760;
    for (let t = 1; t <= 150; t++) {
      // 目標離天花板近、中間還有安全平台，會觸發落點保護的版型
      const kinds2 = [N, N, N, N, N, N, N, N];
      const plats = kinds2.map((k, i) => P(i === 5 ? Kind.PORTAL : k, i, 20 + ((i * 37) % 250), 150 + i * 60));
      const portal = plats[5]; const st = world(plats, { H: Hs, onIdx: 5 }); st.fxRng = seededRandom(t); st.rise = 40;
      portal.onLand(st.player, { emit() {}, platforms: st.platforms, H: Hs, rise: 40, random: st.fxRng, teleport() {}, teleportAir() {} });
      if (!portal.pending) continue;
      n++;
      const target0 = portal.targetPoint(); const pl = st.player; let changes = 0; let last = { x: pl.x, y: pl.y }; let atTp = null;
      if (portal.pending.ox !== undefined) moved++;
      for (let i = 0; i < 80 && (pl.warp || atTp === null); i++) {
        st.platforms.forEach((q) => q.update(1 / 120)); stepWorld(st, 1 / 120, 0, { portal: () => { atTp = { x: pl.x + pl.w / 2, y: pl.y + pl.h / 2 }; } });
        if (pl.x !== last.x || pl.y !== last.y) { changes++; last = { x: pl.x, y: pl.y }; if (atTp === null) changes += 100; }
        if (atTp !== null) break;
      }
      // 傳送那一步位置一次到位；因為所有平台一起往上捲，動畫位置要加上這 0.3 秒捲動的距離
      if (atTp && near(atTp.x, target0.x, 0.5)) same++;
      if (changes === 1) once++;
    }
    check('傳送門：最終落點在踩上時就算好（動畫位置 = 實際傳送位置，X 一致）', n > 100 && same === n, `${same}/${n}`);
    check('傳送門：傳送時角色位置只被設定一次（等待期間不動、傳送後才第一次改變）', n > 100 && once === n, `${once}/${n}`);
  }
  // 落點下方被擋住：左右找「下方 150px 無平台」的位置
  {
    const dest = P(N, 5, 100, 350); const mid = P(N, 4, 90, 250); const blocker = P(N, 6, 90, 380);
    const sp = Portal.spawnPoint(dest, [mid, dest, blocker]);
    const w = CONFIG.PLAYER_W; const feet = sp.y + CONFIG.PLAYER_H;
    const clear = ![mid, blocker].some((p) => sp.x + w > p.footprint.x - 2 && sp.x < p.footprint.x + p.footprint.w + 2 && p.y > feet && p.y < feet + 150);
    check('傳送門：下方被擋住時改到左右「下方 150px 無平台」的位置', sp.shifted && sp.blocked === false && clear && sp.x !== Portal.spawnPoint(dest).x, `x=${sp.x} blocked=${sp.blocked}`);
  }
  // 雷射：光束長度 1.3 倍；同時最多 2 個
  {
    check('雷射：光束長度是原本 190 的 1.3 倍', near(FX.LASER_LENGTH, 190 * 1.3, 0.01), `len=${FX.LASER_LENGTH}`);
    const la = P(Kind.LASER, 1, 100, 200, { phase: 0 });
    check('雷射：光束實際長度 = LASER_LENGTH', near(la.beam.bottom - la.beam.top, FX.LASER_LENGTH, 0.01));
    let maxLasers = 0; let produced = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const gen = new PlatformGenerator(CONFIG.WORLD_W, { rng: seededRandom(seed) });
      gen.createFirst(300); gen.index = FX.ENDGAME_FLOOR + 20;
      const active = []; let y = 300;
      for (let i = 0; i < 600; i++) {
        y += CONFIG.PLATFORM_GAP;
        const p = gen.next(y, 60, active); active.push(p);
        if (active.length > 12) active.shift();
        if (p.kind === Kind.LASER) produced++;
        maxLasers = Math.max(maxLasers, active.filter((q) => q.kind === Kind.LASER).length);
      }
    }
    check('雷射：同時存在最多 2 個（仍然會生成）', maxLasers === 2 && produced > 20, `max=${maxLasers} produced=${produced}`);
  }
  // 退回機制：上方沒有合法的安全平台 → 一律往下；下方沒有 → 往上
  {
    let up = 0; let n = 0;
    for (let t = 1; t <= 200; t++) { const { portal } = useOnce(mixed, 1, t); const pd = portal.pending; if (!pd) continue; n++; if (pd.dest.index < portal.index) up++; }
    check('傳送門：上方（天花板太近）找不到合法平台就往下', n > 100 && up === 0, `up=${up}/${n}`);
    let down = 0; n = 0;
    for (let t = 1; t <= 200; t++) { const { portal } = useOnce(mixed, 13, t); const pd = portal.pending; if (!pd) continue; n++; if (pd.dest.index > portal.index) down++; }
    check('傳送門：下方沒有平台就往上', n > 100 && down === 0, `down=${down}/${n}`);
  }
  // 上方 6 層內全是尖刺 / 碎石：改往下
  {
    const bad = [N, N, N, SP, FL, SP, FL, SP, FL, N, N, N, N, N];
    let up = 0; let n = 0;
    for (let t = 1; t <= 200; t++) { const { portal } = useOnce(bad, 9, t); const pd = portal.pending; if (!pd) continue; n++; if (pd.dest.index < portal.index) up++; }
    check('傳送門：上方 3~6 層內沒有安全平台就自動改往下', n > 100 && up === 0, `up=${up}/${n}`);
  }
  // 預告與傳送
  {
    const { st, portal, ev } = useOnce(mixed, 8, 3);
    check('傳送門：踩上後先安排傳送並發出預告事件', portal.pending && ev.armed === 1 && portal.solid === false && st.player.warp === portal);
    const y0 = st.player.y;
    for (let i = 0; i < 20; i++) { st.platforms.forEach((p) => p.update(1 / 120)); stepWorld(st, 1 / 120, 1, {}); }
    check('傳送門：傳送中角色定住，不被重力與按鍵影響', st.player.y === y0 && st.player.vy === 0);
    const dest = portal.pending.dest;
    let tpAt = null; let t = 20 / 120;
    for (; t < 0.6 && !ev.tp; t += 1 / 120) { st.platforms.forEach((p) => p.update(1 / 120)); stepWorld(st, 1 / 120, 0, { portal: () => { ev.tp = true; tpAt = t; } }); }
    check('傳送門：約 0.3 秒後才傳送', tpAt !== null && near(tpAt, 0.3, 0.03), `tpAt=${tpAt}`);
    const pl = st.player;
    check('傳送門：傳到目標平台中心 X、表面上方 200px（腳底）', near(pl.x + pl.w / 2, dest.cx, 1) && near(pl.y + pl.h, dest.y - FX.PORTAL_DROP_HEIGHT, 1.5), `x=${(pl.x + pl.w / 2).toFixed(1)} cx=${dest.cx.toFixed(1)} 腳底=${(pl.y + pl.h).toFixed(1)} 目標面=${dest.y.toFixed(1)}`);
    check('傳送門：傳送瞬間速度歸零、清掉著地狀態', pl.vx === 0 && pl.ground === null && portal.dead === true && pl.warp === null);
  }
  // 傳過去後自由落下，不是瞬間貼在平台上；落下途中被平台接住或繼續落下，不會當場死亡
  {
    let fell = 0; let n = 0; let died = 0;
    for (let t = 1; t <= 120; t++) {
      const { st, portal } = useOnce(mixed, 8, t); if (!portal.pending) continue; n++;
      const dest = portal.pending.dest;
      const tp = (() => { for (let i = 0; i < 60 && st.player.warp; i++) stepWorld(st, 1 / 120, 0, {}); })();
      if (!st.player.ground && st.player.vy === 0 && st.player.y + st.player.h < dest.y - 10) fell++;
      for (let i = 0; i < 240 && !st.over; i++) stepWorld(st, 1 / 120, 0, {});
      if (st.over && st.cause && st.cause.isSpikes) died++;
    }
    check('傳送門：傳過去在高空、之後自由落下', n > 50 && fell === n, `${fell}/${n}`);
    check('傳送門：落下的路徑上沒有尖刺平台（沒有被刺死）', died === 0, `died=${died}`);
  }
  // 落下路徑上有尖刺平台的目標會被排除
  {
    const plats = [P(N, 0, 100, 140), P(SP, 1, 100, 210), P(N, 2, 100, 400), P(Kind.PORTAL, 3, 100, 600)];
    const portal = plats[3]; const st = world(plats, { H, onIdx: 3 }); st.fxRng = seededRandom(1);
    const d = portal.destinations(st.platforms, H, 0);
    check('傳送門：目標上方 200px 的落下路徑有尖刺平台就不選它', !d.up.includes(plats[2]) && !d.up.some((p) => p.isSpikes), `up=${d.up.map((p) => p.index)}`);
  }
}
// 雷射
{
  const la = P(Kind.LASER, 1, 100, 200, { phase: 0 });
  const plats = [la, P(Kind.NORMAL, 2, 100, 300)];
  const st = world(plats, { onIdx: 1 });
  let hurts = 0; const ev = { hurt: () => hurts++ };
  run(st, 1.9, 0, ev);
  const offHurts = hurts;
  check('雷射：關閉的 2 秒不傷人', offHurts === 0);
  run(st, 1.2, 0, ev);
  check('雷射：開啟的 1 秒扣血', hurts === 1 && st.player.hp === CONFIG.MAX_HP_UNITS - CONFIG.SPIKE_DAMAGE, `hp=${st.player.hp}`);
  const st2 = world([P(Kind.LASER, 1, 100, 200, { phase: 2.2 }), P(Kind.NORMAL, 2, 100, 300)], { onIdx: 0 });
  let h2 = 0; run(st2, 0.6, 0, { hurt: () => h2++ });
  check('雷射：站在雷射平台上不會被打到', h2 === 0);
  const st3 = world([P(Kind.LASER, 1, 100, 200, { phase: 2.2 }), P(Kind.NORMAL, 2, 250, 300)], { onIdx: 1 });
  let h3 = 0; run(st3, 0.6, 0, { hurt: () => h3++ });
  check('雷射：不在光束正下方不會受傷', h3 === 0);
}
// 幻影
{
  const ph = P(Kind.PHANTOM, 1, 100, 300, { phase: 0 });
  const seq = [];
  for (let i = 0; i < 600; i++) { ph.update(1 / 120); if (i % 120 === 59) seq.push(ph.solid ? 1 : 0); } // 在 0.5、1.5、2.5…秒取樣
  check('幻影：每 1 秒在實體與虛無之間切換', seq.join('') === '10101', `seq=${seq.join('')}`);
  const st = world([P(Kind.PHANTOM, 1, 100, 300, { phase: 0.9 })]);
  run(st, 0.3);
  check('幻影：變虛無時站在上面會掉下去', st.player.ground === null);
}
// 泥沼：>= 300F 減速效果減半
{
  const lo = P(Kind.SLIME, 100, 100, 300); const hi = P(Kind.SLIME, 300, 100, 300);
  check('泥沼：< 300F 倍率約 0.3846（≈ 73 px/s）', near(lo.speedScale, 0.5 / 1.3, 1e-9) && near(CONFIG.MOVE_SPEED * lo.speedScale, 73.08, 0.05), `scale=${lo.speedScale.toFixed(4)}`);
  check('泥沼：>= 300F 倍率 0.5385（≈ 102.3 px/s，減速 61.54% → 46.155%）', near(hi.speedScale, 0.5385, 0.0001) && near(CONFIG.MOVE_SPEED * hi.speedScale, 102.31, 0.05), `scale=${hi.speedScale.toFixed(4)} v=${(CONFIG.MOVE_SPEED * hi.speedScale).toFixed(2)}`);
  const sim = (floor) => { const st = world([P(Kind.SLIME, floor, 100, 300)]); run(st, 0.3, 1); return st.player.vx; };
  check('泥沼：真實物理 299F 與 300F 的最高水平速度', near(sim(299), CONFIG.MOVE_SPEED * 0.5 / 1.3, 0.5) && near(sim(300), CONFIG.MOVE_SPEED * 0.5385, 0.5), `${sim(299).toFixed(1)} / ${sim(300).toFixed(1)}`);
}
// 自訂語音 Audio Manager（用假的 AudioContext 驗證節點與排程）
{
  const { AudioManager, voiceRate, crushLevel, timeStretch } = await import('../js/audio.js');
  const mk = () => {
    const log = { src: [], osc: [], shaper: [], biquad: [], gains: [] };
    const param = (v = 0) => ({ value: v, calls: [], setValueAtTime(x, t) { this.last = [x, t]; this.calls.push(['set', x, t]); }, linearRampToValueAtTime(x, t) { this.ramp = [x, t]; this.calls.push(['ramp', x, t]); }, cancelScheduledValues() {}, exponentialRampToValueAtTime() {} });
    const node = (extra) => ({ connect() {}, disconnect() {}, ...extra });
    const ctx = {
      currentTime: 1, sampleRate: 1000, state: 'running', destination: node(),
      createGain() { const g = node({ gain: param(1) }); log.gains.push(g); return g; },
      createBuffer(ch, len, sr) { const d = Array.from({ length: ch }, () => new Float32Array(len)); return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: (c) => d[c], copyToChannel: (a, c) => d[c].set(a) }; },
      createBufferSource() { const s = node({ buffer: null, playbackRate: param(1), starts: [], stops: [], start(...a) { s.starts.push(a); }, stop(t) { s.stops.push(t); } }); log.src.push(s); return s; },
      createOscillator() { const o = node({ type: 'sine', frequency: param(440), start() {}, stop() {} }); log.osc.push(o); return o; },
      createWaveShaper() { const w = node({ curve: null }); log.shaper.push(w); return w; },
      createBiquadFilter() { const b = node({ type: '', frequency: { value: 0 } }); log.biquad.push(b); return b; },
    };
    return { ctx, log };
  };
  const setup = () => {
    const { ctx, log } = mk();
    const m = new AudioManager();
    m.ctx = ctx; m.out = ctx.createGain(); m.enabled = true; m.voiceUnlocked = true;
    const buf = ctx.createBuffer(1, 1500, 1000); buf.getChannelData(0).forEach((_, i, a) => { a[i] = (i + 1) / 1500; });
    for (const k of ['safe', 'hurt']) m.buffers.set(`${k}-A`, buf);
    log.src.length = 0; log.gains.length = 0;
    return { m, ctx, log, buf };
  };
  const plat = (kind) => ({ kind });
  const rnd = Math.random;
  Math.random = () => 0.99; // 不觸發 15% 口吃

  check('語音音高：線性 1.0 → 1.8x（B0 / B200 / B400 / 之後不再升）', voiceRate(0) === 1 && near(voiceRate(200), 1.4, 1e-9) && near(voiceRate(400), 1.8, 1e-9) && voiceRate(5000) === 1.8);
  check('電音強度：min(層數/100, 4)', near(crushLevel(200), 2, 1e-9) && crushLevel(9999) === 4);
  {
    const { m, log } = setup(); m.play('safe', 200, { platform: plat(Kind.NORMAL), hp: 6 });
    check('自訂語音：播放速率 = 基礎音高（B200 = 1.4）', near(log.src[0].playbackRate.value, 1.4, 1e-9) && log.src.length === 1 && log.shaper.length === 0 && log.biquad.length === 0);
  }
  {
    const { m, log } = setup(); m.play('safe', 400, { platform: plat(Kind.NORMAL), hp: 6 }); m.play('tick', 400); m.play('go', 400);
    const osc = log.osc.map((o) => o.frequency.last && o.frequency.last[0]);
    check('內建音效固定音高：B400 的合成音效頻率沒有被拉高', osc.includes(440) && osc.includes(880), `freq=${osc.join(',')}`);
    const { m: m2, log: log2 } = setup(); m2.voiceUnlocked = false; m2.play('safe', 400, { platform: plat(Kind.NORMAL), hp: 6 });
    check('內建預設踩踏聲：B400 仍是 660Hz 起、原速', log2.osc.length > 0 && log2.osc[0].frequency.last[0] === 660, `f=${log2.osc[0] && log2.osc[0].frequency.last[0]}`);
  }
  {
    const { m, log, ctx } = setup();
    for (let i = 0; i < 3; i++) m.play('safe', 10, { platform: plat(Kind.NORMAL), hp: 6 });
    const [s1, s2, s3] = log.src;
    check('最多 3 個語音：前 3 個都同時播放，沒有被切掉', m.voiceState.voices.length === 3 && [s1, s2, s3].every((s) => s.stops.length === 0) && [s1, s2, s3].every((s) => near(s.starts[0][0], ctx.currentTime, 1e-9)));
    m.play('safe', 10, { platform: plat(Kind.NORMAL), hp: 6 });
    const s4 = log.src[3];
    check('最多 3 個語音：第 4 個來時，最早的 0.03 秒內淡出並 stop()', s1.stops.some((x) => near(x, ctx.currentTime + 0.03, 1e-9)) && s2.stops.length === 0 && s3.stops.length === 0, `s1.stops=${s1.stops}`);
    check('最多 3 個語音：新語音馬上開始，陣列長度仍是 3，最早的被移除', near(s4.starts[0][0], ctx.currentTime, 1e-9) && m.voiceState.voices.length === 3 && !m.voiceState.voices.some((h) => h.endAt === ctx.currentTime + 0.03 && false));
    const g0 = log.gains[0];
    check('最多 3 個語音：被切掉的語音音量在 0.03 秒內降到 0', g0.gain.ramp && g0.gain.ramp[0] === 0 && near(g0.gain.ramp[1], ctx.currentTime + 0.03, 1e-9));
    s4.onended();
    check('語音播完（onended）自動從陣列移除，釋放額度', m.voiceState.voices.length === 2);
    ctx.currentTime = 100; m.play('safe', 10, { platform: plat(Kind.NORMAL), hp: 6 });
    check('已經播完的語音不佔額度（時間過了就清掉）', m.voiceState.voices.length === 1);
  }
  {
    const { m, log, buf } = setup(); m.play('safe', 300, { platform: plat(Kind.PORTAL), hp: 6 });
    const b = log.src[0].buffer;
    check('倒放：>= 300F 踩傳送門 100% 倒放（聲道陣列反轉）', b !== buf && b.getChannelData(0)[0] === buf.getChannelData(0)[1499] && b.getChannelData(0)[1499] === buf.getChannelData(0)[0]);
    const { m: m2, log: l2, buf: b2 } = setup(); m2.play('safe', 299, { platform: plat(Kind.PORTAL), hp: 6 });
    const { m: m3, log: l3, buf: b3 } = setup(); m3.play('safe', 400, { platform: plat(Kind.NORMAL), hp: 6 });
    check('倒放：< 300F 或不是傳送門不倒放', l2.src[0].buffer === b2 && l3.src[0].buffer === b3);
  }
  {
    const { m, log, ctx } = setup(); ctx.currentTime = 10;
    m.play('safe', 200, { platform: plat(Kind.LASER), hp: 6 });
    const f = log.osc[0] && log.osc[0].frequency.value;
    check('電音 Buff：踩雷射平台後語音套用 WaveShaper 位元壓縮 + 30~100Hz 環形調變', log.shaper.length === 1 && log.shaper[0].curve && log.osc.length === 1 && f >= 30 && f <= 100, `ring=${f}Hz`);
    const step = new Set(Array.from(log.shaper[0].curve).map((x) => x.toFixed(4))).size;
    ctx.currentTime = 14; m.play('safe', 200, { platform: plat(Kind.NORMAL), hp: 6 });
    check('電音 Buff：5 秒內踩任何平台都套用', log.shaper.length === 2);
    ctx.currentTime = 15.5; m.play('safe', 200, { platform: plat(Kind.NORMAL), hp: 6 });
    check('電音 Buff：超過 5 秒就消失', log.shaper.length === 2);
    const q = (fl) => { const s = setup(); s.m.play('safe', fl, { platform: plat(Kind.LASER), hp: 6 }); return new Set(Array.from(s.log.shaper[0].curve).map((x) => x.toFixed(4))).size; };
    check('電音強度隨樓層增加（位元越少、階數越少）', q(400) < q(100) && q(100) < q(20), `${q(20)} → ${q(100)} → ${q(400)}`);
    const { m: mh, log: lh } = setup(); mh.play('hurt', 200, { platform: plat(Kind.LASER), hp: 4 });
    check('電音 Buff：被雷射光束打到也會觸發', lh.shaper.length === 1);
  }
  {
    Math.random = () => 0.05; // < 0.4：碎石觸發口吃；rnd < 0.5 → 重複 2 次
    const { m, log } = setup(); m.play('safe', 100, { platform: plat(Kind.FLIP), hp: 6 });
    const segs = log.src.filter((s) => s.starts[0].length === 3);
    check('碎石口吃：40% 機率觸發，前 0.5 秒重複 2~3 次後接完整語音', segs.length >= 2 && segs.length <= 3 && segs.every((s) => near(s.starts[0][2], 0.5, 1e-9)) && log.src.length === segs.length + 1 && log.src[log.src.length - 1].starts[0].length === 2, `重複=${segs.length}`);
    const { m: m2, log: l2 } = setup(); m2.play('safe', 100, { platform: plat(Kind.NORMAL), hp: 6 }); m2.play('safe', 100, { platform: plat(Kind.PHANTOM), hp: 6 }); m2.play('safe', 100, { platform: plat(Kind.SPRING), hp: 6 });
    check('口吃：普通 / 幻影 / 其他平台絕對不觸發（即使隨機值很低）', l2.src.every((s) => s.starts[0].length === 2));
    Math.random = () => 0.45;
    const { m: m3, log: l3 } = setup(); m3.play('safe', 100, { platform: plat(Kind.FLIP), hp: 6 });
    check('碎石口吃：隨機值 0.45 >= 0.4 不觸發', l3.src.length === 1);
    Math.random = () => 0.99;
  }
  {
    // 保持音高的時間伸縮：音高不變、長度拉長
    const { ctx } = mk(); const sr = 8000;
    const sine = ctx.createBuffer(1, sr, sr); sine.getChannelData(0).forEach((_, i, a) => { a[i] = Math.sin((2 * Math.PI * 440 * i) / sr) * 0.5; });
    const st = timeStretch(ctx, sine, 0, 2, 0.5);
    const d = st.getChannelData(0); let cross = 0;
    for (let i = 1000; i < 7000; i++) if (d[i - 1] <= 0 && d[i] > 0) cross++;
    const hz = cross / (6000 / sr);
    check('時間伸縮：長度拉長 2 倍、音高不變（440Hz 仍約 440Hz）', near(st.duration, 1, 0.05) && near(hz, 440, 20), `len=${st.duration.toFixed(3)}s hz=${hz.toFixed(0)}`);
  }
  {
    // 彈簧：前段半速但保持音高（時間伸縮），後段恢復
    const { m, log, ctx, buf } = setup(); ctx.currentTime = 2; m.play('safe', 0, { platform: plat(Kind.SPRING), hp: 6 });
    const [s1, s2] = log.src;
    check('彈簧：前 0.8 秒用時間伸縮（0.5 倍速、音高不變 → 原速率 1.0 播放伸縮後的內容）', log.src.length === 2 && s1.buffer !== buf && s1.playbackRate.value === 1 && near(s1.buffer.duration, 1.6, 0.1) && near(s1.starts[0][0], 2, 1e-9), `dur=${s1.buffer.duration}`);
    check('彈簧：後段接著從第 0.8 秒恢復原速播放', s2.buffer === buf && near(s2.starts[0][1], 0.8, 1e-9) && near(s2.starts[0][0], 2 + s1.buffer.duration, 1e-6) && s2.playbackRate.value === 1);
    const { m: m2, log: l2 } = setup(); m2.play('safe', 400, { platform: plat(Kind.SPRING), hp: 6 });
    check('彈簧：後段速度 = 基礎音高（B400 = 1.8，帶點加速）、前段仍是原音高', near(l2.src[1].playbackRate.value, 1.8, 1e-9) && l2.src[0].playbackRate.value === 1);
    const { m: m3, log: l3 } = setup(); m3.play('safe', 0, { platform: plat(Kind.SPRING), hp: 2 });
    check('彈簧：低血量時不做蓄力效果，維持低血量處理', l3.src.length === 1 && l3.src[0].playbackRate.value === 0.7);
  }
  {
    // 冰面：1.0x → 1.5x，再慢到 0.6x 速度但音高不再下掉
    const { m, log, ctx, buf } = setup(); ctx.currentTime = 3; m.play('safe', 0, { platform: plat(Kind.ICE), hp: 6 });
    const [s1, s2] = log.src; const c1 = s1.playbackRate.calls; const c2 = s2 && s2.playbackRate.calls;
    check('冰面：前段 playbackRate 1.0x → 1.5x（linearRampToValueAtTime），然後切掉', c1[0][0] === 'set' && c1[0][1] === 1 && c1[1][0] === 'ramp' && near(c1[1][1], 1.5, 1e-9) && s1.stops.some((x) => near(x, 3.3, 1e-9)), JSON.stringify(c1));
    const eaten = 0.3 * (1 + 1.5) / 2;
    check('冰面：後段 0.6x 速度用時間伸縮（長度 ≈ 剩餘 / 0.6），音高不下掉', s2 && s2.buffer !== buf && near(s2.buffer.duration, (1.5 - eaten) / 0.6, 0.1) && near(s2.starts[0][0], 3.3, 1e-9) && c2[0][1] === 1.5 && c2[1][0] === 'ramp' && near(c2[1][1], 1, 1e-9), `dur=${s2 && s2.buffer.duration}`);
    const { m: m2, log: l2 } = setup(); m2.play('safe', 0, { platform: plat(Kind.NORMAL), hp: 6 });
    check('冰面效果只在冰面觸發', l2.src.length === 1 && l2.src[0].playbackRate.calls.length === 0);
  }
  {
    // 泥沼：0.7x、1000Hz 低通、10Hz 音量抖動、每 0.15 秒微重複
    const { m, log, ctx } = setup(); ctx.currentTime = 4; m.play('safe', 0, { platform: plat(Kind.SLIME), hp: 6 });
    const lp = log.biquad[0];
    check('泥沼：套用 1000Hz 低通濾波', lp && lp.type === 'lowpass' && lp.frequency.value === 1000);
    check('泥沼：播放速度 0.7x', near(log.src[0].playbackRate.value, 0.7, 1e-9));
    const f = log.osc[0] && log.osc[0].frequency.value;
    check('泥沼：8~12Hz 的 LFO 讓音量（Gain）抖動', log.osc.length === 1 && f >= 8 && f <= 12, `lfo=${f}Hz`);
    const grains = log.src.slice(1);
    check('泥沼：每 0.15 秒疊上一小段重複片段', grains.length >= 8 && grains.every((g, i) => near(g.starts[0][0], 4 + 0.15 * (i + 1), 1e-6) && near(g.starts[0][2], 0.1, 1e-9)), `grains=${grains.length}`);
    const { m: m2, log: l2 } = setup(); m2.play('safe', 0, { platform: plat(Kind.SLIME), hp: 2 });
    check('泥沼 + 低血量：速度仍是低血量的 0.7x，低通取較低的 800Hz', l2.src[0].playbackRate.value === 0.7 && l2.biquad.length === 1 && l2.biquad[0].frequency.value === 800);
    const { m: m3, log: l3 } = setup(); m3.play('safe', 0, { platform: plat(Kind.NORMAL), hp: 6 });
    check('泥沼效果只在泥沼觸發', l3.biquad.length === 0 && l3.osc.length === 0 && l3.src.length === 1);
  }
  {
    const { m, log, ctx } = setup(); ctx.currentTime = 5; m.play('safe', 300, { platform: plat(Kind.NORMAL), hp: 2 });
    const s = log.src[0];
    check('低血量（<= 2/6）：0.7 倍速（保留人聲辨識度）、無視高音高', s.playbackRate.value === 0.7, `rate=${s.playbackRate.value}`);
    check('低血量：套用 800Hz Low-pass', log.biquad.length === 1 && log.biquad[0].type === 'lowpass' && log.biquad[0].frequency.value === 800);
    // 語音很長（4 秒，0.7 倍速要播 5.7 秒）時，單次最長只播 2.5 秒
    const { m: m2, log: l2, ctx: c2 } = setup(); c2.currentTime = 5;
    const long = c2.createBuffer(1, 4000, 1000); m2.buffers.set('safe-A', long);
    m2.play('safe', 300, { platform: plat(Kind.NORMAL), hp: 2 });
    check('低血量：單次最長只播 2.5 秒就切斷', l2.src[0].stops.some((x) => near(x, 5 + 2.5, 1e-6)) && near(m2.voiceState.voices[0].endAt, 7.5, 1e-6), `stops=${l2.src[0].stops}`);
    const { m: m3, log: l3 } = setup(); m3.play('safe', 300, { platform: plat(Kind.NORMAL), hp: 3 });
    check('血量 3/6 不觸發低血量', l3.src[0].playbackRate.value > 1 && l3.biquad.length === 0);
    // 低血量的語音同樣算在最多 3 個的額度裡
    const { m: m4, log: l4, ctx: c4 } = setup(); c4.currentTime = 9;
    for (let i = 0; i < 4; i++) m4.play('safe', 300, { platform: plat(Kind.NORMAL), hp: 2 });
    check('低血量：同樣最多同時 3 個，第 4 個來時最早的 0.03 秒內淡出切斷', m4.voiceState.voices.length === 3 && l4.src[0].stops.some((x) => near(x, 9.03, 1e-6)) && l4.src[1].stops.every((x) => x > 9.5));
    const { m: m5, log: l5, ctx: c5 } = setup(); c5.currentTime = 9;
    m5.play('safe', 300, { platform: plat(Kind.NORMAL), hp: 2 }); m5.play('safe', 300, { platform: plat(Kind.NORMAL), hp: 6 }); m5.play('safe', 300, { platform: plat(Kind.NORMAL), hp: 6 }); m5.play('safe', 300, { platform: plat(Kind.NORMAL), hp: 6 });
    check('低血量與一般語音共用同一個 3 個上限', m5.voiceState.voices.length === 3 && l5.src[0].stops.some((x) => near(x, 9.03, 1e-6)));
  }
  Math.random = rnd;
}
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
