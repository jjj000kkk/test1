import { AUDIO, CLIP_KINDS } from './config.js';
import { Kind } from './kinds.js';
import { ClipStore } from './clipstore.js';

const AudioCtor = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null;
const OfflineCtor =
  typeof window !== 'undefined' ? window.OfflineAudioContext || window.webkitOfflineAudioContext : null;

export const slotId = (kind, slot) => `${kind}-${slot}`;
export const ALL_SLOT_IDS = CLIP_KINDS.flatMap((k) => AUDIO.SLOTS.map((s) => slotId(k.id, s)));

// ───────── 預設合成音效 ─────────
// 都只用 BaseAudioContext 的 API，所以即時播放與離線重新渲染（死前重播的音效軌）共用同一份程式。

function tone(ctx, out, t, { freq, freqEnd, dur, type = 'square', gain = 0.2 }, rate = 1) {
  // rate > 1：音高與速度一起提高（頻率乘 rate、時間除以 rate），和 AudioBufferSourceNode.playbackRate 的效果一致
  freq *= rate;
  if (freqEnd) freqEnd *= rate;
  dur /= rate;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(amp);
  amp.connect(out);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noiseBurst(ctx, out, t, dur, gain, cutoff) {
  const length = Math.max(1, Math.round(ctx.sampleRate * dur));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = cutoff;
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(gain, t);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter);
  filter.connect(amp);
  amp.connect(out);
  src.start(t);
}

/**
 * 自訂語音的基礎音高：從 1.0 倍隨層數線性提高，VOICE_RATE_FLOORS 層時達到上限 VOICE_RATE_MAX（1.8 倍）。
 * 只有玩家錄的自訂語音會變調；遊戲內建的合成音效一律固定音高與原速。
 */
export function voiceRate(floor) {
  const f = Math.max(0, floor || 0);
  return 1 + (AUDIO.VOICE_RATE_MAX - 1) * Math.min(1, f / AUDIO.VOICE_RATE_FLOORS);
}

/** 電音破音強度：min(層數 / 100, 4)；最低保留 0.5，剛開始時也聽得出效果 */
export function crushLevel(floor) {
  return Math.max(0.5, Math.min(Math.max(0, floor || 0) / 100, AUDIO.CRUSH_MAX_LEVEL));
}

// ───────── 自訂語音的特殊效果（AudioBuffer 加工，快取） ─────────

const reversedCache = new WeakMap();
/** 倒放：把 AudioBuffer 每個聲道的陣列反轉 */
function reversedBuffer(ctx, buffer) {
  let out = reversedCache.get(buffer);
  if (!out) {
    out = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    for (let c = 0; c < buffer.numberOfChannels; c++) out.copyToChannel(buffer.getChannelData(c).slice().reverse(), c);
    reversedCache.set(buffer, out);
  }
  return out;
}

const crushedCache = new WeakMap();
/** 降低取樣率：每 factor 個樣本只取第一個並保持（sample & hold）。位元深度由 WaveShaperNode 負責 */
function crushedBuffer(ctx, buffer, factor) {
  let byFactor = crushedCache.get(buffer);
  if (!byFactor) crushedCache.set(buffer, (byFactor = new Map()));
  let out = byFactor.get(factor);
  if (!out) {
    out = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const src = buffer.getChannelData(c);
      const dst = new Float32Array(src.length);
      for (let i = 0; i < src.length; i++) dst[i] = src[i - (i % factor)];
      out.copyToChannel(dst, c);
    }
    byFactor.set(factor, out);
  }
  return out;
}

const stretchCache = new WeakMap();
/**
 * 保持音高的變速（WSOLA 時間伸縮）：把 buffer 從 offset 秒開始的 maxSec 秒內容拉長 factor 倍，音高不變。
 * 視窗 STRETCH_FRAME 秒、Hann 窗、50% 重疊相加；每個視窗在 ±1/4 視窗內找跟上一個視窗自然接續最像的位置，波形才接得起來。
 * 結果依 (offset, factor, maxSec) 快取。
 */
