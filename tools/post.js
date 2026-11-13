// Instagram に画像1枚とキャプションを投稿する。キューに slides（2枚以上）があるときはカルーセル（めくって読む複数枚）で投稿する。
// 使い方: node tools/post.js queue/<item>.json <画像の公開URL> results/<item>.json
//   カルーセルのときは <画像の公開URL> の「.jpg」を「-1.jpg」〜「-N.jpg」に置き換えたURLを使う（render.js が作るファイル名と同じ）。
// 環境変数 INSTAGRAM_TOKEN が必要。TEST=1 のときは投稿せず、接続と文字数だけ確認する。
//
// 守っていること
// - 投稿の前に、アカウントの最近の投稿に同じキャプションが無いか確かめる（あれば投稿せず「投稿済み」として記録＝二重投稿の防止）
// - 前回の結果が「公開されたか不明（unknown）」のときは、最近の投稿を確かめられない限り投稿しない
// - 一時的なエラーは、読み取りと下書き（コンテナ）作成だけ回数を限ってやり直す。公開の呼び出しは、結果が不明なら投稿一覧で確かめてから1回だけやり直す
// - 失敗の結果には HTTP ステータス・エラーコード・サブコード・分類を残す。鍵の値は残さない
const fs = require('fs');
const path = require('path');
const { client, errorFields, MetaError, norm, sleep } = require('./meta-api');

const API = process.env.IG_API_BASE || 'https://graph.facebook.com/v24.0';
const IG = process.env.IG_USER_ID || '17841427416880681';
const T = process.env.INSTAGRAM_TOKEN;
const TEST = process.env.TEST === '1';
const POLL_MS = Number(process.env.IG_POLL_MS ?? 5000);
const DEDUP_DAYS = 14;
const [, , queueFile, imageUrl, outFile] = process.argv;

(async () => {
  const q = JSON.parse(fs.readFileSync(queueFile, 'utf8'));
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(outFile, 'utf8')); } catch { /* 初回 */ }
  const r = { ok: false, sig: q.sig, postId: q.postId, at: new Date().toISOString(), imageUrl };
  const api = client({ base: API, token: T, service: 'Instagram' });
  const caption = String(q.caption || '').trim();
  const findSame = async () => {
    const list = await api.call('GET', `/${IG}/media`, { fields: 'id,caption,timestamp,permalink', limit: '25' });
    const since = Date.now() - DEDUP_DAYS * 864e5;
    return (list.data || []).find(p => norm(p.caption) === norm(caption) && new Date(p.timestamp).getTime() > since) || null;
  };
  try {
    if (!T) throw new MetaError('INSTAGRAM_TOKEN が設定されていません', { cls: 'auth' });
    if (!caption) throw new MetaError('キャプションが空です', { cls: 'content' });
    if ([...caption].length > 2200) throw new MetaError(`キャプションが長すぎます（${[...caption].length}字。上限2,200字）`, { cls: 'content' });
    if ((caption.match(/#/g) || []).length > 30) throw new MetaError('ハッシュタグは30個までです', { cls: 'content' });
    const n = Array.isArray(q.slides) && q.slides.length >= 2 ? Math.min(q.slides.length, 10) : 0;
    const urls = n ? Array.from({ length: n }, (_, i) => imageUrl.replace(/\.jpg$/, `-${i + 1}.jpg`)) : [imageUrl];
    if (n) r.imageUrls = urls;
    const me = await api.call('GET', `/${IG}`, { fields: 'username' });
    r.username = me.username;
    const waitReady = async (id) => { // 画像の取り込みが終わるまで待つ
      for (let i = 0; i < 20; i++) {
        const st = await api.call('GET', `/${id}`, { fields: 'status_code' });
        if (st.status_code === 'FINISHED') return;
        if (st.status_code === 'ERROR') throw new MetaError('Instagramが画像を読み込めませんでした', { cls: 'content' });
        await sleep(POLL_MS);
      }
    };
    if (TEST) {
      r.ok = true; r.test = true;
      console.log(`テスト：@${me.username} に投稿できる状態です（${[...caption].length}字・画像${n ? n + '枚 ' : ' '}${urls.join(' ')}）。投稿はしていません`);
    } else {
      let same = null;
      try { same = await findSame(); }
      catch (e) {
        if (prev?.unknown || e.cls === 'blocked' || e.cls === 'auth') { e.phase = 'verify'; throw e; }
        console.log('最近の投稿を確認できませんでした（初回の投稿なので続けます）: ' + e.message);
      }
      if (same) {
        Object.assign(r, { ok: true, deduped: true, mediaId: same.id, url: same.permalink || '' });
        console.log(`同じキャプションがすでに投稿されていました（二重投稿を防止）: ${r.url || same.id}`);
      } else {
        let c;
        if (n) {
          const children = [];
          for (const u of urls) { const ch = await api.call('POST', `/${IG}/media`, { image_url: u, is_carousel_item: 'true' }, { safe: true }); await waitReady(ch.id); children.push(ch.id); }
          c = await api.call('POST', `/${IG}/media`, { media_type: 'CAROUSEL', children: children.join(','), caption }, { safe: true });
        } else {
          c = await api.call('POST', `/${IG}/media`, { image_url: imageUrl, caption }, { safe: true });
        }
        await waitReady(c.id);
        let p, permalink;
        try { p = await api.once('POST', `/${IG}/media_publish`, { creation_id: c.id }); }
        catch (e) {
          if (!(e.network || e.cls === 'transient')) { e.phase = 'publish'; throw e; }
          console.log('公開の結果が分かりません。最近の投稿を確認します: ' + e.message);
          let found;
          try { found = await findSame(); }
          catch (e2) { e2.phase = 'verify'; e2.unknown = true; throw Object.assign(e2, { message: '公開されたか確認できませんでした（' + e2.message + '）' }); }
          if (found) { p = { id: found.id }; permalink = found.permalink; r.deduped = true; }
          else { p = await api.once('POST', `/${IG}/media_publish`, { creation_id: c.id }); r.retried = true; }
        }
        const info = permalink ? { permalink } : await api.call('GET', `/${p.id}`, { fields: 'permalink' }).catch(() => ({}));
        Object.assign(r, { ok: true, mediaId: p.id, url: info.permalink || '' });
        console.log('投稿しました: ' + (r.url || p.id));
      }
    }
  } catch (e) {
    Object.assign(r, errorFields(e));
    if (e.unknown) r.unknown = true;
    console.log(`失敗: ${e.message}（分類 ${r.errorClass} / HTTP ${r.httpStatus ?? '-'} / code ${r.code ?? '-'} / subcode ${r.subcode ?? '-'}）`);
    process.exitCode = 1;
  }
  r.apiCalls = api.calls;
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(r, null, 2));
})();
