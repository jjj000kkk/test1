import { AudioManager, ALL_SLOT_IDS } from './audio.js';
import { AUDIO, CONFIG, FX } from './config.js';
import { Kind, KIND_LABEL } from './kinds.js';
import { Game } from './game.js';
import { GYRO_MESSAGES, Gyro } from './gyro.js';
import { InputManager } from './input.js';
import { ReplayController } from './replay.js';
import { Renderer } from './renderer.js';
import { bestOverall, GAME_MODES, gameModeById, isModeUnlocked, isNightmareUnlocked, isVoicePackUnlocked, riseSpeedFor } from './modes.js';
import { createPlatform } from './platform-types.js';
import { PlatformGenerator } from './platforms.js';
import { StageManager, STAGES } from './stages.js';
import { stepWorld, World } from './world.js';
import { loadBests, loadSettings, sanitizeGameMode, saveBests, saveSettings } from './settings.js';
import { cleanName, describeError, fetchRank, fetchTop, submitScore, TOP_LIMIT, trackOfMode } from './supabase.js';
import { UI } from './ui.js';
import { Viewport } from './viewport.js';

const settings = loadSettings();
let bests = loadBests();
sanitizeGameMode(settings, bests);
let settingsReturnTo = 'title';
let boardReturnTo = 'title';
let boardTrack = 'standard';
let boardToken = 0;
let boardMine = null; // 剛上傳的成績，用來在榜上標出自己
// 這一局的排行榜資料：模式在開局時就鎖定，中途換模式的成績不收
// gyroOnly：整局都用陀螺儀才算體感（中途換過操控方式就當一般按鍵），📱 標章才有意義
let run = { gameMode: settings.gameMode, gyroOnly: settings.mode === 'gyro' };
let lastRun = null;

const ui = new UI();
ui.bindConfirm();
const viewport = new Viewport(
  document.getElementById('app'),
  document.getElementById('stage'),
  document.getElementById('game'),
);
const gyro = new Gyro();
gyro.maxTilt = settings.gyroTilt;
const input = new InputManager(viewport.canvas, viewport, gyro);
input.setMode(settings.mode);
const renderer = new Renderer(viewport);

// ───────── 音效 ─────────

const audio = new AudioManager();
audio.enabled = settings.sfx;
const replay = new ReplayController({ audio, ui });

audio.onMicChange = (state) => ui.setMicStatus(state);
audio.onClipsChange = () => {
  for (const id of ALL_SLOT_IDS) ui.setSlotState(id, audio.hasClip(id), audio.clipSeconds(id));
};
audio.loadStored();

// iOS / Safari 要在使用者手勢內 resume 才能出聲：任何第一次點擊、觸控或按鍵都先解鎖
for (const type of ['pointerdown', 'touchend', 'keydown']) {
  document.addEventListener(type, () => audio.unlock(), { capture: true, passive: true });
}

const MIC_NOTICE = '僅保留死前10秒於本機，不會上傳。錄音只用在自訂音效與死前重播。要啟用麥克風嗎？';

async function askForMic(message = MIC_NOTICE) {
  audio.unlock();
  if (audio.mic.state === 'on') return true;
  const ok = await ui.confirm(message, { ok: '啟用', cancel: '先不要' });
  if (!ok) return false;
  const granted = await audio.enableMic();
  if (!granted) {
    ui.toast(
      audio.mic.state === 'denied'
        ? '麥克風權限被拒絕，請到瀏覽器的網站設定開啟'
        : '這個環境無法使用麥克風',
      3200,
    );
  }
  return granted;
}

// ───────── 遊戲與 Hooks ─────────

