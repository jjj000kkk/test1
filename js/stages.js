import { Kind } from './kinds.js';
import { FX } from './config.js';
import { lerp } from './utils.js';

/**
 * 五階段關卡：依「層數」決定平台的生成權重。
 *   normal：[階段起點, 階段終點] 的一般平台比例，在階段內線性過渡（例如 70% → 60%）
 *   kinds ：特殊平台之間的相對權重（會自動正規化）
 * 特殊平台比例 = 1 - 一般平台比例；尖刺平台算在特殊平台裡。
 * 最後一個階段沒有終點，過渡範圍取 B300~B400。
 */
export const STAGES = Object.freeze([
  {
    id: 1, name: '入門井道', from: 1, to: 30, normal: [0.85, 0.85],
    kinds: { [Kind.SPIKES]: 1 },
  },
  {
    id: 2, name: '機關登場', from: 31, to: 80, normal: [0.7, 0.6],
    kinds: { [Kind.FLIP]: 1, [Kind.SPRING]: 1, [Kind.CONVEYOR]: 1, [Kind.SPIKES]: 1.5 },
  },
  {
    id: 3, name: '濕滑地帶', from: 81, to: 150, normal: [0.5, 0.4],
    // 暫停翻轉與滾輪；保留彈簧；新增滑冰、泥沼、橫移
    kinds: { [Kind.SPRING]: 1, [Kind.ICE]: 1, [Kind.SLIME]: 1, [Kind.MOVING]: 1, [Kind.SPIKES]: 1.5 },
  },
  {
    id: 4, name: '極限深淵', from: 151, to: 299, normal: [0.4, 0.3],
    kinds: {
      [Kind.FLIP]: 1, [Kind.SPRING]: 1, [Kind.CONVEYOR]: 1, [Kind.ICE]: 1,
      [Kind.SLIME]: 1, [Kind.MOVING]: 1, [Kind.SPIKES]: 1.5,
    },
  },
  {
    id: 5, name: '傳送門領域', from: 300, to: 400, normal: [0.3, 0.2], open: true,
    kinds: {
      [Kind.FLIP]: 1, [Kind.SPRING]: 1, [Kind.CONVEYOR]: 1, [Kind.ICE]: 1,
      [Kind.SLIME]: 1, [Kind.MOVING]: 1, [Kind.PORTAL]: 1, [Kind.SPIKES]: 1.5,
    },
    spikeMovingChance: 0.5, // 尖刺平台有一半會左右巡邏
    // B500 以上的終極平台（FX.ENDGAME_FLOOR），加進第五階段的生成清單
    endgame: { [Kind.LASER]: 1.2, [Kind.PHANTOM]: 1.2 },
  },
]);

/** 階段管理器：回傳目前層數該用的生成權重，並負責抽出下一個平台的種類 */
export class StageManager {
  constructor(rng = Math.random) {
    this.rng = rng;
  }

  stageOf(floor) {
    for (const s of STAGES) if (!s.open && floor <= s.to) return s;
    return STAGES[STAGES.length - 1];
  }

  /** 該層的特殊平台權重：階段本身的清單，B500 以上再加上終極平台 */
  kindsAt(floor) {
    const s = this.stageOf(floor);
    return s.endgame && floor >= FX.ENDGAME_FLOOR ? { ...s.kinds, ...s.endgame } : s.kinds;
  }

  /** 該層一般平台的機率（階段內線性過渡） */
  normalChance(floor) {
    const s = this.stageOf(floor);
    const t = Math.min(1, Math.max(0, (floor - s.from) / Math.max(1, s.to - s.from)));
    return lerp(s.normal[0], s.normal[1], t);
  }

  /** 該層所有種類的實際機率（含一般平台），加總為 1；給測試與報表用 */
  distribution(floor) {
    const s = this.stageOf(floor);
    const pn = this.normalChance(floor);
    const kinds = this.kindsAt(floor);
    const total = Object.values(kinds).reduce((a, b) => a + b, 0);
    const out = { [Kind.NORMAL]: pn };
    for (const [kind, w] of Object.entries(kinds)) out[kind] = (1 - pn) * (w / total);
    return out;
  }

  /**
   * 抽出下一個平台的種類。allowed(kind) 是防死局規則（例如滑冰不能緊接在翻轉之後），
   * 被擋掉的種類直接排除、其餘權重重新分配；全被擋掉就回一般平台。
   */
  pick(floor, allowed = () => true) {
    const s = this.stageOf(floor);
    if (this.rng() < this.normalChance(floor)) return Kind.NORMAL;
    const entries = Object.entries(this.kindsAt(floor)).filter(([kind]) => allowed(kind));
    const total = entries.reduce((a, [, w]) => a + w, 0);
    if (!total) return Kind.NORMAL;
    let r = this.rng() * total;
    for (const [kind, w] of entries) {
      r -= w;
      if (r <= 0) return this.variant(s, kind);
    }
    return this.variant(s, entries[entries.length - 1][0]);
  }

  /** 第五階段：尖刺平台有機率變成會橫移的動態尖刺 */
  variant(stage, kind) {
    if (kind === Kind.SPIKES && stage.spikeMovingChance && this.rng() < stage.spikeMovingChance) return Kind.SPIKE_MOVING;
    return kind;
  }
}