export function timeStretch(ctx, buffer, offset, factor, maxSec) {
  let byKey = stretchCache.get(buffer);
  if (!byKey) stretchCache.set(buffer, (byKey = new Map()));
  const key = `${offset.toFixed(3)}|${factor.toFixed(3)}|${maxSec ?? 'all'}`;
  let out = byKey.get(key);
  if (out) return out;
  const sr = buffer.sampleRate;
  const start = Math.min(buffer.length, Math.max(0, Math.round(offset * sr)));
  const end = maxSec === undefined ? buffer.length : Math.min(buffer.length, start + Math.round(maxSec * sr));
  const n = Math.max(0, end - start);
  const N = Math.max(64, Math.round(sr * AUDIO.STRETCH_FRAME) & ~1);
  const Hs = N / 2; // 輸出的步長
  const Ha = Hs / factor; // 輸入的步長
  const tol = N >> 2;
  const outLen = Math.max(1, Math.ceil(n * factor));
  out = ctx.createBuffer(buffer.numberOfChannels, outLen, sr);
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const channels = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c).subarray(start, end));
  const ref0 = channels[0];
  const dst = channels.map(() => new Float32Array(outLen + N));
  let prev = 0;
  for (let k = 0; ; k++) {
    const nominal = Math.round(k * Ha);
    if (nominal >= n || k * Hs >= outLen) break;
    let pos = nominal;
    if (k > 0) {
      const ref = prev + Hs; // 上一個視窗「自然接續」的位置
      let best = -Infinity;
      for (let d = -tol; d <= tol; d += 2) {
        const cand = nominal + d;
        if (cand < 0 || cand + Hs > n || ref + Hs > n) continue;
        let corr = 0;
        for (let i = 0; i < Hs; i += 4) corr += ref0[ref + i] * ref0[cand + i];
        if (corr > best) {
          best = corr;
          pos = cand;
        }
      }
    }
    prev = pos;
    for (let c = 0; c < channels.length; c++) {
      const src = channels[c];
      const d = dst[c];
      for (let i = 0; i < N; i++) {
        const j = pos + i;
        if (j >= n) break;
        d[k * Hs + i] += (k === 0 && i < Hs ? 1 : win[i]) * src[j]; // 第一個視窗的前半不淡入
      }
    }
  }
  for (let c = 0; c < channels.length; c++) out.copyToChannel(dst[c].subarray(0, outLen), c);
  byKey.set(key, out);
  return out;
}

/** 位元壓縮曲線：8 位元起，強度越高位元越少（最低 2 位元） */
function bitcrushCurve(level) {
  const bits = Math.max(2, 8 - level * 1.5);
  const steps = 2 ** bits / 2;
  const curve = new Float32Array(2048);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.round(x * steps) / steps;
  }
  return curve;
}

const SYNTH = {
  safe: (c, o, t, r) => tone(c, o, t, { freq: 660, freqEnd: 880, dur: 0.07, type: 'square', gain: 0.16 }, r),
  jump: (c, o, t, r) => tone(c, o, t, { freq: 420, freqEnd: 980, dur: 0.16, type: 'triangle', gain: 0.24 }, r),
  hurt: (c, o, t) => {
    noiseBurst(c, o, t, 0.18, 0.5, 900);
    tone(c, o, t, { freq: 180, freqEnd: 60, dur: 0.22, type: 'sawtooth', gain: 0.4 });
  },
  heal: (c, o, t) =>
    [523, 659, 784].forEach((f, i) => tone(c, o, t + i * 0.07, { freq: f, dur: 0.09, type: 'triangle', gain: 0.25 })),
  tick: (c, o, t) => tone(c, o, t, { freq: 440, dur: 0.09, type: 'sine', gain: 0.25 }),
  go: (c, o, t) => tone(c, o, t, { freq: 880, dur: 0.25, type: 'square', gain: 0.18 }),
  over: (c, o, t) =>
    [392, 330, 262, 196].forEach((f, i) => tone(c, o, t + i * 0.14, { freq: f, dur: 0.18, type: 'sawtooth', gain: 0.25 })),
};

/**
 * 自訂語音：全域最多同時 VOICE_MAX（3）個。state.voices 依開始順序追蹤正在播的語音；
 * 新語音一來，先清掉已經播完的；如果還有 3 個在播，就把最早的那個 VOICE_FADE（0.03）秒內淡出並 stop()、從陣列移除，
 * 新的語音馬上開始。語音播完（onended）也會自動從陣列移除，釋放額度。
 *   v = { rate, reverse, crush, stutter, swell, bend, muffle, low }
 * 回傳 handle { endAt, stop(t) }。
 */
