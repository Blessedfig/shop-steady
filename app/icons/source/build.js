// Rebuilds every app icon from designs.js.
// Run from the repo root: node app/icons/source/build.js [design]   (default: openSign)
// Needs Playwright with Chromium and ImageMagick (convert). Shrikhand is bundled (SIL Open Font License).
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const { C } = require('./designs.js');
const designs = { ...require('./designs.js').designs, ...require('./designs2.js').designs };
const name = process.argv[2] || 'openSign';
if (!designs[name]) throw new Error('Unknown design: ' + name + '. Pick one of ' + Object.keys(designs).join(', '));
const root = path.resolve(__dirname, '../../..');
const icons = path.join(root, 'app/icons'), res = path.join(root, 'mobile/resources/res');
const font = fs.readFileSync(path.join(__dirname, 'shrikhand.woff2')).toString('base64');
const magick = (...a) => execFileSync('convert', a);

(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  async function render(file, size, safe = false) {
    await p.setViewportSize({ width: size, height: size });
    await p.setContent(`<style>@font-face{font-family:Shrikhand;src:url(data:font/woff2;base64,${font})}
      html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${designs[name](safe)}`);
    await p.evaluate(async () => { await document.fonts.load('100px Shrikhand'); await document.fonts.ready; });
    await p.screenshot({ path: file, clip: { x: 0, y: 0, width: size, height: size } });
  }
  // Web app, website and iPhone (iOS rounds the corners itself, so these stay square and opaque)
  for (const [f, s] of [['icon-1024.png', 1024], ['icon-512.png', 512], ['icon-192.png', 192], ['apple-touch-icon.png', 180], ['favicon-32.png', 32], ['favicon-16.png', 16]])
    await render(path.join(icons, f), s);
  await render(path.join(icons, 'icon-maskable-512.png'), 512, true);

  // Android launcher icons: rounded square and round versions
  for (const [d, s] of [['mdpi', 48], ['hdpi', 72], ['xhdpi', 96], ['xxhdpi', 144], ['xxxhdpi', 192]]) {
    const dir = path.join(res, 'mipmap-' + d), tmp = path.join(dir, 'tmp.png');
    await render(tmp, s * 4, true);
    const big = s * 4, r = Math.round(big * 0.18);
    magick(tmp, '(', '-size', `${big}x${big}`, 'xc:none', '-fill', 'white', '-draw', `roundrectangle 0,0 ${big - 1},${big - 1} ${r},${r}`, ')',
      '-compose', 'DstIn', '-composite', '-resize', `${s}x${s}`, path.join(dir, 'ic_launcher.png'));
    magick(tmp, '(', '-size', `${big}x${big}`, 'xc:none', '-fill', 'white', '-draw', `circle ${big / 2},${big / 2} ${big / 2},0`, ')',
      '-compose', 'DstIn', '-composite', '-resize', `${s}x${s}`, path.join(dir, 'ic_launcher_round.png'));
    fs.unlinkSync(tmp);
  }

  // Android splash screens: the icon, with rounded corners, centered on pine
  for (const d of fs.readdirSync(res).filter(d => d.startsWith('drawable'))) {
    const f = path.join(res, d, 'splash.png');
    const [w, h] = execFileSync('identify', ['-format', '%w %h', f]).toString().split(' ').map(Number);
    const s = Math.round(Math.min(w, h) * 0.42), r = Math.round(s * 0.22), tmp = path.join(res, d, 'tmp.png');
    await render(tmp, s);
    magick(tmp, '(', '-size', `${s}x${s}`, 'xc:none', '-fill', 'white', '-draw', `roundrectangle 0,0 ${s - 1},${s - 1} ${r},${r}`, ')',
      '-compose', 'DstIn', '-composite', tmp);
    magick('-size', `${w}x${h}`, `xc:${C.pine}`, tmp, '-gravity', 'center', '-composite', f);
    fs.unlinkSync(tmp);
  }
  await b.close();
  console.log('Built icons from design "' + name + '".');
})();
