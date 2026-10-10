/**
 * 瘦身版打包：web-slim/ → 幸运刮刮乐-瘦身版.html（单文件产物，用于上传到 Artifacts 类平台）
 * 与 build.mjs 的区别：
 * - 读取 web-slim/（图片已按显示尺寸降采样、无字体文件）
 * - 移除 @font-face，字体栈去掉 FZLT（改用系统字体），大幅减小体积
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const web = join(root, 'web-slim');

let html = readFileSync(join(web, 'index.html'), 'utf8');
let css = readFileSync(join(web, 'style.css'), 'utf8');
let js = readFileSync(join(web, 'game.js'), 'utf8');

// 字体栈去掉 FZLT（瘦身版不含字体文件）
css = css
  .replace(/@font-face\s*\{[^}]*\}/g, '')
  .replace(/FZLTRegular,\s*FZLTHeavy,\s*/g, '')
  .replace(/FZLTBlackProGlobal[A-Za-z]*,\s*/g, '');
js = js.replace(/FZLTRegular,\s*FZLTHeavy,\s*/g, '');
html = html.replace(/FZLTRegular,\s*FZLTHeavy,\s*/g, '');

const mimeOf = (p) =>
  p.endsWith('.ttf') ? 'font/ttf'
  : p.endsWith('.woff2') ? 'font/woff2'
  : p.endsWith('.woff') ? 'font/woff'
  : p.endsWith('.png') ? 'image/png'
  : p.endsWith('.webp') ? 'image/webp'
  : 'image/jpeg';

css = css.replace(/url\("\.\/(assets\/[^"]+?)(\?v=\d+)?"\)/g, (m, rel) => {
  const p = join(web, rel);
  if (!existsSync(p)) return m;
  return `url("data:${mimeOf(p)};base64,${readFileSync(p).toString('base64')}")`;
});
js = js.replace(/(['"])(assets\/[^'"]+?\.(?:png|jpe?g|webp))\1/g, (m, q, rel) => {
  const p = join(web, rel);
  return existsSync(p) ? `${q}data:${mimeOf(p)};base64,${readFileSync(p).toString('base64')}${q}` : m;
});

// 用函数作为替换器，避免 JS 源码中的 $1/$& 等序列被 replace 引擎解释（见 build.mjs 的教训）
html = html
  .replace(/<link rel="stylesheet" href="style\.css(\?v=\d+)?" \/>/, () => `<style>\n${css}\n</style>`)
  .replace(
    /<script src="game\.js(\?v=\d+)?"><\/script>/,
    () => `<script>\n${js.replace(/<\/script/gi, '<\\/script')}\n</script>`
  )
  .replace(/src="(assets\/[^"]+)"/g, (m, rel) => {
    const p = join(web, rel);
    if (!existsSync(p)) return m;
    const mime = rel.endsWith('.png') ? 'image/png' : 'image/jpeg';
    return `src="data:${mime};base64,${readFileSync(p).toString('base64')}"`;
  });

const out = join(root, '幸运刮刮乐-瘦身版.html');
writeFileSync(out, html, 'utf8');
console.log('built:', out, (html.length / 1024 / 1024).toFixed(1) + 'MB');
