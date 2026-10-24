import { CONFIG, FX } from './config.js';
import { Kind, isDropper } from './kinds.js';
import { createPlatform, NormalPlatform } from './platform-types.js';
import { StageManager } from './stages.js';
import { clamp } from './utils.js';

const EDGE_GRAB = CONFIG.PLAYER_W / 2 - 2; // 角色中心超出平台這麼多就會離開平台（Player.overlapsX 內縮 2px）
const HIT_PAD = CONFIG.PLAYER_W / 2;       // 角色中心與平台邊緣小於這個距離，穿越平台高度時就會擦到
const LAND_MARGIN = 10;                    // 目標落點離平台邊緣至少這麼遠，留給剎車滑行
const REVERSE_LAG = 0.15;                  // 角色折返（速度從 +190 變 -190）要花的時間，秒
const STOP_DRIFT = 8;                      // 角色放開方向後因慣性多滑的距離

/**
 * 角色離開平台後，落到下方 dy 處所需的時間（秒）。
 * 平台以 riseSpeed 上升，所以解 ½·g·t² + rise·t = dy；落下速度上限 MAX_FALL。
 */
export function fallTime(dy, riseSpeed) {
  const g = CONFIG.GRAVITY;
  const vmax = CONFIG.MAX_FALL;
  const tCap = vmax / g;
  const distCap = 0.5 * g * tCap * tCap + riseSpeed * tCap;
  if (dy <= distCap) {
    return (-riseSpeed + Math.sqrt(riseSpeed * riseSpeed + 2 * g * dy)) / g;
  }
  return tCap + (dy - distCap) / (vmax + riseSpeed);
}

/**
 * 安全路徑投影（Safe Path Projection）
 *
 * 假設角色站在 safe 上，要去 x 位置為 nx、高度為 ny 的新一般平台。
 * 理想路徑：先走到 safe 的左端或右端離開平台，落下時以全速朝目標點水平移動
 * （目標點 = 新平台縮進 LAND_MARGIN 後，離開點最近的位置）。
 * 這條路徑要同時滿足：
 *   1. 可達：水平移動距離 <= REACH_SAFETY × MOVE_SPEED × 落下時間。
 *   2. 無傷：角色經過每個危險平台（safe 之後生成的刺針平台）的高度時，
 *      中心點都不在該平台左右各 HIT_PAD 的範圍內。位置以最慢與最快兩種速度各算一次，整段區間都要避開。
 * 離開點必須在牆內（平台貼牆那一側不能走下去）。tol 是上升速度的容許誤差比例，路徑在 ±tol 內都要成立。
 * 回傳 { dir, exit, target }，找不到路徑回傳 null。
 *   dangers: [{ x, w, y }]
 */
export function planSafePath(safe, dangers, nx, ny, riseSpeed, tol = CONFIG.RISE_TOLERANCE) {
  const vLo = CONFIG.MOVE_SPEED * CONFIG.REACH_SAFETY;
  const vHi = CONFIG.MOVE_SPEED;
  const rises = [riseSpeed * (1 - tol), riseSpeed, riseSpeed * (1 + tol)];
  const lo = nx + LAND_MARGIN;
  const hi = nx + CONFIG.PLATFORM_W - LAND_MARGIN;

  for (const dir of [1, -1]) {
    const exit = dir > 0 ? safe.x + safe.w + EDGE_GRAB + 1 : safe.x - EDGE_GRAB - 1;
    // 平台貼牆時，角色走不到牆外，那一側就不能當離開點
    if (exit < CONFIG.PLAYER_W / 2 || exit > CONFIG.WORLD_W - CONFIG.PLAYER_W / 2) continue;
    const target = clamp(exit, lo, hi);
    const dist = Math.abs(target - exit);
    const sign = Math.sign(target - exit);
    const reverse = sign !== 0 && sign !== dir;
    let ok = true;

    for (const rise of rises) {
      const tAll = fallTime(ny - safe.y, rise) - (reverse ? REVERSE_LAG : 0);
      if (dist > vLo * tAll) {
        ok = false;
        break;
      }
      for (const d of dangers) {
        const t = fallTime(d.y - safe.y, rise);
        // 角色在 t 秒時可能的位置範圍；折返時最慢可能還停在離開點
        let a = exit + sign * Math.min(vLo * Math.max(0, t - (reverse ? REVERSE_LAG : 0)), dist);
        let b = exit + sign * Math.min(vHi * t, dist);
        if (sign === 0) b = exit + dir * STOP_DRIFT;
        else if (reverse) a = exit;
        const from = Math.min(a, b);
        const to = Math.max(a, b);
        if (to > d.x - HIT_PAD && from < d.x + d.w + HIT_PAD) {
          ok = false;
          break;
        }
      }
      if (!ok) break;
    }
    if (ok) return { dir, exit, target };
  }
  return null;
}

