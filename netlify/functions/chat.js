const https = require('https');

const RATE_LIMIT = 10;
const WINDOW_MS  = 60_000;

const buckets = new Map();

function checkRate(ip) {
  const now = Date.now();
  const min  = Math.floor(now / WINDOW_MS);
  const key  = `${ip}:${min}`;
  for (const k of buckets.keys()) {
    if (!k.endsWith(`:${min}`)) buckets.delete(k);
  }
  const count = (buckets.get(key) || 0) + 1;
  buckets.set(key, count);
  return count <= RATE_LIMIT;
}

function httpsPost(url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      { hostname: u.hostname, path: u.pathname, method: 'POST',
        headers: { ...headers, 'content-length': Buffer.byteLength(body) } },
      res => {
        let raw = '';
        res.on('data', c => raw += c);
        res.on('end', () => resolve({ status: res.statusCode, body: raw }));
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 404, headers: CORS, body: 'Not found' };
  }

  const ip = event.headers['x-forwarded-for']?.split(',')[0].trim()
          || event.headers['client-ip']
          || 'unknown';

  if (!checkRate(ip)) {
    return {
      statusCode: 429,
      headers: { ...CORS, 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'Rate limit exceeded — 10 requests per minute.' }),
    };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: CORS, body: 'Bad JSON' }; }

  const { system, messages, max_tokens = 1024, model = 'claude-haiku-4-5-20251001' } = body;
  const payload = JSON.stringify({ model, max_tokens, system, messages });

  const upstream = await httpsPost(
    'https://api.anthropic.com/v1/messages',
    { 'x-api-key': process.env.ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json' },
    payload
  );

  return {
    statusCode: upstream.status,
    headers: { ...CORS, 'content-type': 'application/json' },
    body: upstream.body,
  };
};
