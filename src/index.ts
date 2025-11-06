// 修改这个列表，更新为自己的 domain list
const ALLOWED = new Set([
  'eo-oss.cqzrs.top',
  'blog.cqzrs.top'
]);
const CORP    = 'same-site';     // same-origin 也行
const BUCKET  = 'MEDIA';         // 对应 wrangler 的 r2_buckets 绑定名

export default {
  async fetch(request: Request, env: Env) {

    /* 0. 读取 Referer 并做白名单校验 */
    const refererHeader = request.headers.get('Referer') || '';
    const refererHost   = refererHeader ? new URL(refererHeader).hostname : '';
    const refererOrigin = refererHeader ? new URL(refererHeader).origin   : '';

    // 新增：允许 Obsidian / 无 Referer 请求
    const userAgent = request.headers.get('User-Agent') || '';
    const isObsidian = userAgent.includes('Obsidian');
    const noReferer  = !refererHeader;

    if (!ALLOWED.has(refererHost) && !isObsidian && !noReferer) {
      return new Response('blocked', { status: 403 });
    }

    /* 0-bis. 预检请求 */
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin':  refererOrigin || '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': 'Range',
          'Access-Control-Max-Age':       '86400'
        }
      });
    }

    /* 1. 解析对象 Key */
    const url = new URL(request.url);
    const key = decodeURIComponent(url.pathname.slice(1));
    if (!key) return new Response('bad request', { status: 400 });

    /* 2. 处理 Range（播放器基本都会带） */
    const range = request.headers.get('Range');
    let opts: R2GetOptions | undefined;
    if (range) {
      const m = /bytes=(\d+)-(\d*)/.exec(range);
      if (m) {
        const [ , s, e ] = m;
        opts = { range: { offset: +s, length: e ? (+e - +s + 1) : undefined }};
      }
    }

    /* 3. 读取 R2 */
    const obj = await env[BUCKET].get(key, opts);
    if (!obj) return new Response('404', { status: 404 });

    /* 4. 生成响应 + CORS/CORP 头 */
    const h = new Headers(obj.httpMetadata);
    h.set('Access-Control-Allow-Origin',  refererOrigin || '*');
    h.set('Vary',                         'Origin');
    h.set('Access-Control-Expose-Headers','Content-Length, Content-Range, Accept-Ranges');

    if (range && opts?.range) {
      const size   = obj.size;
      const start  = opts.range.offset;
      const endPos = opts.range.length ? start + opts.range.length - 1 : size - 1;
      h.set('Accept-Ranges', 'bytes');
      h.set('Content-Range', `bytes ${start}-${endPos}/${size}`);
      return new Response(obj.body, { status: 206, headers: h });
    }

    return new Response(obj.body, { headers: h });
  }
}
