import { CONFIG, COLORS, FX } from './config.js';
import { Kind } from './kinds.js';

const DISPLAY_FONT = '"Bungee", "Noto Sans TC", system-ui, sans-serif';
const BODY_FONT = '"Noto Sans TC", system-ui, sans-serif';

function heartPath(ctx, x, y, s) {
  // 以 (x, y) 為中心、寬約 2s 的愛心
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.85);
  ctx.bezierCurveTo(x - s * 1.3, y - s * 0.1, x - s * 0.7, y - s * 1.05, x, y - s * 0.4);
  ctx.bezierCurveTo(x + s * 0.7, y - s * 1.05, x + s * 1.3, y - s * 0.1, x, y + s * 0.85);
  ctx.closePath();
}

export class Renderer {
  constructor(viewport) {
    this.viewport = viewport;
  }

  /** game: 由 Game 提供的唯讀狀態 */
  render(game, input) {
    const ctx = this.viewport.beginFrame();
    const W = this.viewport.W;
    const H = this.viewport.H;

    ctx.save();
    if (game.shake > 0) {
      const m = game.shake * 6;
      ctx.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
    }
    this.drawBackground(ctx, W, H, game.depth);
    for (const p of game.platforms) this.drawPlatform(ctx, p, game.time);
    this.drawPlayer(ctx, game.player, game.time);
    this.drawCeiling(ctx, W);
    ctx.restore();

    if (game.flash > 0) {
      ctx.fillStyle = `rgba(255, 93, 108, ${game.flash * 0.35})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (game.healFlash > 0) {
      ctx.fillStyle = `rgba(109, 255, 158, ${game.healFlash * 0.18})`;
      ctx.fillRect(0, 0, W, H);
    }

    if (game.state === 'playing' || game.state === 'countdown') input.draw(ctx);
    this.drawHud(ctx, W, game);
    if (game.state === 'countdown') this.drawCountdown(ctx, W, H, game.countdown);
    if (game.goTimer > 0) this.drawGo(ctx, W, H, game.goTimer);
  }

  drawBackground(ctx, W, H, depth) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, COLORS.shaftDeep);
    g.addColorStop(0.35, COLORS.shaft);
    g.addColorStop(1, COLORS.shaftDeep);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // 兩側磚牆隨下降捲動，提供速度感
    const bh = 18;
    const off = -(depth % (bh * 2));
    ctx.fillStyle = COLORS.brick;
    ctx.fillRect(0, 0, 14, H);
    ctx.fillRect(W - 14, 0, 14, H);
    ctx.strokeStyle = COLORS.brickLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let y = off; y < H + bh; y += bh) {
      ctx.moveTo(0, y);
      ctx.lineTo(14, y);
      ctx.moveTo(W - 14, y);
      ctx.lineTo(W, y);
      const odd = Math.round((y - off) / bh) % 2;
      const sx = odd ? 7 : 0;
      ctx.moveTo(sx, y);
      ctx.lineTo(sx, y + bh);
      ctx.moveTo(W - 14 + sx, y);
      ctx.lineTo(W - 14 + sx, y + bh);
    }
    ctx.stroke();

    // 遠景的小灰塵
    ctx.fillStyle = 'rgba(164, 156, 207, 0.12)';
    for (let i = 0; i < 18; i++) {
      const x = (i * 97.3) % (W - 40) + 20;
      const y = (((i * 151.7 - depth * 0.35) % H) + H) % H;
      ctx.fillRect(x, y, 2, 2);
    }
  }

  drawCeiling(ctx, W) {
    const top = CONFIG.HUD_H;
    const bottom = CONFIG.CEILING_Y;
    ctx.fillStyle = COLORS.hud;
    ctx.fillRect(0, 0, W, top);
    ctx.fillStyle = COLORS.ceiling;
    ctx.fillRect(0, top, W, 6);
    const n = 18;
    const sw = W / n;
    ctx.fillStyle = COLORS.ceiling;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      ctx.moveTo(i * sw, top + 6);
      ctx.lineTo(i * sw + sw / 2, bottom);
      ctx.lineTo((i + 1) * sw, top + 6);
    }
    ctx.fill();
    ctx.fillStyle = 'rgba(14, 12, 31, 0.35)';
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      ctx.moveTo(i * sw + sw / 2, top + 6);
      ctx.lineTo(i * sw + sw / 2, bottom);
      ctx.lineTo((i + 1) * sw, top + 6);
    }
    ctx.fill();
  }

  /** 通用石板：上層 top、側面 shade，可以換顏色 */
  slab(ctx, p, top, shade, hi, seams = true) {
    const { x, y, w, h } = p;
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.roundRect(x, y + 2, w, h, 3);
    ctx.fill();
    ctx.fillStyle = top;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h - 2, 3);
    ctx.fill();
    ctx.fillStyle = hi;
    ctx.fillRect(x + 3, y + 1, w - 6, 2);
    if (seams) {
      ctx.fillStyle = shade;
      ctx.fillRect(x + w * 0.33, y + 4, 1, h - 6);
      ctx.fillRect(x + w * 0.66, y + 4, 1, h - 6);
    }
  }

  spikes(ctx, p, y = p.y) {
    const { x, w, h } = p;
    ctx.fillStyle = COLORS.spikeDark;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 3);
    ctx.fill();
    ctx.fillStyle = COLORS.spike;
    const n = 7;
    const sw = w / n;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      ctx.moveTo(x + i * sw, y + 1);
      ctx.lineTo(x + i * sw + sw / 2, y - 9);
      ctx.lineTo(x + (i + 1) * sw, y + 1);
    }
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.fillRect(x + 3, y + 2, w - 6, 2);
  }

  /** 橫移平台的巡邏軌道：平台下方一條淡淡的線，標出會移動到哪裡 */
  rail(ctx, p, color) {
    const f = p.footprint;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(f.x, p.y + p.h + 4);
    ctx.lineTo(f.x + f.w, p.y + p.h + 4);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  arrows(ctx, p, color) {
    const cy = p.y + p.h / 2;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(p.x + 7, cy);
    ctx.lineTo(p.x + 12, cy - 3);
    ctx.lineTo(p.x + 12, cy + 3);
    ctx.moveTo(p.x + p.w - 7, cy);
    ctx.lineTo(p.x + p.w - 12, cy - 3);
    ctx.lineTo(p.x + p.w - 12, cy + 3);
    ctx.fill();
  }

  /**
   * 碎石：灰色的碎石塊拼成的平台。踩上去後每一塊各自劇烈抖動（震幅隨時間變大），
   * 0.6 秒後瞬間碎裂，碎片往下掉並淡出。沒有進度條。
   */
  rubble(ctx, p, time) {
    const { x, y, w, h } = p;
    const n = 6;
    const tw = w / n;
    const tones = ['#9a9aa6', '#85858f', '#a9a9b4', '#7d7d88'];
    if (p.state === 'gone') {
      const s = FX.FLIP_FADE - p.fade; // 碎裂後經過的秒數
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.fade / FX.FLIP_FADE);
      for (let i = 0; i < n * 2; i++) {
        const seed = p.id * 31 + i * 17;
        const vx = ((seed % 70) - 35) * 1.3;
        const vy = -40 + (seed % 23) * 4;
        const px = x + (i % n) * tw + vx * s;
        const py = y + (i < n ? 0 : h / 2) + vy * s + 0.5 * 1500 * s * s;
        ctx.save();
        ctx.translate(px + tw / 2, py + h / 4);
        ctx.rotate(s * (((seed % 9) - 4) * 2.2));
        ctx.fillStyle = tones[seed % tones.length];
        ctx.fillRect(-tw / 2, -h / 4, tw - 1, h / 2);
        ctx.restore();
      }
      ctx.restore();
      return;
    }
    const amp = p.state === 'armed' ? 0.8 + 2.6 * p.progress : 0;
    for (let i = 0; i < n; i++) {
      const jx = amp ? Math.sin(time * 90 + i * 2.3 + p.id) * amp : 0;
      const jy = amp ? Math.cos(time * 77 + i * 1.7 + p.id) * amp * 0.7 : 0;
      const tx = x + i * tw + jx;
      ctx.fillStyle = tones[(i + p.id) % tones.length];
      ctx.beginPath();
      ctx.roundRect(tx, y + jy, tw - 1, h - 1, 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
      ctx.fillRect(tx + 1, y + jy + 1, tw - 3, 2);
      ctx.fillStyle = 'rgba(30, 30, 40, 0.35)';
      ctx.fillRect(tx + tw * 0.4, y + jy + 4, 1, h - 6); // 裂縫
    }
    if (p.state === 'armed') {
      // 震動時揚起的小碎屑
      ctx.fillStyle = 'rgba(200, 200, 210, 0.7)';
      for (let i = 0; i < 4; i++) {
        const k = (time * 5 + i * 0.37 + p.id) % 1;
        ctx.fillRect(x + ((i * 23 + p.id * 7) % (w - 4)), y + h + k * 14, 2, 2);
      }
    }
  }

  /** 傳送門的預告：0.3 秒內在「即將傳送的地方」出現一個由小變大的漩渦，並用虛線連回傳送門 */
  portalTarget(ctx, p, time) {
    const pt = p.targetPoint();
    if (!pt) return;
    const prog = 1 - Math.max(0, p.pending.t) / FX.PORTAL_DELAY; // 0 → 1
    const r = 6 + 22 * prog;
    ctx.save();
    ctx.strokeStyle = `rgba(216, 190, 255, ${0.25 + 0.4 * prog})`;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(p.cx, p.y - 4);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
    ctx.setLineDash([]);
    const g = ctx.createRadialGradient(pt.x, pt.y, 1, pt.x, pt.y, r * 1.6);
    g.addColorStop(0, `rgba(190, 150, 255, ${0.55 * prog + 0.2})`);
    g.addColorStop(1, 'rgba(190, 150, 255, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(pt.x - r * 1.6, pt.y - r * 1.6, r * 3.2, r * 3.2);
    ctx.strokeStyle = '#e9ddff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(pt.x, pt.y, r, r * 0.7, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(233, 221, 255, 0.7)';
    ctx.beginPath();
    ctx.ellipse(pt.x, pt.y, r * 0.55, r * 0.38, time * 9, 0, Math.PI * 1.5);
    ctx.stroke();
    ctx.restore();
  }

  /** 雷射：黑色機座 + 紅色發射口。光束在開啟時是粗紅線，預警時是閃爍的細線 */
  laser(ctx, p, time) {
    const { x, y, w, h } = p;
    this.slab(ctx, p, '#43435a', '#23233a', '#8a8aa8', false);
    const cx = p.cx;
    const on = p.beamOn;
    ctx.fillStyle = on ? '#ff3b4d' : p.beamWarn ? '#ff9aa3' : '#7a2a35';
    ctx.beginPath();
    ctx.roundRect(cx - 9, y + h - 4, 18, 7, 3);
    ctx.fill();
    const b = p.beam;
    if (on) {
      const g = ctx.createLinearGradient(0, b.top, 0, b.bottom);
      g.addColorStop(0, 'rgba(255, 70, 90, 0.95)');
      g.addColorStop(1, 'rgba(255, 70, 90, 0.35)');
      ctx.fillStyle = g;
      ctx.fillRect(b.x, b.top, b.w, b.bottom - b.top);
      ctx.fillStyle = 'rgba(255, 240, 240, 0.9)';
      ctx.fillRect(cx - 2, b.top, 4, b.bottom - b.top);
    } else if (p.beamWarn) {
      if (Math.floor(time * 16) % 2 === 0) {
        ctx.fillStyle = 'rgba(255, 90, 110, 0.55)';
        ctx.fillRect(cx - 1, b.top, 2, b.bottom - b.top);
      }
    }
  }

  /** 幻影：半透明的紫青色平台。虛無時只剩虛線輪廓，切換前 0.3 秒閃爍 */
  phantom(ctx, p, time) {
    const { x, y, w, h } = p;
    const warn = p.untilFlip < FX.PHANTOM_BLINK && Math.floor(time * 20) % 2 === 0;
    if (p.solid) {
      ctx.save();
      ctx.globalAlpha = warn ? 0.45 : 0.9;
      this.slab(ctx, p, '#7fe3e0', '#2f8f9a', '#dffffe', false);
      ctx.restore();
    } else {
      ctx.save();
      ctx.globalAlpha = warn ? 0.55 : 0.22;
      ctx.strokeStyle = '#9ff3ee';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, 3);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawPlatform(ctx, p, time = 0) {
    const { x, y, w, h } = p;
    switch (p.kind) {
      case Kind.SPIKES:
        this.spikes(ctx, p);
        return;
      case Kind.SPIKE_MOVING:
        this.rail(ctx, p, 'rgba(255, 93, 108, 0.35)');
        this.spikes(ctx, p);
        this.arrows(ctx, p, 'rgba(255, 255, 255, 0.55)');
        return;
      case Kind.CONVEYOR: {
        this.slab(ctx, p, '#6b7fa8', '#3c4a6b', '#aebfe3', false);
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(x, y, w, h - 2, 3);
        ctx.clip();
        ctx.fillStyle = 'rgba(244, 240, 255, 0.55)';
        const sp = 14;
        const off = (((time * 28 * p.dir) % sp) + sp) % sp;
        for (let cx = x - sp + off; cx < x + w + sp; cx += sp) {
          const cy = y + (h - 2) / 2;
          ctx.beginPath();
          if (p.dir > 0) {
            ctx.moveTo(cx, cy - 4);
            ctx.lineTo(cx + 5, cy);
            ctx.lineTo(cx, cy + 4);
            ctx.lineTo(cx + 2, cy + 4);
            ctx.lineTo(cx + 7, cy);
            ctx.lineTo(cx + 2, cy - 4);
          } else {
            ctx.moveTo(cx + 7, cy - 4);
            ctx.lineTo(cx + 2, cy);
            ctx.lineTo(cx + 7, cy + 4);
            ctx.lineTo(cx + 5, cy + 4);
            ctx.lineTo(cx, cy);
            ctx.lineTo(cx + 5, cy - 4);
          }
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
        return;
      }
      case Kind.SPRING: {
        this.slab(ctx, p, '#e0a13a', '#9a6a17', '#ffe0a0', false);
        // 彈簧圈：剛彈起來時被壓扁再回彈
        const coil = 9 * (1 - 0.6 * p.squash) * (p.charges > 0 ? 1 : 0.6);
        const cx = p.cx;
        ctx.strokeStyle = p.charges > 0 ? '#f4f0ff' : '#a49ccf';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx - 9, y);
        for (let i = 0; i < 4; i++) {
          const yy = y - ((i + 1) * coil) / 4;
          ctx.lineTo(cx + (i % 2 ? -9 : 9), yy);
        }
        ctx.lineTo(cx, y - coil - 1);
        ctx.stroke();
        ctx.fillStyle = COLORS.kid;
        ctx.fillRect(cx - 11, y - coil - 3, 22, 3);
        return;
      }
      case Kind.FLIP:
        this.rubble(ctx, p, time);
        return;
      case Kind.ICE:
        this.slab(ctx, p, '#c9ecff', '#6fb4e0', '#ffffff', false);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i < 3; i++) {
          const sx = x + 14 + i * 24;
          ctx.moveTo(sx, y + h - 4);
          ctx.lineTo(sx + 9, y + 3);
        }
        ctx.stroke();
        return;
      case Kind.SLIME: {
        this.slab(ctx, p, '#a86bdc', '#5d2f8f', '#e6c9ff', false);
        ctx.fillStyle = '#a86bdc';
        ctx.beginPath();
        for (let i = 0; i < 4; i++) {
          const sx = x + 10 + i * 21;
          const len = 4 + 3 * Math.sin(time * 3 + i * 1.7 + p.id);
          ctx.moveTo(sx - 3, y + h - 3);
          ctx.quadraticCurveTo(sx, y + h + len + 2, sx + 3, y + h - 3);
        }
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.beginPath();
        ctx.arc(x + 20 + ((time * 9 + p.id * 7) % 44), y + 4, 1.6, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      case Kind.MOVING:
        this.rail(ctx, p, 'rgba(127, 214, 200, 0.4)');
        this.slab(ctx, p, '#5fb3d6', '#2d6f8f', '#bfe7f7');
        this.arrows(ctx, p, 'rgba(14, 12, 31, 0.6)');
        return;
      case Kind.LASER:
        this.laser(ctx, p, time);
        return;
      case Kind.PHANTOM:
        this.phantom(ctx, p, time);
        return;
      case Kind.PORTAL: {
        this.portalTarget(ctx, p, time);
        ctx.save();
        if (p.pending) ctx.globalAlpha = Math.max(0, p.warpLeft / FX.PORTAL_DELAY); // 踩上去就淡出消失
        const cx = p.cx;
        const cy = y - 4;
        const pulse = 0.7 + 0.3 * Math.sin(time * 6 + p.id);
        const hot = p.flash > 0 ? 1.6 : 1;
        const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, 30 * hot);
        g.addColorStop(0, `rgba(190, 150, 255, ${0.55 * pulse})`);
        g.addColorStop(1, 'rgba(190, 150, 255, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(cx - 34, cy - 30, 68, 40);
        this.slab(ctx, p, '#8b5cf6', '#4c2a9c', '#d8c8ff', false);
        ctx.strokeStyle = '#e9ddff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, 14, 9, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(233, 221, 255, 0.7)';
        ctx.beginPath();
        ctx.ellipse(cx, cy, 8, 5, time * 3, 0, Math.PI * 1.5);
        ctx.stroke();
        ctx.restore();
        return;
      }
      default:
        this.slab(ctx, p, COLORS.stone, COLORS.stoneShade, COLORS.stoneTop);
    }
  }

  drawPlayer(ctx, pl, time) {
    if (pl.warp) return; // 傳送中：角色被吸進傳送門，還沒出現
    if (pl.isInvincible && Math.floor(time * 12) % 2 === 0) return; // 無敵閃爍
    const { x, y, w, h } = pl;
    const cx = x + w / 2;
    const moving = Math.abs(pl.vx) > 10 && pl.ground;
    const step = moving ? Math.sin(pl.walkT * 0.18) * 3 : 0;

    // 腿
    ctx.fillStyle = COLORS.hair;
    ctx.fillRect(cx - 6, y + h - 8 + Math.max(0, step), 4, 8 - Math.max(0, step));
    ctx.fillRect(cx + 2, y + h - 8 + Math.max(0, -step), 4, 8 - Math.max(0, -step));
    // 身體
    ctx.fillStyle = COLORS.kid;
    ctx.beginPath();
    ctx.roundRect(cx - 9, y + 13, 18, h - 20, 4);
    ctx.fill();
    ctx.fillStyle = COLORS.kidDark;
    ctx.fillRect(cx - 9, y + h - 11, 18, 3);
    // 手（下落時舉高）
    const armUp = pl.ground ? 0 : -6;
    ctx.fillStyle = COLORS.skin;
    ctx.fillRect(cx - 12, y + 15 + armUp, 3, 7);
    ctx.fillRect(cx + 9, y + 15 + armUp, 3, 7);
    // 頭
    ctx.fillStyle = COLORS.skin;
    ctx.beginPath();
    ctx.arc(cx, y + 8, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLORS.hair;
    ctx.beginPath();
    ctx.arc(cx, y + 6, 8, Math.PI * 1.05, Math.PI * 1.95);
    ctx.fill();
    // 眼睛朝面向方向
    ctx.fillStyle = COLORS.hair;
    const ex = pl.facing * 2.5;
    ctx.fillRect(cx + ex - 3, y + 8, 2, 2.5);
    ctx.fillRect(cx + ex + 2, y + 8, 2, 2.5);
  }

  drawHud(ctx, W, game) {
    const pl = game.player;
    const cy = CONFIG.HUD_H / 2;
    // 3 顆愛心，每顆 2 格
    for (let i = 0; i < CONFIG.MAX_HP_UNITS / 2; i++) {
      const hx = 20 + i * 24;
      const units = Math.max(0, Math.min(2, pl.hp - i * 2));
      heartPath(ctx, hx, cy, 9);
      ctx.fillStyle = COLORS.heartEmpty;
      ctx.fill();
      if (units > 0) {
        ctx.save();
        if (units === 1) {
          ctx.beginPath();
          ctx.rect(hx - 12, cy - 12, 12, 24);
          ctx.clip();
        }
        heartPath(ctx, hx, cy, 9);
        ctx.fillStyle = COLORS.heart;
        ctx.fill();
        ctx.restore();
      }
    }

    // 回血進度：連踩 n/15（滿血時隱藏）
    if (pl.hp < CONFIG.MAX_HP_UNITS) {
      const bx = 90;
      ctx.fillStyle = COLORS.inkDim;
      ctx.font = `600 9px ${BODY_FONT}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(`回血 ${pl.streak}/${CONFIG.HEAL_STREAK}`, bx, cy - 6);
      ctx.fillStyle = COLORS.heartEmpty;
      ctx.fillRect(bx, cy + 3, 46, 4);
      ctx.fillStyle = COLORS.glow;
      ctx.fillRect(bx, cy + 3, (46 * pl.streak) / CONFIG.HEAL_STREAK, 4);
    }

    // 樓層
    ctx.fillStyle = COLORS.ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `20px ${DISPLAY_FONT}`;
    ctx.fillText(`B${game.floor}F`, W / 2 + 6, cy + 1);

    // 極速 / 地獄模式的倍率小標籤
    if (game.gameMode !== 'standard') {
      ctx.fillStyle = game.gameMode === 'nightmare' ? COLORS.spike : COLORS.kid;
      ctx.font = `10px ${DISPLAY_FONT}`;
      ctx.textAlign = 'left';
      ctx.fillText(game.gameMode === 'nightmare' ? 'x2.0' : 'x1.5', W / 2 + 60, cy + 1);
    }
  }

  drawCountdown(ctx, W, H, t) {
    const n = Math.ceil(t);
    if (n <= 0) return;
    const frac = n - t; // 0 → 1
    const s = 1 + (1 - frac) * 0.4;
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.65 * (1 - frac * 0.6);
    ctx.translate(W / 2, H * 0.36);
    ctx.scale(s, s);
    ctx.fillStyle = COLORS.kid;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `72px ${DISPLAY_FONT}`;
    ctx.fillText(String(n), 0, 0);
    ctx.restore();
  }

  drawGo(ctx, W, H, t) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, t * 2.5);
    ctx.fillStyle = COLORS.glow;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `56px ${DISPLAY_FONT}`;
    ctx.fillText('GO!', W / 2, H * 0.36);
    ctx.restore();
  }
}