const game = new Game({
  viewport,
  renderer,
  input,
  gyro,
  hooks: {
    onCalibrated(auto) {
      ui.toast(auto ? '🎯 已自動校正平衡點' : '🎯 已將目前角度設為平衡點');
    },
    onHeal() {
      ui.toast('連踩 15 階，回復 0.5 HP', 1200);
      audio.play('heal');
    },
    onTick: () => audio.play('tick'),
    onGo: () => audio.play('go'),
    onSafeLand: (p) => audio.play('safe', p.index, { platform: p, hp: game.player.hp }),
    onHurt: (src) => audio.play('hurt', game.floor, { platform: src, hp: game.player.hp }),
    onRunStart: () => audio.beginRun(),
    onStage: (stage) => ui.toast(`第 ${stage.id} 階段：${stage.name}`, 2200),
    onEndgame: () => ui.toast(`B${FX.ENDGAME_FLOOR}！終極平台登場：雷射與幻影`, 2600),
    onFx: (name, p) => audio.play(name === 'spring' ? 'jump' : name === 'portal' ? 'heal' : 'tick', p ? p.index : 0),
    // 只有「遊玩中」才錄：暫停與倒數不佔用那 10 秒
    onState: (state) => audio.setCapturing(settings.deathReplay && state === 'playing'),
    onGameOver(floor) {
      const snap = settings.deathReplay ? audio.freeze() : null;
      const hadHell = isNightmareUnlocked(bests);
      const hadVoice = isVoicePackUnlocked(bests);
      const prevBest = bests[run.gameMode] || 0;
      if (floor > prevBest) {
        bests[run.gameMode] = floor;
        saveBests(bests);
      }
      ui.setPlayingHud(false, false);
      prepareSubmit(floor);
      ui.$('over-floor').textContent = `B${floor}F`;
      const gm = gameModeById(run.gameMode);
      ui.$('over-best').textContent = floor > prevBest && floor > 0 ? `${gm.name}新紀錄！` : `${gm.name}最佳紀錄 B${bests[run.gameMode]}F`;
      refreshBest();
      if (!hadVoice && isVoicePackUnlocked(bests)) {
        syncVoice();
        ui.toast(`🎙️ 自訂語音包解鎖了！到設定裡錄你的踩踏音效`, 3200);
      }
      if (!hadHell && isNightmareUnlocked(bests)) {
        ui.$('over-best').textContent += '　🔥 地獄模式解鎖了！';
        ui.toast('🔥 地獄模式解鎖了！到設定裡選擇', 3200);
      }
      audio.play('over');
      setTimeout(() => {
        ui.show('over');
        replay.prepare(snap, `B${floor}F`);
      }, 450);
    },
  },
});
game.autoCalibrate = settings.autoCalibrate;

/** 重畫設定選單與主選單上跟遊戲模式、解鎖狀態有關的部分 */
function syncUi(lockGameMode = false) {
  ui.syncSettings(settings, { bests, lockGameMode });
  ui.setBoardLocks(isNightmareUnlocked(bests) ? [] : ['nightmare']);
  syncVoice();
}

/** 最高紀錄 B30 以上才開放自訂語音包：沒解鎖時不播自訂錄音、也不能錄 */
function syncVoice() {
  const unlocked = isVoicePackUnlocked(bests);
  audio.voiceUnlocked = unlocked;
  ui.setVoiceLock(unlocked, bestOverall(bests), AUDIO.VOICE_UNLOCK_FLOOR);
}

function refreshBest() {
  ui.setBest(bests[settings.gameMode] || 0);
}

syncUi();
refreshBest();
ui.setMicStatus('off');
ui.show('title');

// ───────── 陀螺儀權限 ─────────

function showGyroDenied() {
  ui.setGyroStatus(GYRO_MESSAGES.denied);
  ui.toast(GYRO_MESSAGES.denied, 4200);
}

/** 必須在點擊事件中同步呼叫，iOS 才會跳出權限視窗 */
function ensureGyroPermission() {
  return gyro.requestPermission().then((state) => {
    if (state === 'denied') showGyroDenied();
    else if (state === 'unsupported') {
      ui.setGyroStatus(GYRO_MESSAGES.unsupported);
      ui.toast(GYRO_MESSAGES.unsupported, 3200);
    } else ui.setGyroStatus(gyro.needsPermission ? '已取得陀螺儀權限。' : '');
    return state;
  });
}

/** 在設定裡切到陀螺儀模式：還沒授權就立刻要，被拒絕過就直接提示怎麼開 */
function onGyroModeSelected() {
  if (gyro.permission === 'denied') {
    showGyroDenied();
    return;
  }
  if (gyro.permission !== 'granted') ensureGyroPermission();
}

function warnIfNoGyroSignal() {
  setTimeout(() => {
    const active = game.state === 'countdown' || game.state === 'playing';
    if (active && input.mode === 'gyro' && gyro.permission === 'granted' && !gyro.hasSignal) {
      ui.toast('沒有收到陀螺儀訊號（電腦或內嵌預覽無法使用），可先用鍵盤 ← → 測試', 3600);
    }
  }, 2200);
}

// ───────── 流程 ─────────

function startGame() {
  audio.unlock();
  sanitizeGameMode(settings, bests);
  run = { gameMode: settings.gameMode, gyroOnly: settings.mode === 'gyro' };
  game.gameMode = run.gameMode;
  lastRun = null;
  ui.hideSubmit();
  if (settings.deathReplay) audio.enableMicIfGranted();
  replay.reset();
  const gyroMode = settings.mode === 'gyro';
  if (gyroMode) ensureGyroPermission();
  ui.show(null);
  ui.setPlayingHud(true, gyroMode);
  game.start();
  if (gyroMode) warnIfNoGyroSignal();
}

function pauseGame() {
  if (!game.pause()) return;
  ui.$('pause-floor').textContent = `B${game.floor}F`;
  ui.show('pause');
}

