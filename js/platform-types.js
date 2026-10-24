import { CONFIG, FX } from './config.js';
import { Kind } from './kinds.js';
import { clamp } from './utils.js';

let platformUid = 0;

/**
 * 平台基底類別。所有平台都是「單向平台」：只有從上方落下才會踩到。
 * 子類別只需要覆寫自己有興趣的鉤子：
 *   update(dt)        每個物理子步呼叫（計時、移動）
 *   carry(dt)         角色站在上面時，每步被帶著走的水平位移（滾輪、橫移）
 *   accelScale / speedScale   站在上面時，水平加速度與速度的倍率（滑冰、泥沼）
 *   onLand(pl, ctx)   角色踩上時（彈簧、碎石、傳送門）；ctx 見 world.js 的 landContext
 *   hits(pl)          這個平台本身有沒有打到角色（雷射光束）；打到就扣血
 *   coasts            站在上面時放開按鍵不減速（滑冰）
 */
export class Platform {
  constructor(index, x, y, kind = Kind.NORMAL, warn = false) {
    this.id = ++platformUid;
    this.index = index; // 第幾階，也就是樓層數
    this.x = x;
    this.y = y;
    this.w = CONFIG.PLATFORM_W;
    this.h = CONFIG.PLATFORM_H;
    this.kind = kind;
    this.warn = warn;   // 50 層後危險連段之後的安全平台（只是標記，不再畫光暈，也沒有任何遊戲效果）
    this.solid = true;  // false = 已經消失，不能踩
    this.dead = false;  // true = 動畫也結束，可以從清單移除
    this.age = 0;
  }

  get cx() {
    return this.x + this.w / 2;
  }

  get isSpikes() {
    return false;
  }

  get isMoving() {
    return false;
  }

  /** 這個平台在整個生命週期可能占據的水平範圍（橫移平台是整段巡邏範圍） */
  get footprint() {
    return { x: this.x, w: this.w };
  }

  get coasts() {
    return false;
  }

  /** 站在上面時的固定滑行速度（只有滑冰有）；0 = 照一般方式依按鍵力道加速 */
  get slideSpeed() {
    return 0;
  }

  get accelScale() {
    return 1;
  }

  get speedScale() {
    return 1;
  }

  update(dt) {
    this.age += dt;
  }

  carry() {
    return 0;
  }

  onLand() {}

  hits() {
    return false;
  }

  clone() {
    return Object.assign(Object.create(Object.getPrototypeOf(this)), this);
  }
}

export class NormalPlatform extends Platform {
  constructor(index, x, y, opts = {}) {
    super(index, x, y, Kind.NORMAL, Boolean(opts.warn));
  }
}

export class SpikePlatform extends Platform {
  constructor(index, x, y) {
    super(index, x, y, Kind.SPIKES);
  }

  get isSpikes() {
    return true;
  }
}

/** 滾輪：站在上面會被往 dir 方向推 */
export class Conveyor extends Platform {
  constructor(index, x, y, opts = {}) {
    super(index, x, y, Kind.CONVEYOR);
    this.dir = opts.dir || 1;
  }

  carry(dt) {
    return this.dir * FX.CONVEYOR_PUSH * dt;
  }
}

/**
 * 彈簧：踩到給一個向上的衝力。衝力的高度被「到天花板的距離」限制，所以彈簧不會把角色直接彈進刺針。
 * 只彈一次（charges），之後當一般平台，避免卡在連續彈跳裡。
 */
export class Spring extends Platform {
  constructor(index, x, y) {
    super(index, x, y, Kind.SPRING);
    this.charges = 1;
    this.squash = 0; // 動畫用：剛彈起來的瞬間為 1
  }

  /** 從平台頂面往上最多能彈多高；離天花板太近就回傳 0 */
  launchHeight(pl) {
    const room = pl.y - (CONFIG.CEILING_Y + 6);
    const h = Math.min(FX.SPRING_HEIGHT, room);
    return h >= FX.SPRING_MIN_HEIGHT ? h : 0;
  }

  update(dt) {
    super.update(dt);
    this.squash = Math.max(0, this.squash - dt * 4);
  }

  onLand(pl, ctx) {
    if (this.charges <= 0) return;
    const h = this.launchHeight(pl);
    if (!h) return;
    this.charges -= 1;
    this.squash = 1;
    pl.ground = null;
    pl.vy = -Math.sqrt(2 * CONFIG.GRAVITY * h);
    if (ctx.emit) ctx.emit('spring', this);
  }
}

