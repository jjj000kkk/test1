// node tools/build-single.mjs && node tools/build-mobile-test.mjs
// 產生 dist/mobile-test.html（獨立版）與 dist/mobile-test-artifact.html（可發佈成 artifact），兩者都多一個測試面板。
import { readFileSync, writeFileSync } from 'node:fs';
const root = new URL('..', import.meta.url).pathname;
const panel = `<script>\n${readFileSync(root + 'tools/mobile-test-panel.js', 'utf8')}\n</script>\n`;
const full = readFileSync(root + 'dist/index.html', 'utf8').replace('</body>', panel + '</body>');
writeFileSync(root + 'dist/mobile-test.html', full);
writeFileSync(root + 'dist/mobile-test-artifact.html', readFileSync(root + 'dist/artifact.html', 'utf8') + '\n' + panel);
console.log('built dist/mobile-test.html and dist/mobile-test-artifact.html');
