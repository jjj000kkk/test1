/** 平台種類。獨立成一個檔案，避免 stages.js 與 platforms.js 互相引用 */
export const Kind = Object.freeze({
  NORMAL: 'NORMAL',
  SPIKES: 'SPIKES',
  CONVEYOR: 'CONVEYOR',
  SPRING: 'SPRING',
  FLIP: 'FLIP',
  ICE: 'ICE',
  SLIME: 'SLIME',
  MOVING: 'MOVING',
  PORTAL: 'PORTAL',
  SPIKE_MOVING: 'SPIKE_MOVING',
  LASER: 'LASER',
  PHANTOM: 'PHANTOM',
});

export const KIND_LABEL = Object.freeze({
  NORMAL: '一般', SPIKES: '尖刺', CONVEYOR: '滾輪', SPRING: '彈簧', FLIP: '碎石',
  ICE: '滑冰', SLIME: '泥沼', MOVING: '橫移', PORTAL: '傳送門', SPIKE_MOVING: '動態尖刺',
  LASER: '雷射', PHANTOM: '幻影',
});

/** 踩上去之後會把人「丟」下去的平台：碎石、幻影。生成器的防死局規則要一起看 */
export const isDropper = (kind) => kind === Kind.FLIP || kind === Kind.PHANTOM;
