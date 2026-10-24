import { CONFIG } from './config.js';
import { applyDeadzone, clamp } from './utils.js';

export const GYRO_MESSAGES = Object.freeze({
  denied: '陀螺儀權限已被拒絕，請至 Safari 設定開啟『動作與方向取用』',
  unsupported: '這個瀏覽器不支援陀螺儀，請改用其他操控模式。',
});

/**
 * 陀螺儀體感：讀取 deviceorientation 的 gamma（左右傾斜）。
 * - iOS 13+ 必須在使用者手勢中呼叫 DeviceOrientationEvent.requestPermission()
 * - 橫向握持時改用 beta，並依 screen.orientation 修正正負號
 */
export class Gyro {
  constructor() {
    this.rawTilt = 0;     // 左右（相對螢幕）
    this.rawPitch = 0;    // 前後，只用來畫姿態指示器的 Y
    this.baseGamma = 0;   // 平衡點
    this.basePitch = 0;
    this.maxTilt = CONFIG.GYRO_DEFAULT_TILT;
    this.listening = false;
    this.lastEventAt = 0;
    this.permission = 'unknown'; // unknown | granted | denied | unsupported
    this.onOrientation = this.onOrientation.bind(this);
  }

  get supported() {
    return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
  }

  get needsPermission() {
    return this.supported && typeof DeviceOrientationEvent.requestPermission === 'function';
  }

  /** 一定要在 click / touchend 等使用者手勢的同步流程中呼叫 */
  requestPermission() {
    if (!this.supported) {
      this.permission = 'unsupported';
      return Promise.resolve(this.permission);
    }
    if (this.permission === 'granted') {
      this.start();
      return Promise.resolve(this.permission);
    }
    if (!this.needsPermission) {
      this.permission = 'granted';
      this.start();
      return Promise.resolve(this.permission);
    }
    return DeviceOrientationEvent.requestPermission()
      .then((state) => {
        this.permission = state === 'granted' ? 'granted' : 'denied';
        if (this.permission === 'granted') this.start();
        return this.permission;
      })
      .catch(() => {
        this.permission = 'denied';
        return this.permission;
      });
  }

  start() {
    if (this.listening) return;
    window.addEventListener('deviceorientation', this.onOrientation);
    this.listening = true;
  }

  stop() {
    window.removeEventListener('deviceorientation', this.onOrientation);
    this.listening = false;
  }

  onOrientation(e) {
    if (e.gamma == null || e.beta == null) return;
    const angle = (screen.orientation && screen.orientation.angle) ?? window.orientation ?? 0;
    switch ((angle + 360) % 360) {
      case 90:
        this.rawTilt = e.beta;
        this.rawPitch = -e.gamma;
        break;
      case 270:
        this.rawTilt = -e.beta;
        this.rawPitch = e.gamma;
        break;
      case 180:
        this.rawTilt = -e.gamma;
        this.rawPitch = -e.beta;
        break;
      default:
        this.rawTilt = e.gamma;
        this.rawPitch = e.beta;
    }
    this.lastEventAt = performance.now();
  }

  get hasSignal() {
    return performance.now() - this.lastEventAt < 1000;
  }

  /** 以目前角度作為平衡點 (baseGamma) */
  calibrate() {
    this.baseGamma = this.rawTilt;
    this.basePitch = this.rawPitch;
  }

  get axis() {
    if (!this.hasSignal) return 0;
    const delta = this.rawTilt - this.baseGamma;
    return applyDeadzone(clamp(delta / this.maxTilt, -1, 1), CONFIG.GYRO_DEADZONE / this.maxTilt);
  }

  get pitchAxis() {
    if (!this.hasSignal) return 0;
    return clamp((this.rawPitch - this.basePitch) / this.maxTilt, -1, 1);
  }
}