/**
 * 碎石（原翻轉平台）：踩上去後整塊碎片劇烈震動，FLIP_DELAY 秒後瞬間碎裂，
 * 碎片往下掉 FLIP_FADE 秒。沒有進度條，只能靠震動判斷還剩多久（震幅隨時間變大）。
 */
export class Cracked extends Platform {
  constructor(index, x, y) {
    super(index, x, y, Kind.FLIP);
    this.state = 'idle'; // idle → armed → gone
    this.timer = 0;
    this.fade = 0;
  }

  /** 0 = 還沒踩；0~1 = 震動進度 */
  get progress() {
    return this.state === 'armed' ? 1 - Math.max(0, this.timer) / FX.FLIP_DELAY : 0;
  }

  get remaining() {
    return this.state === 'armed' ? Math.max(0, this.timer) : FX.FLIP_DELAY;
  }

  update(dt) {
    super.update(dt);
    if (this.state === 'armed') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.state = 'gone';
        this.solid = false;
        this.fade = FX.FLIP_FADE;
      }
    } else if (this.state === 'gone') {
      this.fade -= dt;
      if (this.fade <= 0) this.dead = true;
    }
  }

  onLand(pl, ctx) {
    if (this.state !== 'idle') return;
    this.state = 'armed';
    this.timer = FX.FLIP_DELAY;
    if (ctx.emit) ctx.emit('flip', this);
  }
}

/**
 * 滑冰：在上面按一下方向，就以固定的中等速度 ICE_SLIDE_SPEED 滑出去（按多大力都一樣），
 * 放開按鍵也不會停，一直滑到踩上非冰面或撞牆；按反方向會以同樣速度反向滑（加速度 ICE_ACCEL_SCALE）。
 */
export class Ice extends Platform {
  constructor(index, x, y) {
    super(index, x, y, Kind.ICE);
  }

  get coasts() {
    return true;
  }

  get slideSpeed() {
    return FX.ICE_SLIDE_SPEED;
  }

  get accelScale() {
    return FX.ICE_ACCEL_SCALE;
  }
}

/** 泥沼（紫色）：站在上面時水平速度剩 SLIME_SPEED_SCALE（約 38%） */
export class Slime extends Platform {
  constructor(index, x, y) {
    super(index, x, y, Kind.SLIME);
  }

  /** >= 300F：減速效果減少 25%（倍率 0.5385） */
  get speedScale() {
    return this.index >= FX.SLIME_LATE_FLOOR ? FX.SLIME_LATE_SCALE : FX.SLIME_SPEED_SCALE;
  }
}

/** 橫移：以 x0 為中心左右巡邏，站在上面的角色會被帶著走 */
export class Moving extends Platform {
  constructor(index, x, y, opts = {}, kind = Kind.MOVING) {
    super(index, x, y, kind);
    this.x0 = x;
    this.amp = FX.MOVING_AMP;
    this.omega = FX.MOVING_OMEGA;
    this.phase = opts.phase ?? 0;
    this.dx = 0;
    this.x = this.x0 + this.amp * Math.sin(this.phase);
  }

  get isMoving() {
    return true;
  }

  get footprint() {
    return { x: this.x0 - this.amp, w: this.w + this.amp * 2 };
  }

  update(dt) {
    this.age += dt;
    const nx = this.x0 + this.amp * Math.sin(this.phase + this.omega * this.age);
    this.dx = nx - this.x;
    this.x = nx;
  }

  carry() {
    return this.dx;
  }
}

/** 動態尖刺：會橫移的尖刺平台（第五階段） */
export class SpikeMoving extends Moving {
  constructor(index, x, y, opts = {}) {
    super(index, x, y, opts, Kind.SPIKE_MOVING);
  }

  get isSpikes() {
    return true;
  }
}

/**
 * 傳送門：踩上去的瞬間，傳送門立刻消失、角色被吸走（暫停並隱藏），同時目的地馬上出現 PORTAL_DELAY（0.3）秒的
 * 傳送動畫，結束後角色出現在「目標安全平台正上方 PORTAL_DROP_HEIGHT（200px）的高空」，然後自由落下。
 *
 * 名詞：天花板尖刺 = 畫面頂端固定的刺牆（邊界，不是平台）；尖刺平台 = isSpikes 的平台；
 *       安全平台 = 其餘可以站的平台（普通、移動、滑冰、史萊姆、滾輪、彈簧、雷射…），不含碎石、幻影、傳送門。
 * 目標：PORTAL_UP_CHANCE（70%）往上、其餘往下；往上只找上方 PORTAL_UP_RANGE（6）層之內的平台，
 *       找不到合法的安全平台就改往下找（反過來往下找不到也會試往上）。
 * 候選平台必須：是安全平台、離天花板尖刺至少 PORTAL_CEILING_SAFE（250px）的落下空間、離畫面下緣 PORTAL_BOTTOM_MARGIN 以上、
 *       而且從高空落下的路徑上沒有尖刺平台（免得一落地就被刺）。
 * 目的地平台是物件參照（所有平台一起往上捲），所以 0.3 秒後仍在同一個位置。
 */
