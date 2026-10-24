import { CONFIG } from './config.js';
import { clamp } from './utils.js';

/**
 * 依可用空間決定舞台大小與邏輯高度：
 * - 寬度固定 360 邏輯單位，直式手機會鋪滿全螢幕
 * - 高度依比例落在 MIN_H~MAX_H；桌機或橫向時左右留黑邊
 * - Canvas 依 devicePixelRatio 提高解析度
 */
export class Viewport {
  constructor(app, stage, canvas) {
    this.app = app;
    this.stage = stage;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.W = CONFIG.WORLD_W;
    this.H = CONFIG.MIN_H;
    this.scale = 1;
    this.listeners = [];
    this.resize = this.resize.bind(this);
    window.addEventListener('resize', this.resize);
    window.addEventListener('orientationchange', this.resize);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', this.resize);
    this.resize();
  }

  onResize(fn) {
    this.listeners.push(fn);
  }

  resize() {
    const cs = getComputedStyle(this.app);
    const availW = this.app.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const availH = this.app.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (availW <= 0 || availH <= 0) return;

    let scale = availW / CONFIG.WORLD_W;
    let H = availH / scale;
    if (H < CONFIG.MIN_H) {
      H = CONFIG.MIN_H;
      scale = availH / H;
    }
    H = clamp(H, CONFIG.MIN_H, CONFIG.MAX_H);

    const cssW = Math.floor(CONFIG.WORLD_W * scale);
    const cssH = Math.floor(H * scale);
    const dpr = Math.min(window.devicePixelRatio || 1, 3);

    this.H = H;
    this.scale = scale;
    this.dpr = dpr;
    this.stage.style.width = `${cssW}px`;
    this.stage.style.height = `${cssH}px`;
    this.stage.style.setProperty('--ui-scale', String(clamp(scale, 0.8, 1.6)));
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.listeners.forEach((fn) => fn(this));
  }

  /** 每幀開始前呼叫：把繪圖座標設成邏輯座標 */
  beginFrame() {
    const k = this.scale * this.dpr;
    this.ctx.setTransform(k, 0, 0, k, 0, 0);
    return this.ctx;
  }

  toWorld(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: ((clientX - r.left) / r.width) * this.W,
      y: ((clientY - r.top) / r.height) * this.H,
    };
  }
}
