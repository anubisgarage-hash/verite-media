// 投稿キュー（queue/<item>.json）の画像指定から、Instagram用の縦長画像（1080x1350 JPEG）を作る。
// 使い方: node tools/render.js queue/<item>.json ig/<item>.jpg
// キューに slides（めくって読む複数枚）があるときは ig/<item>-1.jpg 〜 ig/<item>-N.jpg を作る（N は slides の枚数）。
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
  const slides = Array.isArray(q.slides) && q.slides.length >= 2 ? q.slides.slice(0, 10) : null;
  const txt = [q.image?.headline, q.image?.sub, q.brandName, '続きは、プロフィールのリンクから', 'めくって続きを読む →詳しくはキャプションへ0123456789/', ...(slides || []).flatMap(s => [s.headline, s.sub])].join('');
  await page.evaluate(async (txt) => {
    for (const f of ['800 92px "Shippori Mincho B1"', '800 78px "Shippori Mincho B1"', '700 44px "Zen Kaku Gothic New"', '700 38px "Zen Kaku Gothic New"', '500 42px "Zen Kaku Gothic New"', '700 26px "Zen Kaku Gothic New"', '700 28px "Zen Kaku Gothic New"']) await document.fonts.load(f, txt);
  }, txt).catch(() => console.log('（フォントの読み込みに失敗。代わりのフォントで描きます）'));
  const brand = { name: q.brandName, palette: q.palette };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  if (slides) {
    for (let i = 0; i < slides.length; i++) {
      const dataUrl = await page.evaluate(({ slides, i, image, brand }) => window.drawSlide(slides, i, image, brand).toDataURL('image/jpeg', 0.92), { slides, i, image: q.image || null, brand });
      const f = out.replace(/\.jpg$/, `-${i + 1}.jpg`);
      fs.writeFileSync(f, Buffer.from(dataUrl.split(',')[1], 'base64'));
      console.log(`画像を作成: ${f}（${i + 1}/${slides.length}枚目）`);
    }
  } else {
    const dataUrl = await page.evaluate(({ image, brand }) => window.drawInsta(image, brand).toDataURL('image/jpeg', 0.92), { image: q.image, brand });
    fs.writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log(`画像を作成: ${out}`);
  }
  await browser.close();
})();