export class Portal extends Platform {
  constructor(index, x, y) {
    super(index, x, y, Kind.PORTAL);
    this.flash = 0;
    this.pending = null; // { dest, t }
  }

  update(dt) {
    super.update(dt);
    this.flash = Math.max(0, this.flash - dt);
  }

  /** 安全平台：不是尖刺平台、碎石、幻影、傳送門 */
  static canLandOn(p) {
    return p.solid && !p.dead && !p.isSpikes && p.kind !== Kind.PORTAL && p.kind !== Kind.FLIP && p.kind !== Kind.PHANTOM;
  }

  /**
   * 傳過去的空中落點：目標平台中心 X、平台表面上方 PORTAL_DROP_HEIGHT 處（角色腳底）；不會高過天花板尖刺。
   * 安全空間保護：落點「離天花板尖刺 < PORTAL_NEAR_CEILING（100px）」而且「正下方最近的安全平台 < PORTAL_NEAR_FLOOR（150px）」
   * 兩個條件同時成立時，把落點往正下方移 PORTAL_NEAR_FLOOR（150px）；如果移位後正下方 150px 內還有別的平台，
   * 就在左右找最近的「下方 150px 無平台」的 X。整個計算是純函式（不碰角色），結果一次算好（見 finalize）。
   * 回傳 { x, y, shifted, blocked }；blocked = 找不到任何能順利垂直掉落的位置。
   */
  static spawnPoint(dest, platforms = []) {
    const w = CONFIG.PLAYER_W;
    const h = CONFIG.PLAYER_H;
    let x = clamp(dest.cx - w / 2, 0, CONFIG.WORLD_W - w);
    let y = Math.max(dest.y - FX.PORTAL_DROP_HEIGHT - h, CONFIG.CEILING_Y + 12);
    const column = (p) => !p.dead && x + w > p.footprint.x - 2 && x < p.footprint.x + p.footprint.w + 2;
    let shifted = false;
    let blocked = false;
    const nearCeiling = y - CONFIG.CEILING_Y < FX.PORTAL_NEAR_CEILING;
    if (nearCeiling) {
      let gap = Infinity; // 正下方最近的安全平台離腳底多遠
      for (const p of platforms) if (Portal.canLandOn(p) && column(p) && p.y >= y + h) gap = Math.min(gap, p.y - (y + h));
      gap = Math.min(gap, dest.y - (y + h));
      if (gap < FX.PORTAL_NEAR_FLOOR) {
        y = Math.min(y + FX.PORTAL_NEAR_FLOOR, dest.y - h - 10); // 往下移 150px，但不穿過目標平台
        shifted = true;
        const feet = y + h;
        const clear = (cx) => !platforms.some((p) => p !== dest && !p.dead && cx + w > p.footprint.x - 2 && cx < p.footprint.x + p.footprint.w + 2 && p.y > feet && p.y < feet + FX.PORTAL_NEAR_FLOOR);
        blocked = !clear(x);
        // 正下方被擋住：在左右找最近的「下方 150px 無平台」的位置
        for (let d = 8; blocked && d <= 160; d += 8) {
          for (const nx of [x - d, x + d]) {
            if (nx >= CONFIG.WALL_MARGIN && nx + w <= CONFIG.WORLD_W - CONFIG.WALL_MARGIN && clear(nx)) { x = nx; blocked = false; break; }
          }
        }
      }
    }
    return { x, y, shifted, blocked };
  }

