// 遊戲全域參數。所有座標都是「邏輯座標」：寬固定 360，高依螢幕比例在 MIN_H~MAX_H 之間。
export const CONFIG = Object.freeze({
  WORLD_W: 360,
  MIN_H: 540,
  MAX_H: 780,

  HUD_H: 40,          // 頂部 HUD 區
  CEILING_Y: 62,      // 刺針天花板的下緣

  // 物理（單位：邏輯 px / 秒）
  GRAVITY: 1900,
  MAX_FALL: 640,
  MOVE_SPEED: 190,
  MOVE_ACCEL: 2600,   // 左右加速度，讓手感不會太滑也不會太硬
  MAX_STEP: 1 / 120,  // 物理子步長上限（任何刷新率都切成 <= 1/120 秒）
  MAX_FRAME_DT: 0.1,  // 分頁切回來時避免一次跳太大

  PLAYER_W: 22,
  PLAYER_H: 30,

  PLATFORM_W: 84,
  PLATFORM_H: 12,
  PLATFORM_GAP: 76,   // 平台垂直間距
  PLATFORM_JITTER: 10,
  WALL_MARGIN: 6,

  // 平台上升速度：隨樓層微幅加速
  RISE_BASE: 72,
  RISE_PER_FLOOR: 0.45,
  RISE_MAX: 150,
  RISE_BONUS_FLOOR: 200,      // 超過這一層後，上升速度額外乘上 RISE_BONUS（第四階段機制，所有模式適用）
  RISE_BONUS: 1.2,
  NIGHTMARE_UNLOCK_FLOOR: 150, // 標準或極速模式打到這一層，才開放地獄模式

  // 血量：6 格 = 3 HP，1 格 = 0.5 HP
  MAX_HP_UNITS: 6,
  SPIKE_DAMAGE: 2,
  CEILING_DAMAGE: 2,
  INVINCIBLE_TIME: 1.5,
  HEAL_STREAK: 15,

  // 平台生成
  SAFE_START: 3,              // 前幾階一定是一般平台
  SPIKE_CHANCE_BASE: 0.14,
  SPIKE_CHANCE_PER_FLOOR: 0.004,
  SPIKE_CHANCE_MAX: 0.42,
  MAX_SPIKE_STREAK: 2,        // 連續 2 個刺針後強制一般平台
  REACH_SAFETY: 0.8,          // 規劃路徑時，只信任角色 80% 的移動速度（安全容錯）
  RISE_TOLERANCE: 0.05,       // 路徑要在上升速度 ±5% 內都成立
  MIN_OFFSET_RATIO: 0.6,      // 相鄰兩階中心點最小距離（平台寬度的倍數），避免視覺上疊在一起
  SPIKE_AFTER_NORMAL_RATIO: 1.2, // 一般平台之後的刺針平台，中心點要拉開的距離（平台寬度的倍數）
  SHADOW_MARGIN: 10,          // 新的一般平台正上方通道，左右各加寬多少，不能碰到危險投影區
  SPIKE_CHANNEL: 1.5,         // 連續刺針之間要留的空隙通道，單位為角色寬度的倍數
  WARN_FLOOR: 50,             // 50 層後顯示安全預警光暈

  COUNTDOWN: 3,

  // 陀螺儀
  GYRO_DEADZONE: 2.5,         // 度
  GYRO_DEFAULT_TILT: 22,      // 傾斜多少度達到全速
});

// 特殊平台的效果參數（第四階段平台系統）
const SPRING_BASE_HEIGHT = 150; // 彈簧原本的彈跳高度（px）
const SPRING_POWER = 1.25;      // 彈跳衝力（初速）倍率；高度跟初速的平方成正比

