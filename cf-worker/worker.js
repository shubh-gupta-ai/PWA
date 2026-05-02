const RATE_LIMIT = 10;       // requests
const WINDOW_MS  = 60_000;  // per minute

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/chat') {
      return new Response('Not found', { status: 404 });
    }

    // Per-IP rate limiting using KV minute-buckets
    const ip  = request.headers.get('CF-Connecting-IP') || 'unknown';
    const min = Math.floor(Date.now() / WINDOW_MS);
    const key = `rl:${ip}:${min}`;
    const count = parseInt(await env.RATE.get(key) || '0');
    if (count >= RATE_LIMIT) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded — 10 requests per minute.' }), {
        status: 429,
        headers: { ...CORS, 'content-type': 'application/json' },
      });
    }
    await env.RATE.put(key, String(count + 1), { expirationTtl: 120 });

    let body;
    try { body = await request.json(); } catch {
      return new Response('Bad JSON', { status: 400 });
    }

    const { system, messages, max_tokens = 1024, model = 'claude-haiku-4-5-20251001' } = body;

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model, max_tokens, system, messages }),
    });

    const data = await upstream.json();
    return new Response(JSON.stringify(data), {
      status: upstream.status,
      headers: { ...CORS, 'content-type': 'application/json' },
    });
  },
};