function startVoice(ctx, out, t, ev, state) {
  const v = ev.voice || {};
  const voices = state.voices || (state.voices = []);
  for (let i = voices.length - 1; i >= 0; i--) if (voices[i].endAt <= t) voices.splice(i, 1);
  while (voices.length >= AUDIO.VOICE_MAX) voices.shift().stop(t); // 最早的淡出切斷
  const start = t;
  let buffer = v.reverse ? reversedBuffer(ctx, ev.buffer) : ev.buffer;
  if (v.crush) buffer = crushedBuffer(ctx, buffer, 1 + Math.floor(v.crush * 2));
  const baseRate = v.low ? AUDIO.LOW_RATE : v.muffle ? AUDIO.SLIME_VOICE_RATE : v.rate || 1;

  const vg = ctx.createGain(); // 這個語音專屬的音量：淡出用
  vg.gain.setValueAtTime(1, start);
  vg.connect(out);
  let tail = vg;
  const nodes = [];
  const oscs = []; // 要在結束時一起 stop 的振盪器
  if (v.low || v.muffle) {
    const lp = ctx.createBiquadFilter(); // 低血量：濾掉刺耳高頻；泥沼：悶悶的泥濘感
    lp.type = 'lowpass';
    lp.frequency.value = v.low && v.muffle ? Math.min(AUDIO.LOW_CUTOFF, AUDIO.SLIME_VOICE_CUTOFF) : v.low ? AUDIO.LOW_CUTOFF : AUDIO.SLIME_VOICE_CUTOFF;
    lp.connect(vg);
    tail = lp;
  }
  if (v.muffle) {
    // 泥沼：用 8~12Hz 的 LFO 讓音量微幅快速抖動
    const tg = ctx.createGain();
    tg.gain.value = 1 - AUDIO.SLIME_TREMOLO_DEPTH;
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = AUDIO.SLIME_TREMOLO_HZ;
    depth.gain.value = AUDIO.SLIME_TREMOLO_DEPTH;
    lfo.connect(depth);
    depth.connect(tg.gain);
    tg.connect(tail);
    tail = tg;
    oscs.push(lfo);
    nodes.push(tg, depth);
  }
  let head = tail;
  let ring = null;
  if (v.crush) {
    // 電音：WaveShaper 壓位元 → 一半直通、一半與 30~100Hz OscillatorNode 相乘（環形調變）
    const shaper = ctx.createWaveShaper();
    shaper.curve = bitcrushCurve(v.crush);
    const mix = ctx.createGain();
    mix.connect(tail);
    const dry = ctx.createGain();
    dry.gain.value = 0.45;
    const wet = ctx.createGain();
    wet.gain.value = 0.9;
    const mod = ctx.createGain();
    mod.gain.value = 0; // 載波增益 0，只剩振盪器的輸出 → 純環形調變
    ring = ctx.createOscillator();
    ring.type = 'square';
    ring.frequency.value = 30 + 70 * Math.min(1, v.crush / AUDIO.CRUSH_MAX_LEVEL);
    ring.connect(mod.gain);
    shaper.connect(dry);
    dry.connect(mix);
    shaper.connect(mod);
    mod.connect(wet);
    wet.connect(mix);
    head = shaper;
    oscs.push(ring);
    nodes.push(shaper, mix, dry, wet, mod);
  }
  const sources = [];
  /** 建一個播放來源：buf 從 offset 秒開始（dur 秒），播放速率 rate；shape(rateParam, when) 排程速率變化 */
  const addSource = (buf, when, offset, dur, rate, shape, dest = head) => {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    if (shape) shape(src.playbackRate, when);
    src.connect(dest);
    if (dur === undefined) src.start(when, offset);
    else src.start(when, offset, dur);
    sources.push(src);
    return src;
  };
  const len = buffer.duration;
  let at = start;
  let endAt;
  if (v.stutter) {
    // 卡帶抽蓄：開頭 STUTTER_SECONDS 秒重複 2~3 次，再播完整語音
    const seg = Math.min(AUDIO.STUTTER_SECONDS, len);
    for (let i = 0; i < v.stutter; i++) {
      addSource(buffer, at, 0, seg, baseRate);
      at += seg / baseRate + 0.04;
    }
  }
  if (v.swell) {
    // 彈簧：前段 0.5 倍速但音高不變（時間伸縮），接著恢復成基礎速度（彈飛出去）
    const headLen = Math.min(v.swell, len * AUDIO.SPRING_HEAD_RATIO);
    const slow = timeStretch(ctx, buffer, 0, 1 / AUDIO.SPRING_SLOW, headLen);
    addSource(slow, at, 0, undefined, 1);
    at += slow.duration;
    addSource(buffer, at, headLen, undefined, baseRate);
    endAt = at + (len - headLen) / baseRate;
  } else if (v.bend) {
    // 冰面：播放速率 1.0x → 1.5x（音高跟著升高），再降到 0.6x 速度，但 0.6x 的部分用時間伸縮，音高不再掉下去
    const up = AUDIO.ICE_BEND_UP_SECONDS;
    const down = AUDIO.ICE_BEND_DOWN_SECONDS;
    const top = baseRate * AUDIO.ICE_BEND_UP;
    const eaten = (up * (baseRate + top)) / 2; // 上升段用掉的錄音長度
    const first = addSource(buffer, at, 0, undefined, baseRate, (rate, when) => {
      rate.setValueAtTime(baseRate, when);
      rate.linearRampToValueAtTime(top, when + up);
    });
    first.stop(at + up);
    if (eaten < len) {
      const rest = timeStretch(ctx, buffer, eaten, 1 / AUDIO.ICE_BEND_DOWN);
      // 伸縮後的內容以 baseRate 播出 = 0.6x 速度；開頭從高音（top）滑回正常音高
      addSource(rest, at + up, 0, undefined, top, (rate, when) => {
        rate.setValueAtTime(top, when);
        rate.linearRampToValueAtTime(baseRate, when + down);
      });
      endAt = at + up + down + Math.max(0, rest.duration - (down * (top + baseRate)) / 2) / baseRate;
    } else endAt = at + up;
  } else {
    addSource(buffer, at, 0, undefined, baseRate);
    endAt = at + len / baseRate;
    if (v.muffle) {
      // 泥沼：每 0.15 秒疊上一小段「往回一點」的語音片段，像被黏住、斷斷續續抖動
      const iv = AUDIO.SLIME_LOOP_INTERVAL;
      for (let k = 1; at + k * iv < endAt - 0.02; k++) {
        const when = at + k * iv;
        const from = Math.max(0, k * iv * baseRate - AUDIO.SLIME_LOOP_BACK);
        const grainGain = ctx.createGain();
        grainGain.gain.value = 0.5;
        grainGain.connect(head);
        nodes.push(grainGain);
        const g = addSource(buffer, when, from, AUDIO.SLIME_LOOP_LENGTH, baseRate, null, grainGain);
        g.stop(when + AUDIO.SLIME_LOOP_LENGTH / baseRate);
      }
    }
  }
  if (v.low) endAt = Math.min(endAt, start + AUDIO.LOW_MAX_SECONDS); // 最長只播 LOW_MAX_SECONDS 秒
  oscs.forEach((o) => o.start(start));
  const kill = (when) => {
    sources.forEach((s) => {
      try {
        s.stop(when);
      } catch {
        /* 已經結束 */
      }
    });
    oscs.forEach((o) => o.stop(when));
  };
  const handle = { endAt, stop: null, nodes };
  if (v.low) {
    vg.gain.setValueAtTime(1, Math.max(start, endAt - 0.03));
    vg.gain.linearRampToValueAtTime(0, endAt);
    kill(endAt);
  }
  handle.stop = (when) => {
    // 淡出並關閉，同時從通道清單移除
    vg.gain.cancelScheduledValues(when);
    vg.gain.setValueAtTime(1, when);
    vg.gain.linearRampToValueAtTime(0, when + AUDIO.VOICE_FADE);
    kill(when + AUDIO.VOICE_FADE);
    handle.endAt = Math.min(handle.endAt, when + AUDIO.VOICE_FADE);
    const i = voices.indexOf(handle);
    if (i >= 0) voices.splice(i, 1);
  };
  // 所有來源都播完（onended）就自動釋放額度
  let remaining = sources.length;
  sources.forEach((src) => {
    src.onended = () => {
      remaining -= 1;
      const i = voices.indexOf(handle);
      if (remaining <= 0 && i >= 0) voices.splice(i, 1);
    };
  });
  voices.push(handle);
  return handle;
}

