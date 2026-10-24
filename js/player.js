import { CONFIG } from './config.js';
import { approach } from './utils.js';

export class Player {
  constructor() {
    this.w = CONFIG.PLAYER_W;
    this.h = CONFIG.PLAYER_H;
    this.reset(0, 0);
  }

  reset(x, y) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.ground = null;      // 目前站立的平台
    this.warp = null;        // 傳送中：指向正在傳送的傳送門（角色暫停、隱藏）
    this.slide = false;      // 滑冰中：放開按鍵也不減速，直到踩上非冰面（空中保留）
    this.ignoreId = -1;      // 撞天花板後要穿過的平台
    this.hp = CONFIG.MAX_HP_UNITS;
    this.invincible = 0;
    this.streak = 0;         // 連續成功踩過的平台數（回血用）
    this.facing = 1;
    this.walkT = 0;
  }

  get bottom() {
    return this.y + this.h;
  }

  get cx() {
    return this.x + this.w / 2;
  }

  get isInvincible() {
    return this.invincible > 0;
  }

  overlapsX(p) {
    return this.x + this.w > p.x + 2 && this.x < p.x + p.w - 2;
  }

  /** 扣血並給予無敵時間；無敵中回傳 false */
  damage(units) {
    if (this.isInvincible) return false;
    this.hp = Math.max(0, this.hp - units);
    this.invincible = CONFIG.INVINCIBLE_TIME;
    this.streak = 0;
    return true;
  }

  /** 成功踩到一般平台；累積 15 次回 1 格。滿血時不累計。回傳是否有回血 */
  registerSafeLanding() {
    if (this.hp >= CONFIG.MAX_HP_UNITS) {
      this.streak = 0;
      return false;
    }
    this.streak += 1;
    if (this.streak >= CONFIG.HEAL_STREAK) {
      this.hp = Math.min(CONFIG.MAX_HP_UNITS, this.hp + 1);
      this.streak = 0;
      return true;
    }
    return false;
  }

  /** accelScale / speedScale：站在滑冰（加速度小）或泥沼（速度減半）上時由 World 傳進來 */
  updateHorizontal(dt, axis, worldW, accelScale = 1, speedScale = 1, slideSpeed = 0) {
    // 站在滑冰上：只看方向，不看按多大力（搖桿、陀螺儀的傾斜量都一樣），一律以固定的中等速度滑出去
    if (slideSpeed && Math.abs(axis) >= 0.05) axis = Math.sign(axis);
    const target = axis * (slideSpeed || CONFIG.MOVE_SPEED * speedScale);
    // 滑冰：沒有按方向時不煞車，速度原封不動
    if (!(this.slide && Math.abs(axis) < 0.05)) {
      this.vx = approach(this.vx, target, CONFIG.MOVE_ACCEL * accelScale * dt);
    }
    this.x += this.vx * dt;
    if (this.x < 0) {
      this.x = 0;
      this.vx = 0;
    } else if (this.x + this.w > worldW) {
      this.x = worldW - this.w;
      this.vx = 0;
    }
    if (Math.abs(axis) > 0.05) this.facing = Math.sign(axis);
    this.walkT += Math.abs(this.vx) * dt;
    if (this.invincible > 0) this.invincible = Math.max(0, this.invincible - dt);
  }
}
