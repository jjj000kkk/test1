import { CONFIG, CONTROL_MODES } from './config.js';
import { GAME_MODES, isModeUnlocked } from './modes.js';
import { storage } from './utils.js';

const SETTINGS_KEY = 'kids-downstairs.settings.v1';
const BEST_KEY = 'kids-downstairs.best.v1';        // 舊版：單一最佳紀錄
const BESTS_KEY = 'kids-downstairs.bests.v2';       // 新版：每個遊戲模式各一筆

export const DEFAULT_SETTINGS = Object.freeze({
  mode: 'tap',          // 操控方式
  gameMode: 'standard', // 遊戲模式：standard | turbo | nightmare
  autoCalibrate: true,
  gyroTilt: CONFIG.GYRO_DEFAULT_TILT,
  sfx: true,
  nickname: '', // 上次上傳排行榜用的暱稱
  deathReplay: false, // 預設關閉：要先看過說明並允許麥克風才會錄
});

export function loadSettings() {
  const saved = storage.get(SETTINGS_KEY, {});
  const merged = { ...DEFAULT_SETTINGS, ...saved };
  if (!CONTROL_MODES.some((m) => m.id === merged.mode)) merged.mode = DEFAULT_SETTINGS.mode;
  if (!GAME_MODES.some((m) => m.id === merged.gameMode)) merged.gameMode = DEFAULT_SETTINGS.gameMode;
  // 舊版把「困難賽道」綁在陀螺儀操控模式；新版陀螺儀只是標籤，不再限定賽道
  return merged;
}

/** 存檔前先確認地獄模式有沒有解鎖，沒解鎖就退回標準 */
export function sanitizeGameMode(settings, bests) {
  if (!isModeUnlocked(settings.gameMode, bests)) settings.gameMode = DEFAULT_SETTINGS.gameMode;
}

export function saveSettings(settings) {
  storage.set(SETTINGS_KEY, settings);
}

const num = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/** { standard, turbo, nightmare }；第一次升級時把舊的單一紀錄算在標準模式 */
export function loadBests() {
  const saved = storage.get(BESTS_KEY, null);
  if (saved && typeof saved === 'object') {
    return { standard: num(saved.standard), turbo: num(saved.turbo), nightmare: num(saved.nightmare) };
  }
  return { standard: num(storage.get(BEST_KEY, 0)), turbo: 0, nightmare: 0 };
}

export const saveBests = (bests) => storage.set(BESTS_KEY, bests);
