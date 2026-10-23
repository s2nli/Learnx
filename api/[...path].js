// Unified proxy: /api/* AND every non-local path (/watch, /_next/*, media, etc.)
// goes through here so Origin/Referer are always spoofed, Range works, and
// responses are STREAMED (video/segments never buffered).
const { Readable } = require('stream');

const ORIGIN = (process.env.ORIGIN || 'https://www.learnxpw.site').replace(/\/$/, '');
const HOST = new URL(ORIGIN).host;

const PASS_REQ = ['content-type', 'authorization', 'cookie', 'accept', 'accept-language', 'range', 'x-requested-with', 'rsc', 'next-router-state-tree', 'next-url'];
const SKIP_RES = ['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'set-cookie',
  'access-control-allow-origin', 'access-control-allow-credentials', 'content-security-policy',
  'x-frame-options', 'strict-transport-security', 'content-disposition'];
const TEXT_RE = /(text\/html|json|mpegurl|dash\+xml)/i;

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

// vercel.json sends non-api paths to /api/_p?p=/original/path ; rebuild the real URL
function realPath(reqUrl) {
  const u = new URL(reqUrl, 'http://x');
  if (u.pathname === '/api/_p') {
    const p = u.searchParams.get('p') || '/';
    u.searchParams.delete('p');
    const qs = u.searchParams.toString();
    return p + (qs ? '?' + qs : '');
  }
  return u.pathname + u.search;
}

module.exports = async (req, res) => {
  try {
    const path = realPath(req.url);
    const target = ORIGIN + path;
    const headers = {
      'user-agent': req.headers['user-agent'] || 'Mozilla/5.0',
      origin: ORIGIN,
      referer: ORIGIN + '/',
    };
    for (const h of PASS_REQ) if (req.headers[h]) headers[h] = req.headers[h];

    const init = { method: req.method, headers, redirect: 'manual' };
    if (!['GET', 'HEAD'].includes(req.method)) init.body = await readBody(req);

    const r = await fetch(target, init);

    // redirects: keep user on our domain
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      const loc = r.headers.get('location').replace(ORIGIN, '');
      res.statusCode = r.status;
      res.setHeader('location', loc);
      return res.end();
    }

    res.statusCode = r.status;
    r.headers.forEach((v, k) => { if (!SKIP_RES.includes(k.toLowerCase())) res.setHeader(k, v); });
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('accept-ranges', r.headers.get('accept-ranges') || 'bytes');

    const cookies = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [];
    if (cookies.length) {
      res.setHeader('set-cookie', cookies.map(c => c
        .replace(/;\s*Domain=[^;]+/i, '')
        .replace(/;\s*SameSite=None/i, '; SameSite=Lax')
        .replace(/;\s*Partitioned/i, '')));
    }

    const ct = r.headers.get('content-type') || '';
    if (/^\/api\/AllBatches/.test(path) && r.ok && req.method === 'GET') {
      res.setHeader('cache-control', 's-maxage=60, stale-while-revalidate=300');
    }

    if (req.method === 'HEAD' || !r.body) return res.end();

    // text-like: rewrite absolute origin URLs so the browser stays on our domain
    if (TEXT_RE.test(ct)) {
      let t = await r.text();
      t = t.split(ORIGIN).join('')
           .split('https:\\/\\/' + HOST).join('')
           .split('//' + HOST).join('');
      return res.end(t);
    }

    // everything else (video, segments, fonts, js): stream through
    Readable.fromWeb(r.body).on('error', () => res.end()).pipe(res);
  } catch (e) {
    res.statusCode = 502;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'proxy_failed', message: String((e && e.message) || e) }));
  }
};
