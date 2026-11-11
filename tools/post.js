// Instagram に画像1枚とキャプションを投稿する。
// 使い方: node tools/post.js queue/<item>.json <画像の公開URL> results/<item>.json
// 環境変数 INSTAGRAM_TOKEN が必要。TEST=1 のときは投稿せず、接続と文字数だけ確認する。
const fs = require('fs');
const path = require('path');

const API = 'https://graph.facebook.com/v24.0';
const IG = process.env.IG_USER_ID || '17841427416880681';
const T = process.env.INSTAGRAM_TOKEN;
const TEST = process.env.TEST === '1';
const [, , queueFile, imageUrl, outFile] = process.argv;

async function call(method, p, params = {}) {
  const body = new URLSearchParams({ ...params, access_token: T });
  const res = method === 'GET' ? await fetch(`${API}${p}?${body}`) : await fetch(API + p, { method: 'POST', body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const e = data.error || {};
    throw new Error(e.code === 190 ? 'Instagramの鍵（INSTAGRAM_TOKEN）が無効です。Metaの画面で鍵を作り直してください' : 'Instagram APIエラー: ' + (e.error_user_msg || e.message || `HTTP ${res.status}`));
  }
  return data;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const q = JSON.parse(fs.readFileSync(queueFile, 'utf8'));
  const r = { ok: false, sig: q.sig, postId: q.postId, at: new Date().toISOString(), imageUrl };
  try {
    if (!T) throw new Error('INSTAGRAM_TOKEN が設定されていません');
    const caption = String(q.caption || '').trim();
    if (!caption) throw new Error('キャプションが空です');
    if ([...caption].length > 2200) throw new Error(`キャプションが長すぎます（${[...caption].length}字。上限2,200字）`);
    if ((caption.match(/#/g) || []).length > 30) throw new Error('ハッシュタグは30個までです');
    const me = await call('GET', `/${IG}`, { fields: 'username' });
    if (TEST) {
      r.ok = true; r.test = true; r.username = me.username;
      console.log(`テスト：@${me.username} に投稿できる状態です（${[...caption].length}字・画像 ${imageUrl}）。投稿はしていません`);
    } else {
      const c = await call('POST', `/${IG}/media`, { image_url: imageUrl, caption });
      for (let i = 0; i < 20; i++) { // 画像の取り込みが終わるまで待つ
        const st = await call('GET', `/${c.id}`, { fields: 'status_code' });
        if (st.status_code === 'FINISHED') break;
        if (st.status_code === 'ERROR') throw new Error('Instagramが画像を読み込めませんでした');
        await sleep(5000);
      }
      const p = await call('POST', `/${IG}/media_publish`, { creation_id: c.id });
      const info = await call('GET', `/${p.id}`, { fields: 'permalink' }).catch(() => ({}));
      Object.assign(r, { ok: true, mediaId: p.id, url: info.permalink || '', username: me.username });
      console.log('投稿しました: ' + (r.url || p.id));
    }
  } catch (e) {
    r.error = e.message;
    console.log('失敗: ' + e.message);
    process.exitCode = 1;
  }
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(r, null, 2));
})();
