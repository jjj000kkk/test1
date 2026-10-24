import { COLORS, CONFIG } from './config.js';
import { applyDeadzone, clamp } from './utils.js';

/*
 * 每種操控模式都是一個 Control：
 *   down/move/up(id, x, y, layout) 收到「邏輯座標」的指標事件
 *   axis 回傳 -1(左) ~ 1(右)
 *   draw(ctx, layout) 在畫布上畫出操控元件
 * layout = { W, H }
 */

class Control {
  constructor() {
    this.axis = 0;
  }
  reset() {
    this.axis = 0;
  }
  down() {}
  move() {}
  up() {}
  draw() {}
}

/** 追蹤多指：最後按下的那根手指決定方向 */
class HalfPressControl extends Control {
  constructor() {
    super();
    this.pointers = new Map();
  }
  reset() {
    super.reset();
    this.pointers.clear();
  }
  sideAt(x, y, L) {
    return x < L.W / 2 ? -1 : 1;
  }
  down(id, x, y, L) {
    const side = this.sideAt(x, y, L);
    if (side === 0) return;
    this.pointers.set(id, side);
    this.sync();
  }
  move(id, x, y, L) {
    if (!this.pointers.has(id)) return;
    const side = this.sideAt(x, y, L);
    if (side !== 0) this.pointers.set(id, side);
    this.sync();
  }
  up(id) {
    this.pointers.delete(id);
    this.sync();
  }
  sync() {
    const sides = [...this.pointers.values()];
    this.axis = sides.length ? sides[sides.length - 1] : 0;
  }
}

function drawArrow(ctx, cx, cy, size, dir, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx + dir * size, cy);
  ctx.lineTo(cx - dir * size * 0.6, cy - size);
  ctx.lineTo(cx - dir * size * 0.6, cy + size);
  ctx.closePath();
  ctx.fill();
}

/** 模式一：點擊螢幕左/右半邊 */
export class TapControl extends HalfPressControl {
  draw(ctx, L) {
    const y = L.H - 60;
    if (this.axis !== 0) {
      ctx.fillStyle = 'rgba(255, 181, 71, 0.08)';
      ctx.fillRect(this.axis < 0 ? 0 : L.W / 2, 0, L.W / 2, L.H);
    }
    drawArrow(ctx, 34, y, 14, -1, this.axis < 0 ? COLORS.controlActive : COLORS.control);
    drawArrow(ctx, L.W - 34, y, 14, 1, this.axis > 0 ? COLORS.controlActive : COLORS.control);
  }
}