/** ev = { kind, buffer?, rate?, voice? }：有 buffer 就播自訂錄音（走獨佔通道 + 特殊效果），否則播該 kind 的預設合成音 */
function startSound(ctx, out, t, ev, state = { voices: [] }) {
  if (ev.buffer) {
    startVoice(ctx, out, t, ev, state);
  } else if (SYNTH[ev.kind]) {
    SYNTH[ev.kind](ctx, out, t, ev.rate || 1);
  }
}

function pickRecorderMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  const list = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  return list.find((m) => MediaRecorder.isTypeSupported(m)) || '';
}

/** 限幅：DynamicsCompressor 接在輸出前，避免多個語音疊加時爆音 */
function limiter(ctx, dest) {
  if (!ctx.createDynamicsCompressor) return dest;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -10;
  comp.knee.value = 6;
  comp.ratio.value = 12;
  comp.attack.value = 0.003;
  comp.release.value = 0.1;
  comp.connect(dest);
  return comp;
}

/**
 * 全局音訊管理：
 * - 解鎖 AudioContext（iOS / Safari 必須在使用者手勢內 resume）
 * - 預設合成音效，以及踩平台 / 受傷各 3 個自訂錄音槽位（隨機挑一個播）
 * - 麥克風：自訂錄音（MediaRecorder）與死前 10 秒環形緩衝（PCM）
 * 所有音訊都只在本機處理，沒有任何網路請求。
 */