  /**
   * 目標平台能不能傳。level 0 是完整規格；找不到目標時 plan() 會逐級放寬（保證踩了一定會傳）：
   *   0：安全平台、離天花板尖刺 >= 250px、離畫面下緣 >= 110px、落下路徑上沒有尖刺平台
   *   1：不檢查落下路徑上的尖刺平台（移位後下方被擋住仍然不行）
   *   2：離下緣 >= 40px、離天花板只要夠站得下（高空落點會被壓在天花板下面）
   *   3：任何畫面內的安全平台（連被擋住也接受，保證發動）
   */
  usable(p, platforms, H, rise = 0, level = 0) {
    if (!Portal.canLandOn(p) || p === this) return false;
    if (p.y >= H - (level >= 3 ? 20 : level >= 2 ? 40 : FX.PORTAL_BOTTOM_MARGIN)) return false;
    const ceilGap = p.y - CONFIG.CEILING_Y;
    if (level < 2 && ceilGap < Math.max(FX.PORTAL_CEILING_SAFE, rise * FX.PORTAL_UP_HEADROOM)) return false;
    if (level >= 2 && ceilGap < CONFIG.PLAYER_H + 30) return false;
    const sp = Portal.spawnPoint(p, platforms);
    if (level >= 3) return true;
    if (sp.blocked) return false; // 移位後下方 150px 內還有別的平台擋著
    if (level >= 1) return true;
    return !platforms.some(
      (q) =>
        q.isSpikes &&
        !q.dead &&
        q.y < p.y &&
        q.y + q.h > sp.y - 12 &&
        sp.x + CONFIG.PLAYER_W > q.footprint.x - 6 &&
        sp.x < q.footprint.x + q.footprint.w + 6,
    );
  }

  /** { up: [...], down: [...] }：上方 PORTAL_UP_RANGE 層之內 / 下方的合法目標平台 */
  destinations(platforms, H, rise = 0, level = 0) {
    const ok = (p) => this.usable(p, platforms, H, rise, level);
    const range = level >= 3 ? Infinity : FX.PORTAL_UP_RANGE;
    const up = platforms.filter((p) => p.index < this.index && p.index >= this.index - range && ok(p));
    const down = platforms.filter((p) => p.index > this.index && ok(p));
    return { up, down };
  }

  /** 目的地（空中落點）的畫面座標（動畫用）；沒有安排傳送時回傳 null */
  targetPoint() {
    const t = this.pending;
    if (!t) return null;
    return { x: t.dest.cx + t.ox, y: t.dest.y + t.oy + CONFIG.PLAYER_H / 2 };
  }

  /**
   * 原子化傳送：把「目標平台 + 安全保護後的最終落點」一次算好，存成相對目標平台的偏移（ox, oy）。
   * 動畫位置與實際傳送位置都用這組偏移，所以不會「先傳到 A、下一幀又瞬移到 B」。
   */
  finalize(plan, platforms) {
    const sp = Portal.spawnPoint(plan.dest, platforms);
    return { ...plan, ox: sp.x + CONFIG.PLAYER_W / 2 - plan.dest.cx, oy: sp.y - plan.dest.y };
  }

  /** 抽出目標 { dest, level }；level 0~3 逐級放寬直到找到為止，全部都沒有才回傳 null（畫面內完全沒有安全平台） */
  plan(ctx) {
    const goUp = ctx.random() < FX.PORTAL_UP_CHANCE;
    for (let level = 0; level <= 3; level++) {
      const { up, down } = this.destinations(ctx.platforms, ctx.H, ctx.rise || 0, level);
      const list = (goUp ? up : down).length ? (goUp ? up : down) : goUp ? down : up; // 找不到就換另一個方向
      if (list.length) return { dest: list[Math.floor(ctx.random() * list.length)], level };
    }
    return null;
  }

  onLand(pl, ctx) {
    if (!ctx.teleport || this.pending) return;
    const chosen = this.plan(ctx);
    if (!chosen) return; // 沒有合法的目的地：當一般平台
    this.pending = { ...this.finalize(chosen, ctx.platforms), t: FX.PORTAL_DELAY };
    this.solid = false; // 傳送門立刻消失
    this.flash = FX.PORTAL_DELAY;
    pl.warp = this;
    pl.ground = null;
    pl.vx = 0;
    pl.vy = 0;
    pl.slide = false;
    if (ctx.emit) ctx.emit('portalArm', this);
  }

  /** 傳送動畫剩幾秒（0 ~ PORTAL_DELAY）；沒有在傳送時是 0 */
  get warpLeft() {
    return this.pending ? Math.max(0, this.pending.t) : 0;
  }

