import { CONFIG, FX } from './config.js';
import { Kind } from './kinds.js';
import { riseSpeedFor } from './modes.js';
import { Portal } from './platform-types.js';
import { PlatformGenerator } from './platforms.js';
import { Player } from './player.js';
import { StageManager } from './stages.js';
import { clamp, seededRandom } from './utils.js';

/**
 * 純物理世界：角色、平台、生成器與每一步的物理，完全不碰畫面、輸入裝置與 DOM。
 * Game（畫面版）與自動測試模擬器（autoTest.js）共用同一份物理，所以模擬結果就是遊戲裡真的會發生的事。
 *
 * 事件（events，全部選填）：
 *   safeLand(p) hurt() heal() over() spring(p) flip(p) portalArm(portal) portal(dest|null, portal) stage(stage) endgame()
 */

/** 讓平台的 onLand 能通知外面、傳送角色、挑傳送門的落點 */
function landContext(st, ev) {
  return {
    emit: (name, p) => ev[name] && ev[name](p),
    platforms: st.platforms,
    H: st.H,
    rise: st.rise,
    random: st.fxRng || Math.random,
    teleportAir(pl, x, y, portal) {
      pl.x = x;
      pl.y = y;
      pl.vx = 0;
      pl.vy = 0;
      pl.slide = false;
      pl.ground = null;
      pl.ignoreId = -1;
      pl.warp = null;
      if (ev.portal) ev.portal(null, portal);
    },
    // 傳到目標安全平台正上方的高空，速度與著地狀態清掉，之後照一般重力自由落下
    teleport(pl, dest, portal, spawn) {
      const sp = spawn || Portal.spawnPoint(dest, st.platforms); // spawn：傳送門已經算好的最終落點
      pl.x = sp.x;
      pl.y = sp.y;
      pl.vx = 0;
      pl.vy = 0;
      pl.slide = false;
      pl.ground = null;
      pl.ignoreId = -1;
      pl.warp = null;
      if (ev.portal) ev.portal(dest, portal);
    },
  };
}

function land(st, p, ev) {
  const pl = st.player;
  pl.ground = p;
  pl.vy = 0;
  pl.y = p.y - pl.h;
  st.floor = Math.max(st.floor, p.index);

  if (p.isSpikes) {
    if (pl.damage(CONFIG.SPIKE_DAMAGE)) hurt(st, ev, p);
    pl.streak = 0;
    return;
  }
  if (ev.safeLand) ev.safeLand(p);
  if (pl.registerSafeLanding() && ev.heal) ev.heal();
  p.onLand(pl, landContext(st, ev));
}

function hurt(st, ev, source) {
  st.lastHurt = source || 'ceiling';
  if (ev.hurt) ev.hurt(source);
  if (st.player.hp <= 0) end(st, ev, source || 'ceiling');
}

function end(st, ev, cause) {
  if (st.over) return;
  st.over = true;
  st.cause = cause;
  if (ev.over) ev.over(cause);
}

function hitCeiling(st, ev) {
  const pl = st.player;
  if (pl.ground) pl.ignoreId = pl.ground.id; // 被刺下來，穿過腳下的平台
  pl.ground = null;
  pl.y = CONFIG.CEILING_Y;
  pl.vy = Math.max(pl.vy, 80);
  if (pl.damage(CONFIG.CEILING_DAMAGE)) hurt(st, ev, 'ceiling');
}

/**
 * 物理推進一小步。st 需要：player、platforms、rise（目前上升速度）、H（畫面高度）、floor、depth、over。
 * 這個函式會被機器人用來模擬「如果我往左走會怎樣」，所以不能有任何外部副作用。
 */