export class AudioManager {
  constructor() {
    this.supported = Boolean(AudioCtor);
    this.enabled = true;
    this.voiceState = { voices: [] }; // 自訂語音的通道：最多同時 3 個
    this.crushUntil = 0;               // 雷射電音 Buff 的結束時間（AudioContext 時鐘）
    this.voiceUnlocked = false; // 最高紀錄 B30 以上才播自訂語音包（modes.js 的 isVoicePackUnlocked）
    this.ctx = null;
    this.out = null;

    this.store = new ClipStore();
    this.blobs = new Map();   // 槽位 id → 錄音 Blob
    this.buffers = new Map(); // 槽位 id → 解碼後的 AudioBuffer
    this.onClipsChange = null;

    this.mic = { state: 'off', stream: null, source: null };
    this.onMicChange = null;

    // 死前重播：Track A（麥克風）放環形緩衝；Track B（遊戲音效）只記事件，匯出時離線重新渲染
    this.capturing = false;
    this.ring = null;
    this.ringPos = 0;
    this.clockSamples = 0;
    this.cbTime = 0;
    this.micSamples = 0;
    this.events = [];

    this.clipRec = null;
    this.clipDone = null;
    this.replaySource = null;
  }

  // ───────── 解鎖與建立 ─────────

  ensureCtx() {
    if (this.ctx || !this.supported) return this.ctx;
    this.ctx = new AudioCtor();
    this.out = this.ctx.createGain();
    this.out.gain.value = 0.9;
    // 最多 3 個語音 + 電音疊在一起容易爆音：過一個壓縮器當限幅
    this.out.connect(limiter(this.ctx, this.ctx.destination));
    this.buildCapture();
    return this.ctx;
  }

  /** 要在點擊 / 觸控 / 按鍵等使用者手勢裡呼叫。重複呼叫沒有副作用 */
  unlock() {
    const ctx = this.ensureCtx();
    if (!ctx) return Promise.resolve(false);
    const ready = ctx.state === 'running' ? Promise.resolve() : ctx.resume().catch(() => {});
    return ready.then(() => {
      if (!this.unlocked) {
        this.unlocked = true;
        // iOS：播一小段無聲音訊，才算真的解鎖
        const buf = ctx.createBuffer(1, 1, ctx.sampleRate);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        src.start(0);
      }
      return this.decodePending().then(() => ctx.state === 'running');
    });
  }

  get running() {
    return Boolean(this.ctx) && this.ctx.state === 'running';
  }

  // ───────── 音效播放 ─────────

  pickEvent(kind) {
    const ids = AUDIO.SLOTS.map((s) => slotId(kind, s)).filter((id) => this.buffers.has(id));
    if (ids.length) return { kind, buffer: this.buffers.get(ids[Math.floor(Math.random() * ids.length)]) };
    return { kind, buffer: null };
  }