/**
 * 平台生成器（含防必死與階段系統）
 *
 * 追蹤兩個狀態（都存「平台本身的參照」，所以座標永遠是目前畫面上的即時座標）：
 *   lastSafe  最近一個「不是尖刺」的平台，也就是角色下一步會從這裡出發
 *   dangers   lastSafe 之後生成的所有尖刺平台（危險投影區；橫移尖刺取整段巡邏範圍）
 *
 * 種類由 StageManager 依層數抽，再依序過三關：
 *   1. 防死局規則 allowed()：滑冰不能緊接在翻轉之後、彈簧正上方不能有尖刺、連續尖刺上限。
 *   2. 位置驗證：與上一階拉開距離、正上方通道不碰危險投影區、planSafePath 找得到可達且無傷的路徑
 *      （橫移平台會把「巡邏範圍內的每一個相位」都驗證一遍）。
 *   3. 尖刺平台另外做前瞻：放下去之後，下一階一定還有合法位置。
 * 抽到的種類找不到合法位置時，退回一般平台；一般平台也找不到，才用 fallback。
 *
 * 其他種類的處理方式：
 *   滾輪 / 滑冰 / 泥沼 / 翻轉 / 彈簧：只影響「站在上面」的行為，不改變離開平台後的空中路徑，
 *     所以和一般平台用同一套路徑驗證（彈簧用天花板距離限制彈跳高度）。
 *   傳送門：落點是下方 2~5 層內任一個非尖刺平台（踩到才抽），每個非尖刺平台本來就有驗證過的下一步，所以天生可達。
 *   雷射 / 幻影：和一般平台用同一套驗證；雷射光束有開有關、幻影有實體有虛無，路徑驗證不考慮它們，
 *     改由 allowed() 的規則（幻影比照碎石、雷射不放在彈簧上方）與 autoTest.js 的模擬把關。
 */
export class PlatformGenerator {
  constructor(worldW, { rng = Math.random } = {}) {
    this.worldW = worldW;
    this.rng = rng;
    this.stages = new StageManager(rng);
    this.fallbackCount = 0;
    this.reset();
  }

  reset() {
    this.index = 0;
    this.spikeStreak = 0;
    this.last = null;
    this.lastSafe = null;
    this.dangers = [];
    this.recent = [];        // 最近幾個平台，防死局規則要看
    this.active = [];
  }

  get minX() {
    return CONFIG.WALL_MARGIN;
  }

  get maxX() {
    return this.worldW - CONFIG.PLATFORM_W - CONFIG.WALL_MARGIN;
  }

  createFirst(y) {
    const p = new NormalPlatform(0, (this.worldW - CONFIG.PLATFORM_W) / 2, y);
    this.last = p;
    this.lastSafe = p;
    this.dangers = [];
    this.recent = [p];
    return p;
  }

  /** riseSpeed：數字，或「樓層 → 該層上升速度」的函式（平台是提前生成的，要用它被踩到時的速度規劃） */
  next(y, riseSpeed, active = []) {
    this.active = active; // 目前所有存在的平台（含已預先生成、還在畫面下方的），雷射數量上限要看
    const riseOf = typeof riseSpeed === 'function' ? riseSpeed : () => riseSpeed;
    const index = ++this.index;

    const forced = this.spikeStreak >= CONFIG.MAX_SPIKE_STREAK;
    let kind = index <= CONFIG.SAFE_START ? Kind.NORMAL : this.stages.pick(index, (k) => this.allowed(k, forced, y));
    let spot = kind === Kind.NORMAL ? null : this.pick(kind, index, y, riseOf);
    if (!spot) {
      kind = Kind.NORMAL;
      spot = this.pick(kind, index, y, riseOf);
    }
    if (!spot) spot = { x: this.fallback(index, y, riseOf) };
    // 傳送門與橫移尖刺在 pick 時就決定好了真正的種類
    if (spot.kind) kind = spot.kind;

    const warn = forced && index > CONFIG.WARN_FLOOR && kind === Kind.NORMAL;
    const platform = createPlatform(kind, index, spot.x, y, { warn, dir: spot.dir, phase: spot.phase });
    this.commit(platform);
    return platform;
  }

