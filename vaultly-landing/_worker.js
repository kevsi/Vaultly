const REPO = "kevsi/Vaultly";
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_MAX = 5;
const recentSubmissions = new Map();

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function clientIp(request) {
  const forwardedFor = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For");
  return forwardedFor ? forwardedFor.split(",")[0].trim() : "unknown";
}

function allowRequest(ip) {
  const now = Date.now();
  const last = recentSubmissions.get(ip);

  if (last && now - last.startedAt < RATE_WINDOW_MS) {
    if (last.count >= RATE_MAX) {
      return false;
    }
    last.count += 1;
    return true;
  }

  recentSubmissions.set(ip, { startedAt: now, count: 1 });
  return true;
}

function makeTitle(text) {
  const firstLine = text.split(/\r?\n/, 1)[0].replace(/\s+/g, " ").trim();
  const base = firstLine.slice(0, 150) || "Feature request from Vaultly landing";
  return `Feature request: ${base}`;
}

function sanitizeText(value, max = 5000) {
  return value.replace(/\u0000/g, "").slice(0, max);
}

function makeBody(text, request) {
  return [
    "### Idea",
    "",
    text,
    "",
    "### Metadata",
    "",
    "- Page: Vaultly landing ideas form",
    `- Date: ${new Date().toISOString()}`,
    `- User agent: ${sanitizeText(request.headers.get("User-Agent") || "", 500)}`,
  ].join("\n");
}

async function handleIdeas(request, env) {
  if (!env.GITHUB_ISSUE_TOKEN) {
    return json({ error: "The idea endpoint is not configured yet." }, 500);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  const honeypot = typeof payload.company === "string" ? payload.company.trim() : "";
  const idea = typeof payload.idea === "string" ? sanitizeText(payload.idea) : "";

  if (honeypot || idea.length < 10 || idea.length > 5000) {
    return json({ error: "Please write a real idea between 10 and 5000 characters." }, 400);
  }

  if (!allowRequest(clientIp(request))) {
    return json({ error: "Too many ideas sent. Try again later." }, 429);
  }

  const response = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GITHUB_ISSUE_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "vaultly-landing-ideas",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: makeTitle(idea),
      body: makeBody(idea, request),
      labels: ["enhancement"],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error(`GitHub issue creation failed: ${response.status} ${detail}`);
    return json({ error: "The idea could not be sent right now." }, 502);
  }

  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/ideas") {
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            Allow: "POST",
          },
        });
      }

      if (request.method !== "POST") {
        return json({ error: "Method not allowed." }, 405);
      }

      return handleIdeas(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};