export const FX = Object.freeze({
  CONVEYOR_PUSH: 72,       // 滾輪：站在上面每秒被推多少 px（原本 60 的 1.2 倍）
  SPRING_POWER,
  SPRING_HEIGHT: SPRING_BASE_HEIGHT * SPRING_POWER * SPRING_POWER, // 彈簧：理想彈跳高度（px），約 234
  SPRING_MIN_HEIGHT: 24,   // 離天花板太近、彈不到這個高度就不彈（當一般平台）
  SPRING_GUARD_RATIO: 1.8, // 彈簧正上方這個倍數 × 彈跳高度之內，不能有尖刺 / 雷射平台
  FLIP_DELAY: 0.6,         // 碎石：踩上後震動幾秒就碎裂
  FLIP_FADE: 0.45,         // 碎石：碎片掉落動畫的時間
  FLIP_ICE_GAP: 2,         // 碎石 / 幻影之後幾層之內不放滑冰、泥沼
  FLIP_FLIP_GAP: 2,        // 碎石 / 幻影之後幾層之內不放另一個碎石 / 幻影
  FLIP_SPIKE_GAP: 1,       // 碎石 / 幻影之後幾層之內不放尖刺
  ICE_ACCEL_SCALE: 0.264,  // 滑冰：左右加速度（含反向煞車）；原本 0.22 的 1.2 倍
  ICE_SLIDE_SPEED: 213,    // 滑冰：按一下（不管按多大力）就以這個固定速度滑出去（142 的 1.5 倍），之後放開也不會停，直到踩上非冰面或撞牆
  SLIME_LATE_FLOOR: 300,         // 泥沼：這一層以上，減速效果減少 25%
  SLIME_LATE_SCALE: 1 - (1 - 0.5 / 1.3) * 0.75, // 泥沼 >= 300F：速度倍率 0.5385（減速 61.54% → 46.155%，減少 25%），190 → 約 102.3 px/s
  SLIME_SPEED_SCALE: 0.5 / 1.3, // 泥沼：站在上面時水平速度剩這個比例（約 38%，原本 50% 再加強 1.3 倍）
  MOVING_AMP: 28,          // 橫移：左右巡邏半徑（px）
  MOVING_OMEGA: 1.25,      // 橫移：角速度（rad/s），最高水平速度 = AMP × OMEGA
  PORTAL_FLASH: 0.35,      // 傳送門：傳送特效時間
  PORTAL_DELAY: 0.3,       // 傳送門：踩上後傳送門立刻消失，目的地馬上出現 0.3 秒的傳送動畫，結束才真的傳過去
  PORTAL_UP_CHANCE: 0.7,   // 傳送門：往上傳的機率（其餘往下；找不到合法目標就換另一個方向）
  PORTAL_UP_RANGE: 6,      // 傳送門：往上時，只找上方這麼多層之內的安全平台
  PORTAL_DROP_HEIGHT: 200, // 傳送門：角色出現在目標平台表面上方這麼高（px），再自由落下
  PORTAL_CEILING_SAFE: 250, // 傳送門：目標平台離頂端天花板尖刺至少這麼遠（px），預留落下空間
  PORTAL_NEAR_CEILING: 100, // 傳送門：落點離天花板尖刺小於這麼多（px），而且下方安全平台也太近時，落點往下移
  PORTAL_NEAR_FLOOR: 150,   // 傳送門：落點正下方最近的安全平台小於這麼多（px）算太近；同時是往下移的距離
  PORTAL_UP_HEADROOM: 1.5, // 傳送門：往上傳的落點，離天花板至少要有這麼多秒的上升空間，否則一落地就被刺到
  PORTAL_BOTTOM_MARGIN: 110, // 傳送門：落點離畫面下緣至少這麼遠（約 1.5 層），免得傳過去下面已經沒有平台可踩
  ENDGAME_FLOOR: 500,      // 這一層以上，第五階段多出雷射與幻影平台
  LASER_ON: 1,             // 雷射：開啟幾秒
  LASER_OFF: 2,            // 雷射：關閉幾秒
  LASER_WARN: 0.5,         // 雷射：開啟前幾秒開始閃爍預警
  LASER_WIDTH: 14,         // 雷射：光束寬度（px），在平台正中央
  LASER_LENGTH: 190 * 1.3, // 雷射：光束往下延伸多長（px），原本 190 的 1.3 倍
  LASER_MAX: 2,            // 雷射：同時存在的雷射平台上限（畫面與預先生成的平台合計）
  PHANTOM_PERIOD: 1,       // 幻影：每隔幾秒在實體與虛無之間切換一次
  PHANTOM_BLINK: 0.3,      // 幻影：切換前幾秒開始閃爍預警
});