  commit(platform) {
    this.last = platform;
    this.recent.push(platform);
    if (this.recent.length > 8) this.recent.shift();
    if (platform.isSpikes) {
      this.spikeStreak += 1;
      this.dangers.push(platform);
    } else {
      this.spikeStreak = 0;
      this.lastSafe = platform;
      this.dangers = [];
    }
  }

  // ───────── 防死局規則 ─────────

  allowed(kind, forced, y) {
    const droppedRecently = (n) => this.recent.slice(-n).some((p) => isDropper(p.kind));
    if (kind === Kind.SPIKES || kind === Kind.SPIKE_MOVING) {
      // 碎石 / 幻影把人丟下去：緊接在後面的一層不能是尖刺，否則人被迫落到畫面外才有安全平台
      if (droppedRecently(FX.FLIP_SPIKE_GAP)) return false;
      return !forced;
    }
    if (isDropper(kind)) {
      // 碎石 / 幻影連著出現，人會一路被丟到畫面下緣，沒有時間等平台升上來
      return !droppedRecently(FX.FLIP_FLIP_GAP);
    }
    if (kind === Kind.ICE || kind === Kind.SLIME) {
      // 碎石消失後會直接掉到下面，下面如果是滑冰，角色帶著落下的速度停不住
      return !droppedRecently(FX.FLIP_ICE_GAP);
    }
    if (kind === Kind.LASER) {
      // 同時存在的雷射平台最多 LASER_MAX 個，超過就改生成別的平台
      return this.active.filter((p) => p.kind === Kind.LASER && !p.dead).length < FX.LASER_MAX;
    }
    if (kind === Kind.SPRING) {
      // 彈起來之後會落回正上方的平台：SPRING_GUARD_RATIO 倍彈跳高度之內不能有尖刺或雷射
      const reach = FX.SPRING_GUARD_RATIO * FX.SPRING_HEIGHT;
      return !this.recent.some((p) => (p.isSpikes || p.kind === Kind.LASER) && y - p.y < reach);
    }
    return true;
  }

  // ───────── 找位置 ─────────

  halfSweep(kind) {
    return kind === Kind.MOVING || kind === Kind.SPIKE_MOVING ? FX.MOVING_AMP : 0;
  }

  /** 回傳 { x, kind?, dir?, phase? } 或 null。尖刺種類另外做前瞻 */
  pick(kind, index, y, riseOf) {
    const spiky = kind === Kind.SPIKES || kind === Kind.SPIKE_MOVING;
    const extras = this.extras(kind);
    for (const step of [2, 0.5]) {
      const valid = this.candidates(kind, index, y, riseOf, step);
      while (valid.length) {
        const [x] = valid.splice(Math.floor(this.rng() * valid.length), 1);
        if (!spiky || this.leavesRoom(kind, x, index, y, riseOf)) return { x, kind, ...extras };
      }
    }
    return null;
  }

  extras(kind) {
    if (kind === Kind.CONVEYOR) return { dir: this.rng() < 0.5 ? -1 : 1 };
    if (kind === Kind.MOVING || kind === Kind.SPIKE_MOVING) return { phase: this.rng() * Math.PI * 2 };
    // 雷射的週期 4 秒、幻影的完整週期 2 秒：隨機起始時間，相鄰的不會同步
    if (kind === Kind.LASER) return { phase: this.rng() * (FX.LASER_OFF + FX.LASER_ON) };
    if (kind === Kind.PHANTOM) return { phase: this.rng() * FX.PHANTOM_PERIOD * 2 };
    return {};
  }

  candidates(kind, index, y, riseOf, step) {
    const amp = this.halfSweep(kind);
    const lo = this.minX + amp;
    const hi = this.maxX - amp;
    const out = [];
    for (let x = lo; x <= hi; x += step) {
      const cand = Math.min(hi, x + this.rng() * step);
      if (this.isValid(cand, kind, index, y, riseOf)) out.push(cand);
    }
    return out;
  }

