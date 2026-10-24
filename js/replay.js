import { encodeWav, mixTracks } from './wav.js';

/** 沒有 claude.ai 的下載能力（獨立網頁）時回傳 null */
async function downloadsCapability() {
  try {
    if (window.claude && typeof window.claude.use === 'function') return await window.claude.use('downloads');
  } catch {
    /* 沒有這個能力 */
  }
  return null;
}

function saveWithAnchor(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

const MODE_LABEL = { A: '玩家聲音', B: '遊戲音效', AB: '雙軌混音' };

/**
 * 結算畫面的「死前 10 秒精彩重播」
 * Track A = 玩家麥克風原音，Track B = 遊戲音效軌，A+B = 混音（預設）。
 * 速度用 playbackRate 直接改，不需要重新轉檔。
 */
export class ReplayController {
  constructor({ audio, ui }) {
    this.audio = audio;
    this.ui = ui;
    this.snap = null;
    this.tracks = null;
    this.mode = 'AB';
    this.speed = 1;
    this.playing = false;
    this.token = 0;
    this.label = '';
    ui.bindReplay({
      onMode: (mode) => this.setMode(mode),
      onSpeed: (speed) => this.setSpeed(speed),
      onPlay: () => this.toggle(),
      onDownload: () => this.download(),
    });
  }

  reset() {
    this.token += 1;
    this.audio.stopReplay();
    this.playing = false;
    this.snap = null;
    this.tracks = null;
    this.ui.hideReplay();
  }

  async prepare(snap, label) {
    this.reset();
    if (!snap || snap.duration < 0.5) return;
    const token = this.token;
    this.snap = snap;
    this.label = label;
    this.ui.showReplay({ hasMic: Boolean(snap.mic), seconds: snap.duration });
    this.ui.setReplayBusy('準備重播中…');
    const sfx = await this.audio.renderSfxTrack(snap);
    if (token !== this.token) return;
    this.tracks = { A: snap.mic, B: sfx, AB: mixTracks(snap.mic, sfx, 1, 0.7) };
    this.mode = snap.mic ? 'AB' : 'B';
    this.speed = 1;
    this.ui.setReplayBusy('');
    this.ui.setReplayState({ mode: this.mode, speed: this.speed, playing: false });
  }

  setMode(mode) {
    if (!this.tracks || !this.tracks[mode]) return;
    this.mode = mode;
    const wasPlaying = this.playing;
    this.audio.stopReplay();
    this.playing = false;
    this.ui.setReplayState({ mode, speed: this.speed, playing: false });
    if (wasPlaying) this.toggle();
  }

  setSpeed(speed) {
    this.speed = speed;
    this.audio.setReplayRate(speed);
    this.ui.setReplayState({ mode: this.mode, speed, playing: this.playing });
  }

  toggle() {
    if (!this.tracks) return;
    if (this.playing) {
      this.audio.stopReplay();
      this.playing = false;
    } else {
      this.audio.unlock();
      this.audio.playSamples(this.tracks[this.mode], this.snap.sr, this.speed, () => {
        this.playing = false;
        this.ui.setReplayState({ mode: this.mode, speed: this.speed, playing: false });
      });
      this.playing = true;
    }
    this.ui.setReplayState({ mode: this.mode, speed: this.speed, playing: this.playing });
  }

  /**
   * 匯出目前選的聲軌（原速）。獨立網頁存成 .wav；
   * 在 claude.ai 的頁面裡下載能力不收 .wav，所以改轉成 .webm（Safari 為 .mp4）。
   */
  async download() {
    if (!this.tracks) return;
    const samples = this.tracks[this.mode];
    const base = `小朋友下樓梯-${this.label}-${MODE_LABEL[this.mode]}`;
    this.ui.setReplayBusy('匯出中…');
    try {
      const dl = await downloadsCapability();
      if (dl) {
        const { blob, ext } = await this.audio.encodeCompressed(samples, this.snap.sr);
        await dl.save({ filename: `${base}.${ext}`, data: blob });
        this.ui.toast('已匯出重播');
      } else {
        saveWithAnchor(encodeWav(samples, this.snap.sr), `${base}.wav`);
        this.ui.toast('已下載重播（.wav）');
      }
    } catch (err) {
      if (!(err && err.code === 'declined')) this.ui.toast('匯出失敗，這個環境可能不允許下載');
    } finally {
      this.ui.setReplayBusy('');
    }
  }
}