  /** 每個物理子步由 stepWorld 在「傳送中」呼叫：倒數結束就傳送 */
  tick(dt, pl, ctx) {
    const t = this.pending;
    if (!t) return;
    this.pending = { ...t, t: t.t - dt }; // 不原地修改：模擬器會複製平台，pending 物件不能共用
    if (this.pending.t > 0) return;
    const spot = { x: pl.x, y: pl.y };
    let plan = this.pending;
    this.pending = null;
    this.dead = true;
    pl.warp = null;
    // 這 0.3 秒內目標變了（例如被捲出畫面、剛好被刺平台擋住）：重抽一個
    if (!this.usable(plan.dest, ctx.platforms, ctx.H, ctx.rise || 0, 3)) plan = this.plan(ctx);
    if (plan && plan.ox === undefined) plan = this.finalize(plan, ctx.platforms); // 重抽的目標也先算好最終落點
    if (plan) ctx.teleport(pl, plan.dest, this, { x: plan.dest.cx + plan.ox - CONFIG.PLAYER_W / 2, y: plan.dest.y + plan.oy });
    else ctx.teleportAir(pl, spot.x, spot.y, this); // 真的沒地方去：留在原地自由落下
  }
}

/**
 * 雷射（B500+）：平台中央每個週期往下打出一道直線光束，週期 = LASER_OFF + LASER_ON 秒（3 秒關、1 秒開）。
 * 開啟前 LASER_WARN 秒光束會閃爍預警。平台本身可以安心站，光束打在「下方」。
 * phase 是週期內的起始位置（秒），讓相鄰的雷射不會同步。
 */
export class Laser extends Platform {
  constructor(index, x, y, opts = {}) {
    super(index, x, y, Kind.LASER);
    this.cycle = FX.LASER_OFF + FX.LASER_ON;
    this.offset = opts.phase ?? 0; // 0 ~ cycle 秒
  }

  /** 週期內目前的時間點 */
  get t() {
    return (this.age + this.offset) % this.cycle;
  }

  get beamOn() {
    return this.t >= FX.LASER_OFF;
  }

  get beamWarn() {
    return !this.beamOn && this.t >= FX.LASER_OFF - FX.LASER_WARN;
  }

  get beam() {
    return { x: this.cx - FX.LASER_WIDTH / 2, w: FX.LASER_WIDTH, top: this.y + this.h, bottom: this.y + this.h + FX.LASER_LENGTH };
  }

  hits(pl) {
    if (!this.beamOn) return false;
    const b = this.beam;
    return pl.x + pl.w > b.x && pl.x < b.x + b.w && pl.y + pl.h > b.top && pl.y < b.bottom;
  }
}

/**
 * 幻影（B500+）：每 PHANTOM_PERIOD 秒在「實體」與「虛無」之間切換一次。虛無時沒有碰撞體，
 * 站在上面會直接掉下去，從上方落下也會穿過。切換前 PHANTOM_BLINK 秒開始閃爍預警。
 */
export class Phantom extends Platform {
  constructor(index, x, y, opts = {}) {
    super(index, x, y, Kind.PHANTOM);
    this.period = FX.PHANTOM_PERIOD;
    this.offset = opts.phase ?? 0; // 0 ~ 2 * period 秒
    this.solid = this.solidAt(0);
  }

  /** age 秒時是不是實體（偶數個週期 = 實體） */
  solidAt(age) {
    return Math.floor((age + this.offset) / this.period) % 2 === 0;
  }

  /** 距離下一次切換還有幾秒 */
  get untilFlip() {
    const t = (this.age + this.offset) % this.period;
    return this.period - t;
  }

  update(dt) {
    super.update(dt);
    this.solid = this.solidAt(this.age);
  }
}

/** 平台工廠：依種類建立對應的子類別 */
export function createPlatform(kind, index, x, y, opts = {}) {
  switch (kind) {
    case Kind.NORMAL: return new NormalPlatform(index, x, y, opts);
    case Kind.SPIKES: return new SpikePlatform(index, x, y);
    case Kind.CONVEYOR: return new Conveyor(index, x, y, opts);
    case Kind.SPRING: return new Spring(index, x, y);
    case Kind.FLIP: return new Cracked(index, x, y);
    case Kind.ICE: return new Ice(index, x, y);
    case Kind.SLIME: return new Slime(index, x, y);
    case Kind.MOVING: return new Moving(index, x, y, opts);
    case Kind.SPIKE_MOVING: return new SpikeMoving(index, x, y, opts);
    case Kind.PORTAL: return new Portal(index, x, y);
    case Kind.LASER: return new Laser(index, x, y, opts);
    case Kind.PHANTOM: return new Phantom(index, x, y, opts);
    default: throw new Error(`unknown platform kind: ${kind}`);
  }
}