/** 繼續之前先倒數 3、2、1（由 Game.resume 處理），讓玩家有時間調整姿勢 */
function resumeGame() {
  ui.show(null);
  game.resume();
}

function openSettings(from) {
  audio.unlock();
  settingsReturnTo = from;
  syncUi(from === 'pause');
  ui.show('settings');
}

function closeSettings() {
  saveSettings(settings);
  refreshBest();
  if (settingsReturnTo === 'pause') {
    ui.setPlayingHud(true, settings.mode === 'gyro');
    ui.show('pause');
  } else {
    ui.show('title');
  }
}

function backToMenu() {
  replay.reset();
  ui.hideSubmit();
  game.toMenu();
  ui.setPlayingHud(false, false);
  ui.show('title');
}

async function restartGame() {
  const ok = await ui.confirm('確定要重新開始嗎？目前的層數將會重置！', { ok: '重新開始', cancel: '取消' });
  if (ok) startGame();
}

// ───────── 排行榜 ─────────

function openLeaderboard(from, trackId) {
  boardReturnTo = from;
  ui.show('leaderboard');
  loadBoard(trackId || boardTrack);
}

function closeLeaderboard() {
  ui.show(boardReturnTo);
}

async function loadBoard(trackId) {
  boardTrack = trackId;
  const token = ++boardToken;
  ui.setBoardTab(trackId);
  if (trackId === 'nightmare' && !isNightmareUnlocked(bests)) {
    const top = Math.max(bests.standard, bests.turbo);
    ui.setBoardStatus(`🔒 地獄賽道還沒解鎖。標準或極速模式打到 B${CONFIG.NIGHTMARE_UNLOCK_FLOOR}F 就會開放（你目前最高 B${top}F）。`);
    return;
  }
  ui.setBoardStatus('載入中…');
  try {
    const rows = await fetchTop(trackId);
    if (token !== boardToken) return;
    const mine = boardMine && boardMine.track === trackId ? boardMine : null;
    ui.renderBoard(rows, (row) => Boolean(mine) && row.player_name === mine.name && row.score === mine.score);
  } catch (err) {
    if (token !== boardToken) return;
    ui.setBoardStatus(`連不上排行榜。${describeError(err)}`, { retry: true });
  }
}

/** 結算：這局能不能上傳、記在哪個賽道 */
function prepareSubmit(floor) {
  const track = trackOfMode(run.gameMode);
  const gm = gameModeById(run.gameMode);
  lastRun = { floor, track, submitted: false, name: '' };
  const reason = floor < 1 ? '至少要下到 B1F 才能上傳成績。' : '';
  const how = run.gyroOnly ? '📱 體感' : '按鍵 / 點擊';
  ui.showSubmit({ trackLabel: `${track.label}（${gm.name} ${gm.badge}・${how}）`, nickname: settings.nickname, reason });
}

async function showRankFor(entry) {
  ui.setSubmitBusy(true, '查詢排名中…');
  try {
    const rank = await fetchRank(entry.track.id, entry.floor);
    ui.showRank({ trackLabel: entry.track.label, rank, inTop: rank <= TOP_LIMIT });
  } catch (err) {
    ui.setSubmitStatus(`成績已上傳，但查不到排名。${describeError(err)}`, true);
    ui.setRankRetry();
  }
}

async function submitRun() {
  const entry = lastRun;
  if (!entry) return;
  if (entry.submitted) {
    showRankFor(entry);
    return;
  }
  const name = cleanName(ui.nicknameValue);
  if (!name) {
    ui.setSubmitStatus('請先輸入暱稱。', true);
    ui.focusNickname();
    return;
  }
  ui.setSubmitStatus('');
  ui.setSubmitBusy(true, '上傳中…');
  try {
    await submitScore({ name, score: entry.floor, mode: run.gameMode, inputType: run.gyroOnly ? 'gyro' : 'button' });
  } catch (err) {
    ui.setSubmitBusy(false, '上傳成績');
    ui.setSubmitStatus(`上傳失敗。${describeError(err)}`, true);
    return;
  }
  entry.submitted = true;
  entry.name = name;
  settings.nickname = name;
  saveSettings(settings);
  boardMine = { name, score: entry.floor, track: entry.track.id };
  await showRankFor(entry);
}

