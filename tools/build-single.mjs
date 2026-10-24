// 把模組化原始碼打包成單一 HTML（可直接雙擊開啟，或發佈成 Artifact）
// 用法：node tools/build-single.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

// 依相依順序排列
const MODULES = [
  'config', 'utils', 'modes', 'kinds', 'settings', 'wav', 'clipstore', 'audio', 'replay',
  'stages', 'platform-types', 'platforms', 'player', 'world', 'gyro',
  'input', 'viewport', 'renderer', 'game', 'supabase', 'ui', 'main',
];

const js = MODULES.map((name) => {
  const src = read(`js/${name}.js`)
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^export\s+(?=(const|let|class|function|async)\b)/gm, '');
  return `// ── ${name}.js ──\n${src.trim()}\n`;
}).join('\n');

const css = read('css/style.css');
const html = read('index.html');
const body = html.split('<!-- BODY:START -->')[1].split('<!-- BODY:END -->')[0].trim();
const fonts = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bungee&family=Noto+Sans+TC:wght@400;700;900&display=swap">';
const script = `<script>\n(() => {\n'use strict';\n${js}\n})();\n</script>`;

mkdirSync(join(root, 'dist'), { recursive: true });

// 完整獨立版
writeFileSync(join(root, 'dist/index.html'), `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="theme-color" content="#0e0c1f">
<title>小朋友下樓梯</title>
${fonts}
<style>
${css}
</style>
</head>
<body>
${body}
${script}
</body>
</html>
`);

// Artifact 版（發佈時平台會自動包上 doctype/head/body）
writeFileSync(join(root, 'dist/artifact.html'), `<title>小朋友下樓梯</title>
${fonts}
<style>
${css}
</style>
${body}
${script}
`);

console.log('built dist/index.html and dist/artifact.html');
