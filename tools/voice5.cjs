const { chromium } = require('/opt/node-tools/node_modules/playwright');
const TARGET = process.argv[2] || 'http://localhost:8765/index.html';
const results = [];
const check = (name, ok, info = '') => { results.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 420, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(TARGET); await sleep(500);
  const r = await page.evaluate(async () => {
    const a = __audio; const K = __kd.Kind;
    a.ensureCtx(); await a.ctx.resume();
    const sr = a.ctx.sampleRate; const buf = a.ctx.createBuffer(1, Math.round(sr * 1.5), sr);
    const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.sin(i / 20) * 0.5;
    for (const k of ['safe', 'hurt']) a.buffers.set(`${k}-A`, buf);
    a.voiceUnlocked = true; a.enabled = true;
    a.beginRun(); a.setCapturing(true);
    const out = { running: a.running };
    const p = (kind) => ({ kind });
    const seq = [['safe', 0, p(K.NORMAL), 6], ['safe', 350, p(K.PORTAL), 6], ['safe', 200, p(K.LASER), 6], ['safe', 200, p(K.NORMAL), 6], ['safe', 120, p(K.FLIP), 6], ['safe', 300, p(K.NORMAL), 2], ['hurt', 80, p(K.SPIKES), 1], ['safe', 400, p(K.PHANTOM), 6], ['safe', 90, p(K.SPRING), 6], ['safe', 90, p(K.ICE), 6], ['safe', 90, p(K.SLIME), 6], ['safe', 90, p(K.SLIME), 2], ['safe', 90, p(K.FLIP), 6]];
    Math.random = () => 0.05;
    const times = [];
    try {
      for (const [kind, fl, plat, hp] of seq) { const t0 = performance.now(); a.play(kind, fl, { platform: plat, hp }); times.push(performance.now() - t0); await new Promise((r) => setTimeout(r, 25)); }
      out.maxActive = a.voiceState.voices.length;
      out.played = true;
    } catch (e) { out.err = String(e); }
    for (let i = 0; i < 40 && a.voiceState.voices.length; i++) await new Promise((r) => setTimeout(r, 250));
    out.maxMs = Math.max(...times); out.spring = times[8];
    const snap = a.freeze();
    out.events = snap ? snap.events.length : -1; out.after = a.voiceState.voices.length;
    try { const track = await a.renderSfxTrack(snap); out.trackLen = track.length; out.peak = track.reduce((m, x) => Math.max(m, Math.abs(x)), 0); } catch (e) { out.renderErr = String(e); }
    return out;
  });
  check('真實 Web Audio：13 種組合的自訂語音全部播放不拋錯', r.running && r.played && !r.err, JSON.stringify(r));
  check('死前重播離線渲染含特殊效果的語音不拋錯、有聲音', !r.renderErr && r.events === 13 && r.peak > 0.01, `events=${r.events} peak=${r.peak && r.peak.toFixed(3)} ${r.renderErr || ''}`);
  check('同時播放的語音不超過 3 個，播完自動清空', r.maxActive <= 3 && r.after === 0, `max=${r.maxActive} after=${r.after}`);
  check('時間伸縮的運算時間可接受（單次 play < 150ms，含第一次伸縮）', r.maxMs < 150, `max=${r.maxMs && r.maxMs.toFixed(1)}ms spring=${r.spring && r.spring.toFixed(1)}ms`);
  check('沒有頁面錯誤', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(results.every(Boolean) ? `ALL ${results.length} PASSED` : 'SOME FAILED');
  process.exit(results.every(Boolean) ? 0 : 1);
})();