const on = (id, fn) => ui.$(id).addEventListener('click', fn);
on('btn-start', startGame);
on('btn-open-settings', () => openSettings('title'));
on('btn-open-leaderboard', () => openLeaderboard('title'));
on('btn-x-leaderboard', closeLeaderboard);
on('btn-close-settings', closeSettings);
on('btn-x-settings', closeSettings);
on('btn-pause', pauseGame);
on('btn-resume', resumeGame);
on('btn-x-pause', resumeGame);
on('btn-restart', restartGame);
on('btn-pause-settings', () => openSettings('pause'));
on('btn-pause-menu', backToMenu);
on('btn-retry', startGame);
on('btn-over-menu', backToMenu);
ui.bindLeaderboard({ onTab: loadBoard, onRetry: () => loadBoard(boardTrack) });
ui.bindSubmit({
  onSubmit: submitRun,
  onShowBoard: () => openLeaderboard('over', lastRun ? lastRun.track.id : undefined),
});
on('btn-calibrate', () => game.calibrateGyro(false));
on('btn-recalibrate', () => game.calibrateGyro(false));

// ───────── 設定 ─────────

ui.$('mode-list').addEventListener('change', (e) => {
  if (e.target.name !== 'mode') return;
  settings.mode = e.target.value;
  if (game.state === 'paused') run.gyroOnly = false;
  input.setMode(settings.mode);
  syncUi(settingsReturnTo === 'pause');
  saveSettings(settings);
  if (settings.mode === 'gyro') onGyroModeSelected();
  else ui.setGyroStatus('');
});

ui.$('gamemode-list').addEventListener('change', (e) => {
  if (e.target.name !== 'gamemode' || !isModeUnlocked(e.target.value, bests)) return;
  settings.gameMode = e.target.value;
  saveSettings(settings);
  syncUi(settingsReturnTo === 'pause');
  refreshBest();
});

ui.$('opt-autocal').addEventListener('change', (e) => {
  settings.autoCalibrate = e.target.checked;
  game.autoCalibrate = settings.autoCalibrate;
  saveSettings(settings);
});

ui.$('opt-tilt').addEventListener('input', (e) => {
  settings.gyroTilt = Number(e.target.value);
  gyro.maxTilt = settings.gyroTilt;
  ui.$('opt-tilt-out').textContent = String(settings.gyroTilt);
  saveSettings(settings);
});

ui.$('opt-sfx').addEventListener('change', (e) => {
  settings.sfx = e.target.checked;
  audio.enabled = settings.sfx;
  saveSettings(settings);
});

ui.$('opt-replay').addEventListener('change', async (e) => {
  settings.deathReplay = e.target.checked;
  saveSettings(settings);
  if (settings.deathReplay && audio.mic.state !== 'on') {
    await askForMic(`${MIC_NOTICE}\n不啟用的話，重播只會有遊戲音效。`);
  }
});

on('btn-mic', async () => {
  audio.unlock();
  if (audio.mic.state === 'on') audio.disableMic();
  else await askForMic();
});

// ───────── 自訂音效槽位 ─────────

async function beginRecording(id) {
  audio.unlock();
  if (audio.mic.state !== 'on') {
    ui.toast('請先在上方啟用麥克風');
    return;
  }
  if (!audio.startClip(id)) return;
  ui.setSlotRecording(id, true);
  const result = await audio.clipDone;
  ui.setSlotRecording(id, false);
  ui.setSlotState(id, audio.hasClip(id), audio.clipSeconds(id));
  if (result.ok) ui.toast(`已儲存（${result.seconds.toFixed(1)} 秒）`);
  else if (result.reason === 'short') ui.toast('太短了，請按住說話再放開');
  else ui.toast('錄音失敗，請再試一次');
}

ui.bindSlots({
  onRecStart: beginRecording,
  onRecEnd: (id) => audio.stopClip(id),
  onPlay: (id) => {
    audio.unlock().then(() => audio.previewClip(id));
  },
  onDelete: (id) => audio.deleteClip(id),
});

// ───────── 系統事件 ─────────

document.addEventListener('visibilitychange', () => {
  if (document.hidden) pauseGame();
});

window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' && e.key !== 'p' && e.key !== 'P') return;
  if (e.key !== 'Escape' && e.target instanceof HTMLInputElement && e.target.type === 'text') return; // 打暱稱時的 p 不是暫停
  if (ui.confirmOpen) {
    if (e.key === 'Escape') ui.closeConfirm(false);
    return;
  }
  if (!ui.screens.settings.hidden) {
    closeSettings();
    return;
  }
  if (!ui.screens.leaderboard.hidden) {
    closeLeaderboard();
    return;
  }
  if (game.state === 'paused' && !ui.screens.pause.hidden) resumeGame();
  else pauseGame();
});

// 開發/測試用：在 console 可用 window.__game 檢查狀態
window.__game = game;
window.__audio = audio;

// 自動測試模擬器（autoTest.js）貼到 console 執行時，從這裡拿遊戲的內部類別
window.__kd = { CONFIG, FX, Kind, KIND_LABEL, GAME_MODES, STAGES, StageManager, PlatformGenerator, World, stepWorld, riseSpeedFor, createPlatform };