/** 模式二：虛擬按鍵。畫出來的鈕比較小，但判定範圍是整個下方左右半區 */
export class ButtonsControl extends HalfPressControl {
  hitTop(L) {
    return L.H * 0.5;
  }
  sideAt(x, y, L) {
    if (y < this.hitTop(L)) return 0;
    return x < L.W / 2 ? -1 : 1;
  }
  draw(ctx, L) {
    const r = 40;
    const y = L.H - 74;
    const spots = [
      [L.W * 0.22, -1],
      [L.W * 0.78, 1],
    ];
    for (const [x, dir] of spots) {
      const active = this.axis === dir;
      ctx.fillStyle = active ? 'rgba(255, 181, 71, 0.35)' : 'rgba(244, 240, 255, 0.10)';
      ctx.strokeStyle = active ? COLORS.kid : 'rgba(244, 240, 255, 0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      drawArrow(ctx, x + dir * 3, y, 15, dir, active ? COLORS.kid : 'rgba(244, 240, 255, 0.7)');
    }
    // 判定區的淡色分隔，讓玩家知道整個下半部都能按
    ctx.strokeStyle = 'rgba(244, 240, 255, 0.06)';
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(L.W / 2, this.hitTop(L));
    ctx.lineTo(L.W / 2, L.H);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

/**
 * 模式三：跟隨手指的橫向虛擬搖桿
 * 手指在下半部（y > H * 0.5）按下時，搖桿底座立刻出現在按下的位置，之後左右拖曳控制方向；
 * 放開後搖桿隱藏，角色停止移動。
 */
export class JoystickControl extends Control {
  constructor() {
    super();
    this.pointerId = null;
    this.baseX = 0;
    this.baseY = 0;
    this.knob = 0; // -R ~ R
  }
  radius(L) {
    return Math.min(80, L.W * 0.22);
  }
  reset() {
    super.reset();
    this.pointerId = null;
    this.knob = 0;
  }
  down(id, x, y, L) {
    if (this.pointerId !== null || y <= L.H * 0.5) return;
    this.pointerId = id;
    this.baseX = x;
    this.baseY = clamp(y, L.H * 0.5 + 30, L.H - 36);
    this.knob = 0;
    this.axis = 0;
  }
  move(id, x, y, L) {
    if (id !== this.pointerId) return;
    const R = this.radius(L);
    this.knob = clamp(x - this.baseX, -R, R);
    this.axis = applyDeadzone(this.knob / R, 0.12);
  }
  up(id) {
    if (id !== this.pointerId) return;
    this.pointerId = null;
    this.knob = 0;
    this.axis = 0;
  }
  draw(ctx, L) {
    if (this.pointerId === null) {
      ctx.fillStyle = 'rgba(244, 240, 255, 0.4)';
      ctx.font = '600 12px "Noto Sans TC", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('在下方按住並左右拖曳', L.W / 2, L.H - 14);
      return;
    }
    const R = this.radius(L);
    const { baseX: cx, baseY: cy } = this;
    ctx.fillStyle = 'rgba(244, 240, 255, 0.08)';
    ctx.strokeStyle = 'rgba(244, 240, 255, 0.28)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(cx - R - 26, cy - 26, (R + 26) * 2, 52, 26);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(244, 240, 255, 0.18)';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 12);
    ctx.lineTo(cx, cy + 12);
    ctx.stroke();
    drawArrow(ctx, cx - R - 8, cy, 7, -1, 'rgba(244, 240, 255, 0.35)');
    drawArrow(ctx, cx + R + 8, cy, 7, 1, 'rgba(244, 240, 255, 0.35)');
    ctx.fillStyle = COLORS.kid;
    ctx.beginPath();
    ctx.arc(cx + this.knob, cy, 21, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** 模式五：陀螺儀體感 + 中央姿態指示器 HUD */
export class GyroControl extends Control {
  constructor(gyro) {
    super();
    this.gyro = gyro;
  }
  get axis() {
    return this.gyro.axis;
  }
  set axis(_) {
    /* 由陀螺儀決定，忽略指定 */
  }
  draw(ctx, L) {
    const R = 54;
    const cx = L.W / 2;
    const cy = L.H / 2;
    ctx.strokeStyle = 'rgba(244, 240, 255, 0.22)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(244, 240, 255, 0.1)';
    ctx.beginPath();
    ctx.moveTo(cx - R, cy);
    ctx.lineTo(cx + R, cy);
    ctx.moveTo(cx, cy - R);
    ctx.lineTo(cx, cy + R);
    ctx.stroke();
    // 死區範圍
    const dz = (CONFIG.GYRO_DEADZONE / this.gyro.maxTilt) * R;
    ctx.fillStyle = 'rgba(244, 240, 255, 0.06)';
    ctx.fillRect(cx - dz, cy - R, dz * 2, R * 2);

    const raw = this.gyro.hasSignal
      ? clamp((this.gyro.rawTilt - this.gyro.baseGamma) / this.gyro.maxTilt, -1, 1)
      : 0;
    const dx = raw * (R - 8);
    const dy = this.gyro.pitchAxis * (R - 8);
    ctx.fillStyle = this.gyro.hasSignal ? 'rgba(255, 181, 71, 0.75)' : 'rgba(244, 240, 255, 0.3)';
    ctx.beginPath();
    ctx.arc(cx + dx, cy + dy, 8, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * 管理所有輸入：指標事件 → 邏輯座標 → 目前的 Control；鍵盤方向鍵一律可用（桌機測試）
 */
export class InputManager {
  constructor(canvas, viewport, gyro) {
    this.canvas = canvas;
    this.viewport = viewport;
    this.controls = {
      tap: new TapControl(),
      buttons: new ButtonsControl(),
      joystick: new JoystickControl(),
      gyro: new GyroControl(gyro),
    };
    this.mode = 'tap';
    this.enabled = false;
    this.keys = { left: false, right: false };
    this.bind();
  }

  get current() {
    return this.controls[this.mode];
  }

  get axis() {
    const k = (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0);
    return k !== 0 ? k : this.current.axis;
  }

  setMode(mode) {
    this.current.reset();
    this.mode = mode;
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) this.reset();
  }

  reset() {
    for (const c of Object.values(this.controls)) c.reset();
    this.keys.left = this.keys.right = false;
  }

  layout() {
    return { W: this.viewport.W, H: this.viewport.H };
  }

  bind() {
    const c = this.canvas;
    const route = (type) => (e) => {
      e.preventDefault();
      if (!this.enabled) return;
      const { x, y } = this.viewport.toWorld(e.clientX, e.clientY);
      if (type === 'down') {
        try {
          c.setPointerCapture(e.pointerId);
        } catch {
          /* 部分瀏覽器對合成事件會丟例外 */
        }
      }
      this.current[type](e.pointerId, x, y, this.layout());
    };
    c.addEventListener('pointerdown', route('down'));
    c.addEventListener('pointermove', route('move'));
    c.addEventListener('pointerup', route('up'));
    c.addEventListener('pointercancel', route('up'));
    c.addEventListener('lostpointercapture', (e) => this.current.up(e.pointerId));

    // 防止捲動、雙擊放大、長按選單
    const block = (e) => e.preventDefault();
    for (const t of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
      c.addEventListener(t, block, { passive: false });
    }
    c.addEventListener('contextmenu', block);
    c.addEventListener('dblclick', block);
    document.addEventListener('gesturestart', block, { passive: false });

    const setKey = (e, down) => {
      const k = e.key;
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') this.keys.left = down;
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') this.keys.right = down;
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', (e) => setKey(e, true));
    window.addEventListener('keyup', (e) => setKey(e, false));
    window.addEventListener('blur', () => this.reset());
  }

  draw(ctx) {
    this.current.draw(ctx, this.layout());
  }
}