  /**
   * 這次自訂語音要套用哪些效果（依踩到的平台）：
   *   低血量（<= 2/6）：強制 0.5 倍速 + 低通 + 最長 0.8 秒（無視基礎高音高）
   *   傳送門 >= 300F：100% 倒放
   *   雷射：之後 5 秒內任何平台的語音都套用電音
   *   碎石：40% 口吃（前 0.5 秒重複 2~3 次後再播完整語音）；其他平台絕不口吃
   *   彈簧：100% 前段半速、後段恢復
   *   冰面：100% 尾音滑腔（1.0x → 1.5x → 0.6x）
   *   泥沼：100% 低通 800Hz + 顫音，速度只降到 0.85x
   */
  voiceFx(kind, floor, info = {}) {
    const src = info.platform && typeof info.platform === 'object' ? info.platform : null;
    const pk = kind === 'safe' && src ? src.kind : null;
    const now = this.ctx.currentTime;
    if (src && src.kind === Kind.LASER) this.crushUntil = now + AUDIO.CRUSH_BUFF_SECONDS;
    const fx = { rate: voiceRate(floor) };
    if (info.hp !== undefined && info.hp <= AUDIO.LOW_HP) fx.low = true;
    if (pk === Kind.PORTAL && floor >= AUDIO.REVERSE_FLOOR) fx.reverse = true;
    if (now < this.crushUntil) fx.crush = crushLevel(floor);
    if (pk === Kind.FLIP && Math.random() < AUDIO.STUTTER_CHANCE) fx.stutter = Math.random() < 0.5 ? 2 : 3;
    if (pk === Kind.SPRING && !fx.low) fx.swell = AUDIO.SPRING_HEAD_MAX;
    if (pk === Kind.ICE && !fx.low) fx.bend = true;
    if (pk === Kind.SLIME) fx.muffle = true;
    return fx;
  }

  /**
   * kind: safe | jump | hurt | heal | tick | go | over。safe 和 hurt 在解鎖後優先播自訂錄音。
   * floor：目前層數。info = { platform, hp }：踩到 / 傷到的平台與目前血量（自訂語音的特殊效果用）。
   * 內建合成音效固定音高與原速；只有自訂語音會隨層數變調、套用特殊效果。
   */
  play(kind, floor = 0, info = {}) {
    if (!this.enabled || !this.running) return;
    const custom = this.voiceUnlocked && (kind === 'safe' || kind === 'hurt');
    const ev = custom ? this.pickEvent(kind) : { kind, buffer: null };
    if (ev.buffer) ev.voice = this.voiceFx(kind, floor, info);
    startSound(this.ctx, this.out, this.ctx.currentTime, ev, this.voiceState);
    if (this.capturing) {
      this.events.push({ ...ev, t: this.clockNow() });
      const cutoff = this.clockNow() - AUDIO.REPLAY_SECONDS - 2;
      while (this.events.length && this.events[0].t < cutoff) this.events.shift();
    }
  }

