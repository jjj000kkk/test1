import { AUDIO, CONFIG } from './config.js';

/**
 * 遊戲模式：只改「上升速度」，操控方式（點擊 / 按鍵 / 搖桿 / 陀螺儀）可以自由搭配。
 * trackId 決定成績進哪個排行榜：標準與極速共用 standard，地獄獨佔 nightmare。
 */
export const GAME_MODES = Object.freeze([
  { id: 'standard', name: '標準模式', badge: '1.0x', mult: 1, trackId: 'standard', desc: '以基礎速度開始，隨層數慢慢加快' },
  { id: 'turbo', name: '極速模式', badge: '1.5x', mult: 1.5, trackId: 'standard', desc: '開局就是 1.5 倍速，追上標準速度後再照原公式加速' },
  { id: 'nightmare', name: '地獄模式', badge: '2.0x', mult: 2, trackId: 'nightmare', desc: '開局 2 倍速。標準或極速打到 B150F 解鎖', locked: true },
]);

export const gameModeById = (id) => GAME_MODES.find((m) => m.id === id) || GAME_MODES[0];

/** V_base：標準模式 B0F 的上升速度 */
export const V_BASE = CONFIG.RISE_BASE;

/** 標準模式的上升速度（原本的遞增公式）。沒有第四階段加成，用來當作其他模式的對照基準 */
export function getSpeedByFloor(floor) {
  return Math.min(CONFIG.RISE_MAX, CONFIG.RISE_BASE + floor * CONFIG.RISE_PER_FLOOR);
}

/** 標準速度第一次 >= mult × V_base 的樓層；永遠追不上（超過速度上限）時回傳 Infinity */
export function releaseFloor(mult) {
  const target = mult * V_BASE;
  if (target <= V_BASE) return 0;
  if (target > CONFIG.RISE_MAX) return Infinity;
  return Math.ceil((target - CONFIG.RISE_BASE) / CONFIG.RISE_PER_FLOOR);
}

/**
 * 各模式的實際上升速度：
 *   開局鎖在 mult × V_base，直到標準速度追上那個值（releaseFloor），之後完全跟著標準公式走。
 *   超過 B200F，所有模式再加 20%。
 */
export function riseSpeedFor(modeId, floor) {
  const { mult } = gameModeById(modeId);
  const held = floor < releaseFloor(mult) ? mult * V_BASE : 0;
  const speed = Math.max(held, getSpeedByFloor(floor));
  return floor > CONFIG.RISE_BONUS_FLOOR ? speed * CONFIG.RISE_BONUS : speed;
}

/** bests: { standard, turbo, nightmare }，單位都是樓層 */
export function isNightmareUnlocked(bests) {
  return Math.max(bests.standard || 0, bests.turbo || 0) >= CONFIG.NIGHTMARE_UNLOCK_FLOOR;
}

export function isModeUnlocked(modeId, bests) {
  return modeId !== 'nightmare' || isNightmareUnlocked(bests);
}

/** 三種模式的歷史最高樓層取最大值 */
export function bestOverall(bests) {
  return Math.max(bests.standard || 0, bests.turbo || 0, bests.nightmare || 0);
}

/** 最高紀錄達到 AUDIO.VOICE_UNLOCK_FLOOR（B30）就開放自訂語音包 */
export function isVoicePackUnlocked(bests) {
  return bestOverall(bests) >= AUDIO.VOICE_UNLOCK_FLOOR;
}
