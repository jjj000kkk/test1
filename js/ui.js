import { AUDIO, CLIP_KINDS, CONTROL_MODES } from './config.js';
import { slotId } from './audio.js';
import { GAME_MODES, gameModeById, isModeUnlocked } from './modes.js';
import { TRACKS } from './supabase.js';

const MIC_TEXT = {
  off: '未啟用',
  on: '已啟用，聲音只留在這台裝置',
  denied: '權限被拒絕。請到瀏覽器的網站設定開啟麥克風，再按一次啟用',
  unavailable: '這個環境無法使用麥克風（需要 HTTPS 網頁，且不能是內嵌預覽）',
};

/** DOM 選單、HUD 按鈕、提示訊息、確認視窗、自訂錄音槽位與死前重播面板 */
export class UI {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.$ = $;
    this.screens = {
      title: $('screen-title'),
      settings: $('screen-settings'),
      pause: $('screen-pause'),
      over: $('screen-over'),
      leaderboard: $('screen-leaderboard'),
    };
    this.hudButtons = $('hud-buttons');
    this.btnCalibrate = $('btn-calibrate');
    this.btnRecalibrate = $('btn-recalibrate');
    this.toastEl = $('toast');
    this.toastTimer = 0;
    this.confirmEl = $('screen-confirm');
    this.confirmResolve = null;
    this.buildModeList();
    this.buildGameModeList();
    this.buildSlots();
  }

  // ───────── 操控模式清單 ─────────

  buildModeList() {
    const list = this.$('mode-list');
    CONTROL_MODES.forEach((mode, i) => {
      const label = document.createElement('label');
      label.className = 'mode-option';
      label.htmlFor = `mode-${mode.id}`;

      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'mode';
      input.id = `mode-${mode.id}`;
      input.value = mode.id;

      const card = document.createElement('span');
      card.className = 'mode-card';
      const num = document.createElement('span');
      num.className = 'mode-num';
      num.textContent = String(i + 1);
      const name = document.createElement('span');
      name.className = 'mode-name';
      name.textContent = mode.name;
      if (mode.hard) {
        const tag = document.createElement('em');
        tag.textContent = '困難';
        name.append(tag);
      }
      const desc = document.createElement('span');
      desc.className = 'mode-desc';
      desc.textContent = mode.desc;
      card.append(num, name, desc);
      label.append(input, card);
      list.append(label);
    });
  }

  /** 遊戲模式（速度）：標準 / 極速 / 地獄 */
  buildGameModeList() {
    const list = this.$('gamemode-list');
    for (const mode of GAME_MODES) {
      const label = document.createElement('label');
      label.className = 'mode-option';
      label.htmlFor = `gamemode-${mode.id}`;
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'gamemode';
      input.id = `gamemode-${mode.id}`;
      input.value = mode.id;
      const card = document.createElement('span');
      card.className = 'mode-card';
      const num = document.createElement('span');
      num.className = 'mode-num';
      num.textContent = mode.badge;
      const name = document.createElement('span');
      name.className = 'mode-name';
      name.dataset.base = mode.name;
      name.textContent = mode.name;
      const desc = document.createElement('span');
      desc.className = 'mode-desc';
      desc.textContent = mode.desc;
      card.append(num, name, desc);
      label.append(input, card);
      list.append(label);
    }
  }

  // ───────── 畫面切換與提示 ─────────

  /** 顯示指定畫面；傳 null 代表全部隱藏（遊玩中） */
  show(name) {
    for (const [key, el] of Object.entries(this.screens)) {
      el.hidden = key !== name;
      if (key === name) el.scrollTop = 0;
    }
  }

  setPlayingHud(visible, gyroMode) {
    this.hudButtons.hidden = !visible;
    this.btnCalibrate.hidden = !gyroMode;
    this.btnRecalibrate.hidden = !gyroMode;
  }

  toast(message, ms = 1800) {
    this.toastEl.textContent = message;
    this.toastEl.hidden = false;
    // 重新觸發進場動畫
    this.toastEl.style.animation = 'none';
    void this.toastEl.offsetWidth;
    this.toastEl.style.animation = '';
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toastEl.hidden = true;
    }, ms);
  }

  /**
   * 輕量確認視窗。不用原生 confirm()：內嵌預覽與部分 WebView 會直接回傳 false，按鈕就永遠沒反應。
   * 回傳 Promise<boolean>；按 Esc 或點背景等同取消。
   */
  confirm(message, { ok = '確定', cancel = '取消' } = {}) {
    if (this.confirmResolve) this.closeConfirm(false);
    this.$('confirm-message').textContent = message;
    this.$('confirm-ok').textContent = ok;
    this.$('confirm-cancel').textContent = cancel;
    this.confirmEl.hidden = false;
    this.$('confirm-cancel').focus();
    return new Promise((resolve) => {
      this.confirmResolve = resolve;
    });
  }

  get confirmOpen() {
    return !this.confirmEl.hidden;
  }

  closeConfirm(result) {
    const resolve = this.confirmResolve;
    this.confirmResolve = null;
    this.confirmEl.hidden = true;
    if (resolve) resolve(result);
  }

  bindConfirm() {
    this.$('confirm-ok').addEventListener('click', () => this.closeConfirm(true));
    this.$('confirm-cancel').addEventListener('click', () => this.closeConfirm(false));
    this.confirmEl.addEventListener('pointerdown', (e) => {
      if (e.target === this.confirmEl) this.closeConfirm(false);
    });
  }

  // ───────── 設定 ─────────

  /**
   * opts.bests：各模式最佳紀錄，用來判斷地獄模式有沒有解鎖
   * opts.lockGameMode：遊戲進行中（從暫停選單進來）不能換遊戲模式
   */
  syncSettings(settings, { bests = null, lockGameMode = false } = {}) {
    const radio = this.$(`mode-${settings.mode}`);
    if (radio) radio.checked = true;
    this.$('opt-autocal').checked = settings.autoCalibrate;
    this.$('opt-tilt').value = String(settings.gyroTilt);
    this.$('opt-tilt-out').textContent = String(settings.gyroTilt);
    this.$('opt-sfx').checked = settings.sfx;
    this.$('opt-replay').checked = settings.deathReplay;
    this.$('gyro-options').disabled = settings.mode !== 'gyro';
    const mode = CONTROL_MODES.find((m) => m.id === settings.mode);
    const gm = gameModeById(settings.gameMode);
    this.$('title-mode').textContent = `${gm.name} ${gm.badge} · ${mode ? mode.name : ''}`;

    if (bests) {
      for (const m of GAME_MODES) {
        const input = this.$(`gamemode-${m.id}`);
        const unlocked = isModeUnlocked(m.id, bests);
        input.checked = m.id === settings.gameMode;
        input.disabled = lockGameMode || !unlocked;
        const name = input.parentElement.querySelector('.mode-name');
        name.textContent = unlocked ? m.name : `🔒 ${m.name}`;
      }
      const hell = !isModeUnlocked('nightmare', bests);
      this.$('gamemode-note').textContent = lockGameMode
        ? '遊戲進行中不能換遊戲模式，回主選單後再選。'
        : hell
          ? `地獄模式還沒解鎖：標準或極速模式要打到 B150F（目前最高 B${Math.max(bests.standard, bests.turbo)}F）。`
          : '地獄模式已解鎖。';
    }
  }

  setBest(best) {
    this.$('title-best').textContent = `B${best}F`;
  }

  setGyroStatus(text) {
    this.$('gyro-status').textContent = text;
  }

  // ───────── 麥克風與自訂錄音槽位 ─────────

  setMicStatus(state) {
    this.$('mic-status').textContent = MIC_TEXT[state] || MIC_TEXT.off;
    this.$('mic-status').dataset.state = state;
    this.$('btn-mic').textContent = state === 'on' ? '關閉' : '啟用';
    this.micState = state;
    this.syncRecButtons();
  }

  /** 錄音按鈕要「麥克風已啟用」而且「語音包已解鎖」才能按 */
  syncRecButtons() {
    const ok = this.micState === 'on' && this.voiceUnlocked !== false;
    for (const btn of document.querySelectorAll('.slot-btn[data-act="rec"]')) {
      btn.setAttribute('aria-disabled', String(!ok));
    }
  }

  /** 自訂語音包：最高紀錄到 unlockFloor 才開放 */
  setVoiceLock(unlocked, best, unlockFloor) {
    this.voiceUnlocked = unlocked;
    const note = this.$('voice-lock');
    note.hidden = unlocked;
    note.textContent = `🔒 最高紀錄達到 B${unlockFloor}F 就能解鎖自訂語音包（目前 B${best}F）`;
    document.querySelector('.custom-sfx').classList.toggle('is-locked', !unlocked);
    this.syncRecButtons();
  }

  buildSlots() {
    for (const kind of CLIP_KINDS) {
      const box = this.$(`slots-${kind.id}`);
      for (const slot of AUDIO.SLOTS) {
        const id = slotId(kind.id, slot);
        const row = document.createElement('div');
        row.className = 'slot';
        row.dataset.id = id;
        row.innerHTML = `
          <span class="slot-name">${slot}</span>
          <span class="slot-state" data-filled="false">空</span>
          <button type="button" class="slot-btn" data-act="rec" aria-disabled="true" aria-label="${kind.title} ${slot}：按住錄音，放開結束">⏺️</button>
          <button type="button" class="slot-btn" data-act="play" disabled aria-label="${kind.title} ${slot}：試聽">▶️</button>
          <button type="button" class="slot-btn" data-act="del" disabled aria-label="${kind.title} ${slot}：刪除">🗑️</button>`;
        box.append(row);
      }
    }
  }

  slotRow(id) {
    return document.querySelector(`.slot[data-id="${id}"]`);
  }

  /** handlers: { onRecStart(id), onRecEnd(id), onPlay(id), onDelete(id) } */
  bindSlots({ onRecStart, onRecEnd, onPlay, onDelete }) {
    for (const row of document.querySelectorAll('.slot')) {
      const id = row.dataset.id;
      const rec = row.querySelector('[data-act="rec"]');
      let held = false;
      const begin = () => {
        if (held) return;
        held = true;
        onRecStart(id);
      };
      const end = () => {
        if (!held) return;
        held = false;
        onRecEnd(id);
      };
      rec.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        try {
          rec.setPointerCapture(e.pointerId);
        } catch {
          /* 合成事件可能無法捕捉 */
        }
        begin();
      });
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) rec.addEventListener(type, end);
      rec.addEventListener('contextmenu', (e) => e.preventDefault());
      rec.addEventListener('keydown', (e) => {
        if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
          e.preventDefault();
          begin();
        }
      });
      rec.addEventListener('keyup', (e) => {
        if (e.key === ' ' || e.key === 'Enter') end();
      });
      row.querySelector('[data-act="play"]').addEventListener('click', () => onPlay(id));
      row.querySelector('[data-act="del"]').addEventListener('click', () => onDelete(id));
    }
  }

  setSlotState(id, filled, seconds) {
    const row = this.slotRow(id);
    if (!row) return;
    const state = row.querySelector('.slot-state');
    state.dataset.filled = String(filled);
    state.textContent = filled ? (seconds ? `${seconds.toFixed(1)} 秒` : '已錄音') : '空';
    row.querySelector('[data-act="play"]').disabled = !filled;
    row.querySelector('[data-act="del"]').disabled = !filled;
  }

  setSlotRecording(id, on) {
    const row = this.slotRow(id);
    if (!row) return;
    row.classList.toggle('is-recording', on);
    if (on) row.querySelector('.slot-state').textContent = '錄音中…';
  }

  // ───────── 排行榜 ─────────

  /** handlers: { onTab(trackId), onRetry() } */
  bindLeaderboard({ onTab, onRetry }) {
    for (const tab of document.querySelectorAll('.tab[data-track]')) {
      tab.addEventListener('click', () => onTab(tab.dataset.track));
    }
    this.$('btn-board-retry').addEventListener('click', onRetry);
  }

  setBoardTab(trackId) {
    for (const tab of document.querySelectorAll('.tab[data-track]')) {
      tab.setAttribute('aria-selected', String(tab.dataset.track === trackId));
    }
    const track = TRACKS.find((t) => t.id === trackId) || TRACKS[0];
    this.$('board-note').textContent = `${track.note}📱 代表用陀螺儀體感玩的成績。`;
    this.$('board-list').setAttribute('aria-label', track.tab);
  }

  /** 地獄賽道分頁還沒解鎖時加上 🔒 */
  setBoardLocks(lockedTracks) {
    for (const t of TRACKS) {
      this.$(`tab-${t.id}`).textContent = `${lockedTracks.includes(t.id) ? '🔒 ' : ''}${t.tab}`;
    }
  }

  setBoardStatus(text, { retry = false } = {}) {
    const box = this.$('board-status');
    box.hidden = !text;
    box.textContent = text;
    this.$('btn-board-retry').hidden = !retry;
    if (text) this.$('board-list').replaceChildren();
  }

  /** rows: [{ player_name, score, created_at }]；highlight(row) 回傳 true 的那一列會標成「我」 */
  renderBoard(rows, highlight = () => false) {
    if (!rows.length) {
      this.setBoardStatus('還沒有人上榜，來當第一名吧！');
      return;
    }
    this.setBoardStatus('');
    let mine = null;
    const items = rows.map((row, i) => {
      const li = document.createElement('li');
      li.className = 'board-row';
      const rank = document.createElement('span');
      rank.className = 'board-rank';
      rank.textContent = String(i + 1);
      const name = document.createElement('span');
      name.className = 'board-name';
      name.textContent = row.player_name;
      if (row.input_type === 'gyro') {
        const badge = document.createElement('span');
        badge.className = 'gyro-badge';
        badge.textContent = '📱';
        badge.title = '體感操控';
        badge.setAttribute('aria-label', '體感操控');
        name.append(' ', badge);
      }
      const score = document.createElement('span');
      score.className = 'board-score';
      score.textContent = `B${row.score}F`;
      const date = document.createElement('span');
      date.className = 'board-date';
      date.textContent = formatDate(row.created_at);
      li.append(rank, name, score, date);
      if (!mine && highlight(row)) {
        mine = li;
        li.classList.add('is-me');
      }
      return li;
    });
    this.$('board-list').replaceChildren(...items);
    if (mine) mine.scrollIntoView({ block: 'center' });
  }

  // ───────── 結算：上傳成績與個人排名 ─────────

  bindSubmit({ onSubmit, onShowBoard }) {
    this.$('btn-submit-score').addEventListener('click', onSubmit);
    this.$('nickname').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') onSubmit();
    });
    this.$('btn-rank-board').addEventListener('click', onShowBoard);
  }

  hideSubmit() {
    this.$('submit').hidden = true;
    this.$('rank-result').hidden = true;
  }

  /** 顯示上傳區；reason 有值代表這局不能上傳（只顯示原因） */
  showSubmit({ trackLabel, nickname, reason = '' }) {
    this.$('submit').hidden = false;
    this.$('rank-result').hidden = true;
    this.$('submit-track').textContent = reason || `這局會記在「${trackLabel}」`;
    this.$('submit-form').hidden = Boolean(reason);
    this.$('nickname').value = nickname;
    this.$('nickname').disabled = false;
    this.$('btn-submit-score').disabled = false;
    this.$('btn-submit-score').textContent = '上傳成績';
    this.setSubmitStatus('');
  }

  get nicknameValue() {
    return this.$('nickname').value;
  }

  focusNickname() {
    this.$('nickname').focus();
  }

  setSubmitStatus(text, isError = false) {
    const el = this.$('submit-status');
    el.textContent = text;
    el.style.color = isError ? 'var(--spike)' : '';
  }

  setSubmitBusy(busy, label) {
    this.$('btn-submit-score').disabled = busy;
    this.$('nickname').disabled = busy;
    if (label) this.$('btn-submit-score').textContent = label;
  }

  /** 已上傳但排名還沒查到：按鈕改成「重新查詢排名」 */
  setRankRetry() {
    this.$('nickname').disabled = true;
    this.$('btn-submit-score').disabled = false;
    this.$('btn-submit-score').textContent = '重新查詢排名';
  }

  showRank({ trackLabel, rank, inTop }) {
    this.$('submit-form').hidden = true;
    this.setSubmitStatus('');
    this.$('rank-line').replaceChildren(`你在${trackLabel}中排名第 `, Object.assign(document.createElement('b'), { textContent: String(rank) }), ' 名！');
    this.$('rank-sub').textContent = inTop ? '進榜了！你的名字已經在 Top 100 裡。' : '再往上爬一點，就能擠進 Top 100。';
    this.$('rank-result').hidden = false;
  }

  // ───────── 死前 10 秒重播 ─────────

  bindReplay({ onMode, onSpeed, onPlay, onDownload }) {
    for (const btn of document.querySelectorAll('[data-replay-mode]')) {
      btn.addEventListener('click', () => onMode(btn.dataset.replayMode));
    }
    for (const btn of document.querySelectorAll('[data-replay-speed]')) {
      btn.addEventListener('click', () => onSpeed(Number(btn.dataset.replaySpeed)));
    }
    this.$('btn-replay-play').addEventListener('click', onPlay);
    this.$('btn-replay-download').addEventListener('click', onDownload);
  }

  showReplay({ hasMic, seconds }) {
    this.$('replay').hidden = false;
    this.$('replay-note').textContent = hasMic
      ? `最後 ${seconds.toFixed(1)} 秒。錄音只在這台裝置，離開結算畫面就會清掉。`
      : `最後 ${seconds.toFixed(1)} 秒。沒有麥克風錄音，只有遊戲音效可以重播。`;
    for (const btn of document.querySelectorAll('[data-replay-mode]')) {
      btn.disabled = !hasMic && btn.dataset.replayMode !== 'B';
    }
    this.$('btn-replay-play').disabled = true;
    this.$('btn-replay-download').disabled = true;
  }

  hideReplay() {
    this.$('replay').hidden = true;
  }

  setReplayBusy(text) {
    this.$('replay-busy').textContent = text;
    const busy = Boolean(text);
    this.$('btn-replay-play').disabled = busy;
    this.$('btn-replay-download').disabled = busy;
  }

  setReplayState({ mode, speed, playing }) {
    for (const btn of document.querySelectorAll('[data-replay-mode]')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.replayMode === mode));
    }
    for (const btn of document.querySelectorAll('[data-replay-speed]')) {
      btn.setAttribute('aria-pressed', String(Number(btn.dataset.replaySpeed) === speed));
    }
    this.$('btn-replay-play').textContent = playing ? '⏹ 停止' : '▶ 播放';
    this.$('btn-replay-play').disabled = false;
    this.$('btn-replay-download').disabled = false;
  }
}

function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}
