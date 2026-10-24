import { clamp } from './utils.js';

export function peakOf(samples) {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]);
    if (v > peak) peak = v;
  }
  return peak;
}

/** 兩軌相加；總音量超過 0.95 時整體縮小，避免爆音 */
export function mixTracks(a, b, gainA = 1, gainB = 0.7) {
  const out = new Float32Array(Math.max(a ? a.length : 0, b ? b.length : 0));
  if (a) for (let i = 0; i < a.length; i++) out[i] += a[i] * gainA;
  if (b) for (let i = 0; i < b.length; i++) out[i] += b[i] * gainB;
  const peak = peakOf(out);
  if (peak > 0.95) {
    const k = 0.95 / peak;
    for (let i = 0; i < out.length; i++) out[i] *= k;
  }
  return out;
}

/** 單聲道 16-bit PCM WAV */
export function encodeWav(samples, sampleRate) {
  const n = samples.length;
  const buffer = new ArrayBuffer(44 + n * 2);
  const view = new DataView(buffer);
  const text = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + n * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // 單聲道
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const v = clamp(samples[i], -1, 1);
    view.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}