  /** x 是平台的位置；橫移平台則是巡邏中心（平台左緣 = x ± MOVING_AMP） */
  isValid(x, kind, index, y, riseOf) {
    const last = this.last;
    const W = CONFIG.PLATFORM_W;
    const amp = this.halfSweep(kind);
    const mine = { x: x - amp, w: W + amp * 2 };
    const lastFp = last.footprint;
    const dist = Math.abs(x + W / 2 - (last.isMoving ? last.x0 + W / 2 : last.cx));
    if (dist < W * CONFIG.MIN_OFFSET_RATIO) return false;

    if (kind === Kind.SPIKES || kind === Kind.SPIKE_MOVING) {
      if (!last.isSpikes) return dist >= W * CONFIG.SPIKE_AFTER_NORMAL_RATIO;
      // 兩個尖刺之間水平方向要留出通道（橫移的取整段巡邏範圍）
      const clearance = Math.max(mine.x, lastFp.x) - Math.min(mine.x + mine.w, lastFp.x + lastFp.w);
      return clearance >= CONFIG.PLAYER_W * CONFIG.SPIKE_CHANNEL;
    }

    const pad = CONFIG.SHADOW_MARGIN;
    for (const d of this.dangers) {
      const f = d.footprint;
      if (mine.x - pad < f.x + f.w && mine.x + mine.w + pad > f.x) return false;
    }
    return this.hopReachable(x, kind, index, y, riseOf);
  }

  /** lastSafe → 新平台，有沒有可達且不碰任何尖刺的路徑。兩端是橫移平台時，每個相位的組合都要成立 */
  hopReachable(x, kind, index, y, riseOf) {
    const from = this.lastSafe;
    const rFrom = riseOf(from.index);
    const rTo = riseOf(index);
    const rise = (rFrom + rTo) / 2;
    const tol = CONFIG.RISE_TOLERANCE + Math.abs(rTo - rFrom) / (2 * rise);
    const dangers = this.dangers.map((d) => ({ ...d.footprint, y: d.y }));
    const fromXs = from.isMoving ? sweepSamples(from.x0) : [from.x];
    const toXs = this.halfSweep(kind) ? sweepSamples(x) : [x];
    for (const fx of fromXs) {
      const safe = { x: fx, w: from.w, y: from.y };
      for (const tx of toXs) {
        if (!planSafePath(safe, dangers, tx, y, rise, tol)) return false;
      }
    }
    return true;
  }

  /**
   * 假設 x 處生成尖刺平台，下一階（階距取最小、標準、最大三種）是否都還找得到合法的一般平台。
   * 合法位置必須是一段至少 6px 寬的區間，避免剛好只有一個點可用。
   */
  leavesRoom(kind, x, index, y, riseOf) {
    const spike = createPlatform(kind, index, x, y, { phase: 0 });
    const saved = [this.last, this.dangers, this.recent];
    this.last = spike;
    this.dangers = [...this.dangers, spike];
    this.recent = [...this.recent, spike];
    let ok = true;
    for (const gap of [CONFIG.PLATFORM_GAP - CONFIG.PLATFORM_JITTER, CONFIG.PLATFORM_GAP, CONFIG.PLATFORM_GAP + CONFIG.PLATFORM_JITTER]) {
      let found = false;
      for (let cx = this.minX; cx + 6 <= this.maxX && !found; cx += 2) {
        found =
          this.isValid(cx, Kind.NORMAL, index + 1, y + gap, riseOf) &&
          this.isValid(cx + 6, Kind.NORMAL, index + 1, y + gap, riseOf);
      }
      if (!found) {
        ok = false;
        break;
      }
    }
    [this.last, this.dangers, this.recent] = saved;
    return ok;
  }

  /** 防呆：把一般平台放在 lastSafe 的正下方稍微偏移處，優先選有合法路徑的一側 */
  fallback(index, y, riseOf) {
    this.fallbackCount += 1;
    const base = this.lastSafe.isMoving ? this.lastSafe.x0 : this.lastSafe.x;
    const off = CONFIG.PLATFORM_W * CONFIG.MIN_OFFSET_RATIO + 1;
    const xs = [base + off, base - off].map((x) => clamp(x, this.minX, this.maxX));
    return xs.find((x) => this.hopReachable(x, Kind.NORMAL, index, y, riseOf)) ?? xs[0];
  }
}

/** 橫移平台巡邏範圍內的幾個取樣位置（中心、±半幅、±全幅） */
function sweepSamples(x0) {
  const a = FX.MOVING_AMP;
  return [x0 - a, x0 - a / 2, x0, x0 + a / 2, x0 + a];
}
