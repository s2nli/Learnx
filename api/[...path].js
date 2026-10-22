// Vercel serverless proxy: /api/* -> original backend
// Set ORIGIN in Vercel env vars to change target.
const ORIGIN = (process.env.ORIGIN || 'https://www.learnxpw.site').replace(/\/$/, '');

const PASS_REQ = ['content-type', 'authorization', 'cookie', 'accept', 'accept-language'];
const SKIP_RES = ['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'set-cookie', 'access-control-allow-origin', 'access-control-allow-credentials'];

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

module.exports = async (req, res) => {
  try {
    const target = ORIGIN + req.url;
    const headers = {
      'user-agent': req.headers['user-agent'] || 'Mozilla/5.0',
      origin: ORIGIN,
      referer: ORIGIN + '/study/batches',
    };
    for (const h of PASS_REQ) if (req.headers[h]) headers[h] = req.headers[h];

    const init = { method: req.method, headers, redirect: 'follow' };
    if (!['GET', 'HEAD'].includes(req.method)) init.body = await readBody(req);

    const r = await fetch(target, init);

    res.statusCode = r.status;
    r.headers.forEach((v, k) => { if (!SKIP_RES.includes(k.toLowerCase())) res.setHeader(k, v); });

    const cookies = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [];
    if (cookies.length) {
      res.setHeader('set-cookie', cookies.map(c => c.replace(/;\s*Domain=[^;]+/i, '').replace(/;\s*SameSite=None/i, '; SameSite=Lax')));
    }
    if (req.method === 'GET' && r.ok && req.url.startsWith('/api/AllBatches')) {
      res.setHeader('cache-control', 's-maxage=60, stale-while-revalidate=300');
    }
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    res.statusCode = 502;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'proxy_failed', message: String((e && e.message) || e) }));
  }
};
