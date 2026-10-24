// 手機測試面板（只在 mobile-test 版本注入，正式版沒有）：選起始樓層、無敵、解鎖全部。
(() => {
  const g = window.__game;
  const kd = window.__kd;
  if (!g || !kd) return;
  const FLOORS = [1, 30, 80, 150, 300, 500];
  let startFloor = 1;
  let god = false;

  // 開局後把世界改成從指定樓層開始（倒數期間物理是停的，改了沒有副作用）
  const origStart = g.start.bind(g);
  g.start = function () {
    origStart();
    if (startFloor <= 1) return;
    const w = g.world;
    w.generator.reset();
    const first = w.generator.createFirst(Math.round(w.H * 0.42));
    w.generator.index = startFloor;
    first.index = startFloor;
    w.platforms = [first];
    w.floor = startFloor;
    w.stageId = w.stage.id;
    w.endgame = startFloor >= kd.FX.ENDGAME_FLOOR;
    w.fillPlatforms();
    w.player.x = first.cx - w.player.w / 2;
    w.player.y = first.y - w.player.h;
    w.player.ground = first;
  };
  setInterval(() => {
    if (god && g.world && !g.world.over) g.world.player.hp = kd.CONFIG.MAX_HP_UNITS;
  }, 100);

  const css = document.createElement('style');
  css.textContent = `
  #mt-fab{position:fixed;left:8px;top:48px;z-index:99999;width:40px;height:40px;border-radius:20px;border:0;background:#ffb547;color:#17142e;font-size:20px}
  #mt-panel{position:fixed;left:8px;top:94px;z-index:99999;width:230px;padding:10px;border-radius:12px;background:rgba(23,20,46,.96);color:#f4f0ff;font:14px/1.4 system-ui,sans-serif;border:1px solid #3a3466;display:none}
  #mt-panel h4{margin:0 0 6px;font-size:13px;color:#a49ccf}
  #mt-panel .row{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
  #mt-panel button{padding:8px 10px;border-radius:8px;border:1px solid #3a3466;background:#2a2550;color:#f4f0ff;font-size:14px}
  #mt-panel button.on{background:#ffb547;color:#17142e;border-color:#ffb547}
  #mt-note{font-size:12px;color:#a49ccf}`;
  document.head.appendChild(css);

  const fab = document.createElement('button');
  fab.id = 'mt-fab';
  fab.textContent = '🧪';
  fab.setAttribute('aria-label', '測試面板');
  const panel = document.createElement('div');
  panel.id = 'mt-panel';
  panel.innerHTML = `
    <h4>起始樓層（下一局開始生效）</h4><div class="row" id="mt-floors"></div>
    <h4>輔助</h4><div class="row"><button id="mt-god">無敵：關</button><button id="mt-unlock">解鎖全部</button></div>
    <div id="mt-note">用法：選樓層 → 回主選單按「開始遊戲」。B500 以上才會出現雷射與幻影。測試版，正式版沒有這個面板。</div>`;
  document.body.append(fab, panel);

  const box = panel.querySelector('#mt-floors');
  const paint = () => box.querySelectorAll('button').forEach((b) => b.classList.toggle('on', Number(b.dataset.f) === startFloor));
  for (const f of FLOORS) {
    const b = document.createElement('button');
    b.dataset.f = f;
    b.textContent = f === 1 ? 'B1' : `B${f}`;
    b.onclick = () => { startFloor = f; paint(); };
    box.appendChild(b);
  }
  paint();
  fab.onclick = () => { panel.style.display = panel.style.display === 'block' ? 'none' : 'block'; };
  const godBtn = panel.querySelector('#mt-god');
  godBtn.onclick = () => { god = !god; godBtn.textContent = `無敵：${god ? '開' : '關'}`; godBtn.classList.toggle('on', god); };
  panel.querySelector('#mt-unlock').onclick = () => {
    try { localStorage.setItem('kids-downstairs.bests.v2', JSON.stringify({ standard: 150, turbo: 150, nightmare: 0 })); } catch {}
    location.reload();
  };
})();
