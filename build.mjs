/**
 * 打包脚本：web/（源码） -> 幸运刮刮乐.html（单文件产物）
 * - 内联 style.css 与 game.js
 * - 把背景图 / 图标内联为 base64，保证单文件可独立打开
 * - 字体不内联（体积过大），单文件版会改为同目录相对路径引用
 * 用法：node build.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const web = join(root, 'web');

let html = readFileSync(join(web, 'index.html'), 'utf8');
let css = readFileSync(join(web, 'style.css'), 'utf8');
let js = readFileSync(join(web, 'game.js'), 'utf8');

// CSS 中的本地资源（./assets/...）统一内联为 data URI，保证单文件可独立打开
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
  // 字体内联会让单文件膨胀到 20MB+，跳过：改用同目录 assets 相对路径
  if (/\.(ttf|woff2?|otf)$/i.test(p)) return `url("./${rel}")`;
  return `url("data:${mimeOf(p)};base64,${readFileSync(p).toString('base64')}")`;
});
js = js.replace(/(['"])(assets\/[^'"]+?\.(?:png|jpe?g|webp))\1/g, (m, q, rel) => {
  const p = join(web, rel);
  return existsSync(p) ? `${q}data:${mimeOf(p)};base64,${readFileSync(p).toString('base64')}${q}` : m;
});

// 注意：内嵌时必须用"函数"作为替换器。若用字符串替换，
// JS/CSS 源码里的 $1、$& 等 $ 序列会被 replace 引擎当作捕获组引用而破坏代码
// （此前 index.html 写成 game.js?v=133 时，game.js 里的 $1 就被替换成了 "?v=133"，导致全部数字变乱码）。
html = html
  .replace(/<link rel="stylesheet" href="style\.css(\?v=\d+)?" \/>/, () => `<style>\n${css}\n</style>`)
  .replace(
    /<script src="game\.js(\?v=\d+)?"><\/script>/,
    () => `<script>\n${js.replace(/<\/script/gi, '<\\/script')}\n</script>`
  )
  // 内联 HTML 中的本地图片 src（assets/...）为 base64，保证单文件可独立打开
  .replace(/src="(assets\/[^"]+)"/g, (m, rel) => {
    const p = join(web, rel);
    if (!existsSync(p)) return m;
    const mime = rel.endsWith('.png') ? 'image/png' : 'image/jpeg';
    return `src="data:${mime};base64,${readFileSync(p).toString('base64')}"`;
  });

const out = join(root, '幸运刮刮乐.html');
writeFileSync(out, html, 'utf8');
console.log('built:', out, (html.length / 1024).toFixed(1) + 'KB');