export const AUDIO = Object.freeze({
  VOICE_UNLOCK_FLOOR: 30, // 最高紀錄達到這一層，才開放自訂語音包
  VOICE_RATE_MAX: 1.8,    // 自訂語音：播放速率（音高）上限，隨層數線性提高
  VOICE_RATE_FLOORS: 400, // 自訂語音：從 1.0 倍線性提高，到這一層達到上限
  VOICE_FADE: 0.03,       // 自訂語音：同時超過上限時，最早的那個淡出切斷的秒數
  VOICE_MAX: 3,           // 自訂語音：全域最多同時播放幾個
  REVERSE_FLOOR: 300,     // 倒放語音：踩到傳送門且層數 >= 這個值，100% 觸發
  CRUSH_BUFF_SECONDS: 5,  // 電音破音：踩到 / 被雷射打到之後持續幾秒
  CRUSH_MAX_LEVEL: 4,     // 電音破音強度上限（level = min(層數 / 100, 4)）
  STUTTER_CHANCE: 0.4,    // 碎石平台：踩到時 40% 機率口吃（其他平台不會）
  STUTTER_SECONDS: 0.5,   // 口吃：重複的開頭片段長度（前 0.5 秒），重複 2~3 次後再播完整語音
  SPRING_SLOW: 0.5,       // 彈簧：前段放慢成這個速度（蓄力壓下），後段恢復
  SPRING_HEAD_MAX: 0.8,   // 彈簧：前段長度上限（秒）；也不超過語音總長的 SPRING_HEAD_RATIO
  SPRING_HEAD_RATIO: 0.6,
  ICE_BEND_UP: 1.5,       // 冰面：播放速率拉高到這個倍數
  ICE_BEND_DOWN: 0.6,     // 冰面：再陡降到這個倍數（滑倒失控的尾音）
  ICE_BEND_UP_SECONDS: 0.3,
  ICE_BEND_DOWN_SECONDS: 0.15,
  SLIME_VOICE_CUTOFF: 1000, // 泥沼：低通濾波截止頻率（Hz）
  SLIME_VOICE_RATE: 0.7,    // 泥沼：語音播放速率（放慢 30%）
  SLIME_TREMOLO_HZ: 10,     // 泥沼：音量抖動頻率（8~12Hz）
  SLIME_TREMOLO_DEPTH: 0.2, // 泥沼：音量抖動幅度（±20%）
  SLIME_LOOP_INTERVAL: 0.15, // 泥沼：每隔這麼久疊上一小段重複的語音片段（秒）
  SLIME_LOOP_LENGTH: 0.1,    // 泥沼：重複片段長度（秒）
  SLIME_LOOP_BACK: 0.06,     // 泥沼：重複片段從目前位置往前多少秒開始（像被黏住的回彈）
  STRETCH_FRAME: 0.025,      // 保持音高的變速：處理視窗長度（秒）
  LOW_HP: 2,              // 低血量（<= 2/6）：語音強制慢速低沉
  LOW_RATE: 0.7,          // 低血量：播放速率（0.5 太低、聽不清人聲）
  LOW_MAX_SECONDS: 2.5,   // 低血量：單次語音最長只播這麼久
  LOW_CUTOFF: 800,        // 低血量：低通濾波截止頻率（Hz），濾掉刺耳高頻、保留中頻人聲
  REPLAY_SECONDS: 10,     // 死前重播只保留最後幾秒
  CLIP_MAX_SECONDS: 1.5,  // 自訂音效最長錄音秒數
  CLIP_MIN_SECONDS: 0.15, // 太短的錄音視為誤觸，直接丟掉
  TAP_SIZE: 2048,         // 擷取麥克風的緩衝大小（取樣數）
  SLOTS: ['A', 'B', 'C'],
});

export const CLIP_KINDS = Object.freeze([
  { id: 'safe', title: '踩到安全平台' },
  { id: 'hurt', title: '踩到尖刺扣血' },
]);

export const CONTROL_MODES = Object.freeze([
  { id: 'tap', name: '左右點擊', desc: '按住螢幕左半邊往左，右半邊往右' },
  { id: 'buttons', name: '虛擬按鍵', desc: '下方左右方向鈕，判定範圍比按鈕本身大' },
  { id: 'joystick', name: '虛擬搖桿', desc: '下半部按住，搖桿出現在手指位置，左右拖曳，拉越遠走越快' },
  { id: 'gyro', name: '陀螺儀體感', desc: '左右傾斜手機移動（困難模式）', hard: true },
]);

export const COLORS = Object.freeze({
  shaft: '#17142e',
  shaftDeep: '#0e0c1f',
  brick: '#221e44',
  brickLine: '#2c2756',
  hud: '#0e0c1f',
  ink: '#f4f0ff',
  inkDim: '#a49ccf',
  stone: '#7fd6c8',
  stoneTop: '#c5f3ea',
  stoneShade: '#3f8f86',
  spike: '#ff5d6c',
  spikeDark: '#b3263a',
  ceiling: '#d9d3f5',
  kid: '#ffb547',
  kidDark: '#d9821c',
  skin: '#ffd9b8',
  hair: '#3a2416',
  heart: '#ff5d6c',
  heartEmpty: '#3a3466',
  glow: '#6dff9e',
  control: 'rgba(244, 240, 255, 0.16)',
  controlActive: 'rgba(255, 181, 71, 0.55)',
});
