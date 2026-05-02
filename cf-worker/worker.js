/**
 * Cloudflare Worker — Anthropic API proxy for HF Daily Papers PWA
 *
 * Deploy:
 *   npm install -g wrangler
 *   wrangler login
 *   wrangler secret put ANTHROPIC_KEY    # paste your sk-ant-… key
 *   wrangler deploy
 *
 * The worker URL that gets printed becomes WORKER_URL in the PWA.
 * CORS is open so the PWA on any origin can reach it.
 */

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

    let body;
    try {
      body = await request.json();
    } catch {
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
      body: JSON.stringify({ model, max_tokens, system, messages, stream: true }),
    });

    if (!upstream.ok) {
      const err = await upstream.text();
      return new Response(err, { status: upstream.status, headers: CORS });
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        ...CORS,
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
      },
    });
  },
};
