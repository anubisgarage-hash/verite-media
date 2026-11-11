// 投稿キュー（queue/<item>.json）の画像指定から、Instagram用の縦長画像（1080x1350 JPEG）を作る。
// 使い方: node tools/render.js queue/<item>.json ig/<item>.jpg
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const [, , queueFile, out] = process.argv;
  const q = JSON.parse(fs.readFileSync(queueFile, 'utf8'));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(`<html><head>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Shippori+Mincho+B1:wght@600;800&family=Zen+Kaku+Gothic+New:wght@400;500;700&display=swap">
    </head><body></body></html>`, { waitUntil: 'networkidle' });
  await page.addScriptTag({ path: path.join(__dirname, 'insta-canvas.js') });
  await page.evaluate(async () => {
    for (const f of ['800 92px "Shippori Mincho B1"', '700 38px "Zen Kaku Gothic New"', '500 42px "Zen Kaku Gothic New"']) await document.fonts.load(f);
  }).catch(() => console.log('（フォントの読み込みに失敗。代わりのフォントで描きます）'));
  const dataUrl = await page.evaluate(({ image, brand }) => window.drawInsta(image, brand).toDataURL('image/jpeg', 0.92),
    { image: q.image, brand: { name: q.brandName, palette: q.palette } });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(`画像を作成: ${out}`);
  await browser.close();
})();