  previewClip(id) {
    const buffer = this.buffers.get(id);
    if (!buffer || !this.running) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.ctx.destination);
    src.start();
    return true;
  }

  // ───────── 自訂錄音槽位 ─────────

  hasClip(id) {
    return this.blobs.has(id) || this.buffers.has(id);
  }

  clipSeconds(id) {
    const buffer = this.buffers.get(id);
    return buffer ? buffer.duration : null;
  }

  async loadStored() {
    const rows = await this.store.getAll();
    for (const [id, blob] of rows) if (ALL_SLOT_IDS.includes(id)) this.blobs.set(id, blob);
    if (this.onClipsChange) this.onClipsChange();
  }

  /** 解碼已儲存的錄音。decodeAudioData 要有 AudioContext，所以等解鎖後才做 */
  async decodePending() {
    if (!this.ctx) return;
    let changed = false;
    for (const [id, blob] of this.blobs) {
      if (this.buffers.has(id)) continue;
      try {
        const buffer = await this.ctx.decodeAudioData(await blob.arrayBuffer());
        this.buffers.set(id, buffer);
        changed = true;
      } catch {
        this.blobs.delete(id);
        this.store.delete(id);
        changed = true;
      }
    }
    if (changed && this.onClipsChange) this.onClipsChange();
  }

  /** 按住開始錄；回傳 false 代表現在不能錄。結果由 this.clipDone 取得 */
  startClip(id) {
    if (this.clipRec || this.mic.state !== 'on' || typeof MediaRecorder === 'undefined') return false;
    this.ensureCtx();
    const mime = pickRecorderMime();
    const stream = new MediaStream(this.mic.stream.getAudioTracks());
    let rec;
    try {
      rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    } catch {
      return false;
    }
    const chunks = [];
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size) chunks.push(e.data);
    };
    const timer = setTimeout(() => this.stopClip(id), AUDIO.CLIP_MAX_SECONDS * 1000);
    this.clipDone = new Promise((resolve) => {
      rec.onstop = async () => {
        clearTimeout(timer);
        this.clipRec = null;
        resolve(await this.finishClip(id, new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' })));
      };
      rec.onerror = () => {
        clearTimeout(timer);
        this.clipRec = null;
        resolve({ ok: false, reason: 'error' });
      };
    });
    this.clipRec = { id, rec };
    rec.start();
    return true;
  }

  stopClip(id) {
    const cur = this.clipRec;
    if (!cur || cur.id !== id) return;
    if (cur.rec.state === 'recording') cur.rec.stop();
  }

  async finishClip(id, blob) {
    if (!blob.size) return { ok: false, reason: 'short' };
    let buffer;
    try {
      buffer = await this.ctx.decodeAudioData(await blob.arrayBuffer());
    } catch {
      return { ok: false, reason: 'decode' };
    }
    if (buffer.duration < AUDIO.CLIP_MIN_SECONDS) return { ok: false, reason: 'short' };
    this.blobs.set(id, blob);
    this.buffers.set(id, buffer);
    const where = await this.store.put(id, blob);
    if (this.onClipsChange) this.onClipsChange();
    return { ok: true, seconds: buffer.duration, where };
  }

  async deleteClip(id) {
    this.blobs.delete(id);
    this.buffers.delete(id);
    await this.store.delete(id);
    if (this.onClipsChange) this.onClipsChange();
  }

  // ───────── 麥克風 ─────────

  setMic(state, detail = '') {
    this.mic.state = state;
    if (this.onMicChange) this.onMicChange(state, detail);
  }

  /** 要在使用者手勢內呼叫（會跳出瀏覽器的權限視窗） */
  async enableMic() {
    if (this.mic.state === 'on') return true;
    if (!this.supported || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.setMic('unavailable');
      return false;
    }
    this.ensureCtx();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true },
      });
      this.mic.stream = stream;
      this.mic.source = this.ctx.createMediaStreamSource(stream);
      this.mic.source.connect(this.mixIn);
      stream.getAudioTracks().forEach((t) => t.addEventListener('ended', () => this.disableMic()));
      this.setMic('on');
      return true;
    } catch (err) {
      const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
      this.setMic(denied ? 'denied' : 'unavailable', err && err.name);
      return false;
    }
  }

  /** 已經允許過的話，不跳視窗直接接上麥克風 */
  async enableMicIfGranted() {
    if (this.mic.state === 'on' || !navigator.permissions || !navigator.permissions.query) return false;
    try {
      const status = await navigator.permissions.query({ name: 'microphone' });
      if (status.state === 'granted') return this.enableMic();
    } catch {
      /* 部分瀏覽器不支援查詢 */
    }
    return false;
  }

  disableMic() {
    if (this.mic.source) this.mic.source.disconnect();
    if (this.mic.stream) this.mic.stream.getTracks().forEach((t) => t.stop());
    this.mic.source = null;
    this.mic.stream = null;
    this.setMic('off');
  }

  // ───────── 死前 10 秒：環形緩衝 ─────────

  buildCapture() {
    const ctx = this.ctx;
    this.sr = ctx.sampleRate;
    this.ring = new Float32Array(Math.round(this.sr * AUDIO.REPLAY_SECONDS));
    this.mixIn = ctx.createGain();
    // 沒有麥克風時也要讓時鐘照常走，所以永遠接一條無聲的訊號
    const silent = ctx.createOscillator();
    const silentGain = ctx.createGain();
    silentGain.gain.value = 0;
    silent.connect(silentGain);
    silentGain.connect(this.mixIn);
    silent.start();
    this.tap = ctx.createScriptProcessor(AUDIO.TAP_SIZE, 1, 1);
    this.tap.onaudioprocess = (e) => this.onTap(e);
    const mute = ctx.createGain();
    mute.gain.value = 0;
    this.mixIn.connect(this.tap);
    this.tap.connect(mute);
    mute.connect(ctx.destination);
  }

  onTap(e) {
    if (!this.capturing) return;
    const input = e.inputBuffer.getChannelData(0);
    const micOn = this.mic.state === 'on';
    const ring = this.ring;
    let pos = this.ringPos;
    for (let i = 0; i < input.length; i++) {
      ring[pos] = micOn ? input[i] : 0;
      pos = pos + 1 === ring.length ? 0 : pos + 1;
    }
    this.ringPos = pos;
    this.clockSamples += input.length;
    if (micOn) this.micSamples += input.length;
    this.cbTime = this.ctx.currentTime;
  }

  /** 錄音時鐘（秒）：只在遊玩中前進，暫停與倒數不算 */
  clockNow() {
    return this.clockSamples / this.sr + Math.max(0, this.ctx.currentTime - this.cbTime);
  }

  beginRun() {
    this.ensureCtx();
    if (this.ring) this.ring.fill(0);
    this.ringPos = 0;
    this.clockSamples = 0;
    this.micSamples = 0;
    this.events = [];
    this.cbTime = this.ctx ? this.ctx.currentTime : 0;
  }

  setCapturing(on) {
    if (on && this.ctx) this.cbTime = this.ctx.currentTime;
    this.capturing = Boolean(on) && Boolean(this.ctx);
  }

  /** 取出最近 10 秒的快照：{ sr, duration, mic: Float32Array | null, events } */
  freeze() {
    this.capturing = false;
    if (!this.ring) return null;
    const len = this.ring.length;
    const total = Math.min(len, this.clockSamples);
    const duration = total / this.sr;
    const mic = new Float32Array(total);
    const start = (this.ringPos - total + len) % len;
    for (let i = 0; i < total; i++) mic[i] = this.ring[(start + i) % len];
    const windowStart = this.clockSamples / this.sr - duration;
    const events = this.events
      .filter((ev) => ev.t >= windowStart)
      .map((ev) => ({ kind: ev.kind, buffer: ev.buffer, rate: ev.rate, voice: ev.voice, t: ev.t - windowStart }));
    return { sr: this.sr, duration, mic: this.micSamples > 0 ? mic : null, events };
  }

  /** Track B：把這 10 秒內觸發過的音效依時間離線重新渲染成一條聲軌 */
  async renderSfxTrack(snap) {
    const length = Math.max(1, Math.ceil(snap.duration * snap.sr));
    if (!OfflineCtor) return new Float32Array(length);
    const offline = new OfflineCtor(1, length, snap.sr);
    const bus = offline.createGain();
    bus.gain.value = 0.9;
    bus.connect(limiter(offline, offline.destination));
    const state = { voices: [] };
    for (const ev of snap.events) startSound(offline, bus, ev.t, ev, state);
    const rendered = await offline.startRendering();
    return rendered.getChannelData(0).slice();
  }

  // ───────── 重播與匯出 ─────────

  playSamples(samples, sr, rate, onEnded) {
    this.stopReplay();
    const ctx = this.ensureCtx();
    const buffer = ctx.createBuffer(1, samples.length, sr);
    buffer.copyToChannel(samples, 0);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    src.connect(ctx.destination);
    src.onended = () => {
      if (this.replaySource === src) this.replaySource = null;
      if (onEnded) onEnded();
    };
    src.start();
    this.replaySource = src;
  }

  setReplayRate(rate) {
    if (this.replaySource) this.replaySource.playbackRate.value = rate;
  }

  stopReplay() {
    const src = this.replaySource;
    this.replaySource = null;
    if (src) {
      src.onended = null;
      try {
        src.stop();
      } catch {
        /* 已經結束 */
      }
    }
  }

  /** 壓縮匯出（webm 或 mp4）：把聲軌即時播進 MediaRecorder，所以要花一個聲軌長度的時間 */
  async encodeCompressed(samples, sr) {
    const mime = pickRecorderMime();
    if (!mime) throw new Error('no-recorder');
    const ctx = this.ensureCtx();
    const dest = ctx.createMediaStreamDestination();
    const rec = new MediaRecorder(dest.stream, { mimeType: mime });
    const chunks = [];
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size) chunks.push(e.data);
    };
    const stopped = new Promise((resolve) => (rec.onstop = resolve));
    const buffer = ctx.createBuffer(1, samples.length, sr);
    buffer.copyToChannel(samples, 0);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(dest);
    rec.start();
    src.start();
    await new Promise((resolve) => (src.onended = resolve));
    await new Promise((resolve) => setTimeout(resolve, 150));
    rec.stop();
    await stopped;
    const type = mime.split(';')[0];
    return { blob: new Blob(chunks, { type }), ext: type.includes('mp4') ? 'mp4' : 'webm' };
  }
}