export function stepWorld(st, dt, axis, ev = {}) {
  const pl = st.player;
  const lift = st.rise * dt;
  for (const p of st.platforms) {
    p.update(dt);
    p.y -= lift;
  }
  st.depth += lift;

  // 傳送中：傳送門已經消失，角色暫停（不受重力、不會被刺到），等動畫結束才出現在目的地
  if (pl.warp) {
    pl.warp.tick(dt, pl, landContext(st, ev));
    return;
  }

  const under = pl.ground;
  if (under) pl.slide = under.coasts; // 站上滑冰就開始滑；空中保留，踩到非冰面才解除
  pl.updateHorizontal(dt, axis, CONFIG.WORLD_W, under ? under.accelScale : 1, under ? under.speedScale : 1, under ? under.slideSpeed : 0);
  if (under && under.solid) {
    const push = under.carry(dt); // 滾輪的推力、橫移平台帶著走
    if (push) pl.x = clamp(pl.x + push, 0, CONFIG.WORLD_W - pl.w);
  }

  if (pl.ground) {
    if (pl.ground.solid && pl.overlapsX(pl.ground)) {
      pl.y = pl.ground.y - pl.h;
    } else {
      pl.ground = null; // 走出平台邊緣，或腳下的翻轉平台消失了
      pl.vy = 0;
    }
  }

  if (!pl.ground) {
    const prevBottom = pl.bottom;
    pl.vy = Math.min(pl.vy + CONFIG.GRAVITY * dt, CONFIG.MAX_FALL);
    pl.y += pl.vy * dt;
    if (pl.vy >= 0) {
      // 單向平台：只有「上一步在平台上方、這一步穿過平台頂」才算踩到
      for (const p of st.platforms) {
        if (!p.solid || p.id === pl.ignoreId || !pl.overlapsX(p)) continue;
        const prevTop = p.y + lift;
        if (prevBottom <= prevTop + 0.5 && pl.bottom >= p.y) {
          land(st, p, ev);
          break;
        }
      }
    }
  }

  // 雷射光束：開啟時掃到角色就扣血
  if (!st.over) {
    for (const p of st.platforms) {
      if (p.kind === Kind.LASER && p.hits(pl)) {
        if (pl.damage(CONFIG.SPIKE_DAMAGE)) hurt(st, ev, p);
        break;
      }
    }
  }

  if (pl.ignoreId !== -1) {
    const ignored = st.platforms.find((p) => p.id === pl.ignoreId);
    if (!ignored || pl.y > ignored.y + ignored.h) pl.ignoreId = -1;
  }

  if (!st.over && pl.y < CONFIG.CEILING_Y) hitCeiling(st, ev);
  if (!st.over && pl.y > st.H) end(st, ev, 'abyss');
}

export class World {
  constructor({ height = CONFIG.MIN_H, gameMode = 'standard', rng = Math.random, events = {} } = {}) {
    this.H = height;
    this.gameMode = gameMode;
    this.rng = rng;
    this.events = events;
    this.player = new Player();
    this.generator = new PlatformGenerator(CONFIG.WORLD_W, { rng });
    this.fxRng = seededRandom(Math.floor(rng() * 4294967296)); // 傳送門落點專用，不影響關卡生成
    this.stages = new StageManager(rng);
    this.riseAt = (floor) => riseSpeedFor(this.gameMode, floor);
    this.reset(height);
  }

  /** 目前的平台上升速度：由遊戲模式（標準 / 極速 / 地獄）與樓層決定，見 modes.js */
  get rise() {
    return this.riseAt(this.floor);
  }

  get stage() {
    return this.stages.stageOf(Math.max(1, this.floor));
  }

  reset(height = this.H) {
    this.H = height;
    this.generator.reset();
    const first = this.generator.createFirst(Math.round(this.H * 0.42));
    this.platforms = [first];
    this.floor = 0;
    this.depth = 0;
    this.over = false;
    this.cause = null;
    this.lastHurt = null;
    this.stageId = 1;
    this.endgame = false;
    this.fillPlatforms();
    this.player.reset(first.cx - this.player.w / 2, first.y - this.player.h);
    this.player.ground = first;
  }

  fillPlatforms() {
    let last = this.platforms[this.platforms.length - 1];
    const limit = this.H + CONFIG.PLATFORM_GAP * 2;
    while (last.y < limit) {
      const y = last.y + CONFIG.PLATFORM_GAP + (this.rng() * 2 - 1) * CONFIG.PLATFORM_JITTER;
      last = this.generator.next(y, this.riseAt, this.platforms);
      this.platforms.push(last);
    }
  }

  /** 推進 dt 秒（內部切成 <= 1/120 秒的子步） */
  update(dt, axis) {
    if (this.over) return;
    const steps = Math.max(1, Math.ceil(dt / CONFIG.MAX_STEP));
    const h = dt / steps;
    for (let i = 0; i < steps && !this.over; i++) this.step(h, axis);
    this.platforms = this.platforms.filter((p) => p.y + p.h > -20 && !p.dead);
    this.fillPlatforms();
    if (!this.endgame && this.floor >= FX.ENDGAME_FLOOR) {
      this.endgame = true;
      if (this.events.endgame) this.events.endgame();
    }
    const stage = this.stage;
    if (stage.id !== this.stageId) {
      this.stageId = stage.id;
      if (this.events.stage) this.events.stage(stage);
    }
  }

  step(dt, axis) {
    stepWorld(this, dt, axis, this.events);
  }
}
