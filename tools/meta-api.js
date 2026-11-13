// Meta（Threads・Instagram）API を呼ぶための共通部品。
// - エラーを「保留すべきもの（API拒否・鍵・権限）」「やり直してよいもの（通信・一時障害・回数制限）」「内容の問題」に分ける
// - HTTP ステータス・エラーコード・サブコード・fbtrace_id を必ず残す（鍵の値は残さない）
// - 一時的なエラーは回数を限ってやり直す（安全な呼び出しだけ）
// verite-note-bot/tools/meta-api.js と同じ内容に保つこと（どちらかを直したら両方を直す）。

class MetaError extends Error {
  constructor(message, info = {}) {
    super(message);
    Object.assign(this, info);
    this.cls = info.cls || classify(info);
  }
}

// 分類: blocked（Metaがアプリ・アカウントのAPI利用を拒否）/ auth（鍵が無効・期限切れ）/ permission（権限不足）
//       rate（回数制限）/ transient（通信・一時障害）/ content（内容・パラメータの問題）/ unknown
function classify({ httpStatus, code, subcode, message = '', network } = {}) {
  const m = String(message || '');
  if (network) return 'transient';
  if (subcode === 5258005 || /API access blocked/i.test(m) || code === 368) return 'blocked';
  if (code === 190 || code === 102 || [458, 459, 460, 463, 464, 467, 492].includes(subcode)) return 'auth';
  if ([4, 17, 32, 613].includes(code) || (code >= 80001 && code <= 80014)) return 'rate';
  if (code === 10 || (code >= 200 && code <= 299)) return 'permission';
  if ([1, 2].includes(code) || (httpStatus >= 500 && httpStatus <= 599) || httpStatus === 429) return 'transient';
  if (code === 100 || code === 9004 || code === 9007 || code === 24 || code === 36003) return 'content';
  return 'unknown';
}
const HOLD = new Set(['blocked', 'auth', 'permission']);
const RETRY = new Set(['transient', 'rate']);

const LABEL = {
  blocked: 'MetaがこのアプリのAPI利用を止めています（API access blocked）',
  auth: '鍵（アクセストークン）が無効か期限切れです',
  permission: 'アプリに必要な権限がありません',
  rate: '投稿回数の上限に当たりました（時間をおいてやり直します）',
  transient: '通信・Meta側の一時的な障害です（時間をおいてやり直します）',
  content: '投稿の内容・形式がMetaに受け付けられませんでした',
  unknown: '原因不明のエラーです'
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

function client({ base, token, service, retries = 3, baseMs = Number(process.env.META_RETRY_BASE_MS || 2000), timeoutMs = Number(process.env.META_TIMEOUT_MS || 30000) }) {
  let calls = 0;
  async function once(method, path, params = {}) {
    calls++;
    const body = new URLSearchParams({ ...params, access_token: token });
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    let res;
    try {
      res = method === 'GET'
        ? await fetch(`${base}${path}?${body}`, { signal: ctl.signal })
        : await fetch(base + path, { method: 'POST', body, signal: ctl.signal });
    } catch (e) {
      throw new MetaError(`${service}に接続できませんでした（${e.name === 'AbortError' ? '時間切れ' : e.cause?.code || e.message}）`, { network: true, httpStatus: 0, path, method });
    } finally { clearTimeout(t); }
    const text = await res.text();
    let data = {};
    try { data = JSON.parse(text); } catch { /* 本文がJSONでない */ }
    if (!res.ok || data.error) {
      const e = data.error || {};
      const info = { httpStatus: res.status, code: e.code, subcode: e.error_subcode, type: e.type, fbtrace: e.fbtrace_id, path, method, message: e.error_user_msg || e.message || `HTTP ${res.status}` };
      throw new MetaError(`${service} APIエラー: ${info.message}`, info);
    }
    return data;
  }
  // safe=true の呼び出し（読み取り・下書きの作成）だけ、一時的なエラーをやり直す
  async function call(method, path, params = {}, { safe = method === 'GET' } = {}) {
    let last;
    for (let i = 0; i < (safe ? retries : 1); i++) {
      try { return await once(method, path, params); }
      catch (e) {
        last = e; e.attempts = i + 1;
        if (!safe || !RETRY.has(e.cls) || i === retries - 1) throw e;
        await sleep(baseMs * (i + 1));
      }
    }
    throw last;
  }
  return { call, once, get calls() { return calls; } };
}

// 結果ファイルに残すエラー情報（鍵の値は含まない）
function errorFields(e) {
  return {
    error: e.message,
    errorClass: e.cls || 'unknown',
    errorLabel: LABEL[e.cls || 'unknown'],
    httpStatus: e.httpStatus ?? null,
    code: e.code ?? null,
    subcode: e.subcode ?? null,
    fbtrace: e.fbtrace ?? null,
    phase: e.phase || null,
    hold: HOLD.has(e.cls),
    retryable: RETRY.has(e.cls)
  };
}

const norm = s => String(s || '').replace(/\s+/g, ' ').trim();

module.exports = { MetaError, classify, client, errorFields, HOLD, RETRY, LABEL, norm, sleep };
