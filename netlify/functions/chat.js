const RATE_LIMIT = 10;
const WINDOW_MS  = 60_000;

// In-memory per-IP buckets. Resets when the Lambda instance cold-starts,
// but gives meaningful protection against casual abuse.
const buckets = new Map();

function checkRate(ip) {
  const now = Date.now();
  const min  = Math.floor(now / WINDOW_MS);
  const key  = `${ip}:${min}`;

  // Evict entries from previous minutes to keep memory bounded
  for (const k of buckets.keys()) {
    if (!k.endsWith(`:${min}`)) buckets.delete(k);
  }

  const count = (buckets.get(key) || 0) + 1;
  buckets.set(key, count);
  return count <= RATE_LIMIT;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 404, headers: CORS, body: "Not found" };
  }

  const ip = event.headers["x-forwarded-for"]?.split(",")[0].trim()
          || event.headers["client-ip"]
          || "unknown";

  if (!checkRate(ip)) {
    return {
      statusCode: 429,
      headers: { ...CORS, "content-type": "application/json" },
      body: JSON.stringify({ error: "Rate limit exceeded — 10 requests per minute." }),
    };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: CORS, body: "Bad JSON" }; }

  const { system, messages, max_tokens = 1024, model = "claude-haiku-4-5-20251001" } = body;

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({ model, max_tokens, system, messages }),
  });

  const data = await upstream.json();
  return {
    statusCode: upstream.status,
    headers: { ...CORS, "content-type": "application/json" },
    body: JSON.stringify(data),
  };
};
