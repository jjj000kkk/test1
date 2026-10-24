import { gameModeById } from './modes.js';
// Supabase 排行榜。SDK 從 CDN 在第一次需要時才載入，所以連不上網路時遊戲本身不受影響。
// 這是 role=anon 的 JWT（舊式 anon key，到 2036 年到期），本來就是設計給前端公開使用的；絕對不要換成 service_role key；能做什麼完全由資料庫的 RLS 與 CHECK 限制決定（見 sql/leaderboard.sql）。
const SUPABASE_URL = 'https://bxealvfsbivinybhvule.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ4ZWFsdmZzYml2aW55Ymh2dWxlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI1ODUwOTQsImV4cCI6MjEwODE2MTA5NH0.MtH_VK-3yAuuh3OlN6TXB08CsKkjfV2dkpk6TCGzRas';
const SUPABASE_SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';

const TABLE = 'leaderboard';
const REQUEST_TIMEOUT_MS = 10000;
export const NAME_MAX = 12;
export const TOP_LIMIT = 100;

/**
 * 兩條賽道：標準（標準 1.0x + 極速 1.5x 共用）與地獄（2.0x 獨佔）。
 * 操控方式不分賽道，只用 input_type 標記（'button' 或 'gyro'）。
 */
export const TRACKS = [
  { id: 'standard', label: '標準賽道', tab: '標準賽道 Top 100', note: '收錄標準模式（1.0x）與極速模式（1.5x）的成績。' },
  { id: 'nightmare', label: '地獄賽道', tab: '地獄賽道 Top 100', note: '只收地獄模式（2.0x）的成績。' },
];

export const trackById = (id) => TRACKS.find((t) => t.id === id) || TRACKS[0];
export const trackOfMode = (modeId) => trackById(gameModeById(modeId).trackId);

export function cleanName(raw) {
  const text = String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(text).slice(0, NAME_MAX).join('');
}

let clientPromise = null;

function loadSdk() {
  if (window.supabase && window.supabase.createClient) return Promise.resolve(window.supabase);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SUPABASE_SDK_URL;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.onload = () => (window.supabase && window.supabase.createClient ? resolve(window.supabase) : reject(new Error('sdk-missing')));
    script.onerror = () => reject(new Error('sdk-load-failed'));
    document.head.append(script);
  });
}

/** 取得（並在需要時初始化）Supabase client；載入失敗後下次會重試 */
export function getClient() {
  if (!clientPromise) {
    clientPromise = loadSdk()
      .then((lib) => lib.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } }))
      .catch((err) => {
        clientPromise = null;
        throw err;
      });
  }
  return clientPromise;
}

function withTimeout(promise) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), REQUEST_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function query(build) {
  const client = await withTimeout(getClient());
  const { data, error, count, status } = await withTimeout(build(client.from(TABLE)));
  if (error) {
    const err = new Error(error.message || 'request-failed');
    err.status = status;
    err.code = error.code;
    console.warn('[supabase]', status, error.code, error.message, error.hint || '');
    throw err;
  }
  return { data, count };
}

/** 該賽道前 100 名：分數高到低，同分先到的在前 */
export async function fetchTop(trackId) {
  const { data } = await query((t) =>
    t
      .select('player_name, score, mode, input_type, created_at')
      .eq('track_id', trackById(trackId).id)
      .order('score', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(TOP_LIMIT),
  );
  return data || [];
}

/** mode = 遊戲模式（standard | turbo | nightmare）；inputType = 'button' | 'gyro' */
export async function submitScore({ name, score, mode, inputType }) {
  const player_name = cleanName(name);
  if (!player_name) throw new Error('empty-name');
  if (!Number.isInteger(score) || score < 1) throw new Error('bad-score');
  const input_type = inputType === 'gyro' ? 'gyro' : 'button';
  await query((t) => t.insert({ player_name, score, mode, track_id: trackOfMode(mode).id, input_type }));
  return player_name;
}

/** 全局名次 = 該賽道分數比你高的人數 + 1（同分並列同名次） */
export async function fetchRank(trackId, score) {
  const { count } = await query((t) =>
    t.select('id', { count: 'exact', head: true }).eq('track_id', trackById(trackId).id).gt('score', score),
  );
  return (count ?? 0) + 1;
}

/** 把錯誤翻成給玩家看的一行：帶上 HTTP 狀態與伺服器訊息，方便對照排查 */
export function describeError(err) {
  const msg = (err && err.message) || '';
  if (msg === 'timeout') return '連線逾時。';
  if (msg === 'sdk-load-failed' || msg === 'sdk-missing') return '無法載入 Supabase SDK（CDN 可能被擋）。';
  const status = err && err.status;
  if (!status) return '網路連不上 Supabase。';
  let hint = '';
  if (/permission denied/i.test(msg)) hint = '資料表沒有開放 anon 權限，請在 SQL Editor 執行 GRANT（見 sql/leaderboard.sql）。';
  else if (/invalid api key|invalid jwt|jwt/i.test(msg)) hint = 'API key 無效、被停用或已輪替，請到 Dashboard → API Keys 重新複製。';
  else if (/no api key/i.test(msg)) hint = '請求沒有帶 apikey。';
  else if (/relation .* does not exist|could not find the table/i.test(msg)) hint = '資料表還沒建立，請先執行 sql/leaderboard.sql。';
  return `錯誤 ${status}：${msg}${hint ? '。' + hint : ''}`;
}
