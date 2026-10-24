import { CONFIG } from './config.js';
import { World } from './world.js';

/**
 * 遊戲狀態機 + 主迴圈
 * menu → countdown → playing ⇄ paused → over
 *
 * 物理、平台與生成全部在 World（world.js）；這裡只管狀態、倒數、輸入、畫面特效與 hooks。
 * 主迴圈使用 requestAnimationFrame + Delta Time，物理每幀切成 <= 1/120 秒的子步，
 * 60Hz / 90Hz / 120Hz / 144Hz 的速度與手感都一致。
 */
export class Game {
  constructor({ viewport, renderer, input, gyro, hooks = {} }) {
    this.viewport = viewport;
    this.renderer = renderer;
    this.input = input;
    this.gyro = gyro;
    this.hooks = hooks;

    this.world = new World({ height: viewport.H, events: this.worldEvents() });
    this.state = 'menu';
    this.pausedFrom = null;
    this.autoCalibrate = true;
    this.time = 0;

    this.setupWorld();
    this.lastT = null;
    this.frame = this.frame.bind(this);
    requestAnimationFrame(this.frame);
  }

  // World 的資料直接讀寫，renderer 與外部程式碼不用改
  get player() { return this.world.player; }
  get platforms() { return this.world.platforms; }
  get generator() { return this.world.generator; }
  get floor() { return this.world.floor; }
  set floor(v) { this.world.floor = v; }
  get depth() { return this.world.depth; }
  get riseSpeed() { return this.world.rise; }
  get stage() { return this.world.stage; }
  get gameMode() { return this.world.gameMode; }
  set gameMode(v) { this.world.gameMode = v; }

  /** 物理世界發生的事 → 畫面特效與 hooks */
  worldEvents() {
    const h = () => this.hooks;
    return {
      safeLand: (p) => h().onSafeLand && h().onSafeLand(p),
      hurt: (src) => this.onHurt(src),
      heal: () => {
        this.healFlash = 1;
        if (h().onHeal) h().onHeal();
      },
      over: () => this.gameOver(),
      spring: (p) => h().onFx && h().onFx('spring', p),
      flip: (p) => h().onFx && h().onFx('flip', p),
      portalArm: (portal) => h().onFx && h().onFx('portalArm', portal),
      portal: (dest, portal) => {
        this.flash = Math.max(this.flash, 0.5);
        if (h().onFx) h().onFx('portal', portal);
      },
      stage: (stage) => h().onStage && h().onStage(stage),
      endgame: () => h().onEndgame && h().onEndgame(),
    };
  }

  setupWorld() {
    this.world.reset(this.viewport.H);
    this.shake = 0;
    this.flash = 0;
    this.healFlash = 0;
    this.goTimer = 0;
    this.countdown = 0;
  }

  // ───────── 狀態切換 ─────────

  start() {
    this.setupWorld();
    if (this.hooks.onRunStart) this.hooks.onRunStart();
    this.beginCountdown();
    this.input.setEnabled(true);
  }

  pause() {
    if (this.state !== 'playing' && this.state !== 'countdown') return false;
    this.pausedFrom = this.state;
    this.setState('paused');
    this.input.setEnabled(false);
    return true;
  }

  /** 繼續遊戲：同樣先倒數 3、2、1，倒數期間物理與平台上升都停止 */
  resume() {
    if (this.state !== 'paused') return;
    this.beginCountdown();
    this.input.setEnabled(true);
    this.lastT = null;
  }

  beginCountdown() {
    this.countdown = CONFIG.COUNTDOWN;
    this.goTimer = 0;
    this.lastTick = CONFIG.COUNTDOWN;
    this.setState('countdown');
    if (this.hooks.onTick) this.hooks.onTick(CONFIG.COUNTDOWN);
  }

  setState(next) {
    this.state = next;
    if (this.hooks.onState) this.hooks.onState(next);
  }

  toMenu() {
    this.setState('menu');
    this.input.setEnabled(false);
    this.setupWorld();
  }

  calibrateGyro(auto = false) {
    this.gyro.calibrate();
    if (this.hooks.onCalibrated) this.hooks.onCalibrated(auto);
  }

  // ───────── 主迴圈 ─────────

  frame(t) {
    requestAnimationFrame(this.frame);
    const dt = this.lastT == null ? 0 : Math.min((t - this.lastT) / 1000, CONFIG.MAX_FRAME_DT);
    this.lastT = t;
    this.update(dt);
    this.renderer.render(this, this.input);
  }

  update(dt) {
    if (this.state === 'paused') return;
    this.time += dt;
    this.shake = Math.max(0, this.shake - dt * 2.2);
    this.flash = Math.max(0, this.flash - dt * 2.5);
    this.healFlash = Math.max(0, this.healFlash - dt * 1.5);
    this.goTimer = Math.max(0, this.goTimer - dt);

    if (this.state === 'countdown') {
      const prev = this.countdown;
      this.countdown -= dt;
      const shown = Math.ceil(this.countdown);
      if (shown > 0 && shown < this.lastTick) {
        this.lastTick = shown;
        if (this.hooks.onTick) this.hooks.onTick(shown);
      }
      // 「1」結束、0 秒的瞬間：擷取平衡點並開始（開局與暫停後繼續都一樣）
      if (prev > 0 && this.countdown <= 0) this.onGo();
      return;
    }
    if (this.state !== 'playing') return;

    this.world.update(dt, this.input.axis);
  }

  onGo() {
    this.countdown = 0;
    this.setState('playing');
    this.goTimer = 0.6;
    if (this.input.mode === 'gyro' && this.autoCalibrate) this.calibrateGyro(true);
    if (this.hooks.onGo) this.hooks.onGo();
  }

  // ───────── 事件 ─────────

  onHurt(src) {
    if (this.hooks.onHurt) this.hooks.onHurt(src);
    this.shake = 0.7;
    this.flash = 1;
    if (navigator.vibrate) {
      try {
        navigator.vibrate(60);
      } catch {
        /* 不支援震動 */
      }
    }
  }

  gameOver() {
    if (this.state !== 'playing') return;
    this.setState('over');
    this.shake = 1;
    this.input.setEnabled(false);
    if (this.hooks.onGameOver) this.hooks.onGameOver(this.floor);
  }
}
