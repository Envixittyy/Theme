#!/usr/bin/env node
/**
 * Mapua School OS — local AI bridge (reference implementation).
 *
 * Runs on the student's own computer. It is the only component that ever talks
 * to the local model: the cloud server never sees the endpoint, and the browser
 * reaches the bridge over loopback.
 *
 *   node bridge/school-os-bridge.mjs --pair ABCD2345
 *   node bridge/school-os-bridge.mjs                # after pairing
 *
 * Environment:
 *   SCHOOL_OS_URL      the app origin, e.g. https://schoolos.example.com
 *   OLLAMA_URL         default http://127.0.0.1:11434
 *   OPENAI_BASE_URL    alternative OpenAI-compatible endpoint
 *   OPENAI_API_KEY     only if that endpoint needs one (stays on this machine)
 *   BRIDGE_MODEL       default llama3.1:8b
 *   BRIDGE_PORT        default 4319
 *
 * No dependencies: it is meant to be readable end to end before someone runs it
 * on their own machine.
 */

import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';

const VERSION = '1.0.0';
const PROTOCOL = 1;
const PORT = Number(process.env.BRIDGE_PORT ?? 4319);
const APP_URL = (process.env.SCHOOL_OS_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const OLLAMA_URL = (process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
const OPENAI_BASE = process.env.OPENAI_BASE_URL?.replace(/\/$/, '') ?? null;
const MODEL = process.env.BRIDGE_MODEL ?? 'llama3.1:8b';
const SCOPES = ['task.extract', 'summarize', 'plan', 'search'];
const CONFIG_PATH = join(homedir(), '.config', 'school-os-bridge', 'config.json');

/* ------------------------------- config io ------------------------------- */

async function loadConfig() {
  try {
    return JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
  } catch {
    return null;
  }
}

async function saveConfig(config) {
  await mkdir(dirname(CONFIG_PATH), { recursive: true });
  // 0600: the device token is a credential for this user's account scope.
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
}

/* -------------------------------- pairing -------------------------------- */

async function pair(code) {
  const provider = OPENAI_BASE ? 'openai-compatible' : 'ollama';
  const response = await fetch(`${APP_URL}/api/ai/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      code,
      bridgeVersion: VERSION,
      provider,
      model: MODEL,
      // A hint only — host and port, never a token or a path.
      endpointHint: new URL(OPENAI_BASE ?? OLLAMA_URL).host,
      scopes: SCOPES,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`Pairing failed (${response.status}): ${body}`);
    process.exit(1);
  }

  const result = await response.json();
  const localToken = randomBytes(24).toString('base64url');
  await saveConfig({
    deviceToken: result.deviceToken,
    deviceId: result.deviceId,
    localToken,
    appUrl: APP_URL,
    model: MODEL,
    provider,
    scopes: result.scopes,
  });

  console.log(`\nPaired with ${APP_URL} as ${result.userLabel}.`);
  console.log(`Scopes: ${result.scopes.join(', ')}`);
  console.log(`\nNow start the bridge:\n  node bridge/school-os-bridge.mjs\n`);
  console.log(`Then, in School OS → Settings → Local AI, enter this local token once:\n  ${localToken}\n`);
}

/* ------------------------------- model calls ------------------------------ */

async function generate({ prompt, system, maxTokens = 800, temperature = 0.2 }) {
  const started = Date.now();

  if (OPENAI_BASE) {
    const response = await fetch(`${OPENAI_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(process.env.OPENAI_API_KEY ? { authorization: `Bearer ${process.env.OPENAI_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        model: MODEL,
        temperature,
        max_tokens: maxTokens,
        messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }],
      }),
    });
    if (!response.ok) throw new Error(`model endpoint responded ${response.status}`);
    const payload = await response.json();
    return { text: payload.choices?.[0]?.message?.content ?? '', model: MODEL, elapsedMs: Date.now() - started };
  }

  const response = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      system,
      stream: false,
      options: { temperature, num_predict: maxTokens },
    }),
  });
  if (!response.ok) throw new Error(`Ollama responded ${response.status}`);
  const payload = await response.json();
  return { text: payload.response ?? '', model: MODEL, elapsedMs: Date.now() - started };
}

async function probe() {
  try {
    const url = OPENAI_BASE ? `${OPENAI_BASE}/models` : `${OLLAMA_URL}/api/tags`;
    const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
    return response.ok;
  } catch {
    return false;
  }
}

/* --------------------------------- server -------------------------------- */

function constantTimeEquals(a, b) {
  const ab = Buffer.from(a ?? '');
  const bb = Buffer.from(b ?? '');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

async function serve(config) {
  const server = createServer(async (req, res) => {
    // Only the paired app origin may drive this bridge. Without this check any
    // web page the student visits could reach 127.0.0.1 and use their model.
    const origin = req.headers.origin;
    const allowed = origin === config.appUrl || origin === undefined;
    const cors = {
      'access-control-allow-origin': config.appUrl,
      'access-control-allow-headers': 'content-type, authorization',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-max-age': '600',
      vary: 'Origin',
    };

    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors).end();
      return;
    }
    if (!allowed) {
      res.writeHead(403, { ...cors, 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'origin not allowed' }));
      return;
    }

    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const auth = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');

    if (url.pathname === '/status' && req.method === 'GET') {
      const online = await probe();
      res.writeHead(200, { ...cors, 'content-type': 'application/json' });
      res.end(
        JSON.stringify(
          online
            ? {
                state: 'connected',
                protocol: PROTOCOL,
                bridgeVersion: VERSION,
                model: config.model,
                provider: config.provider,
                scopes: config.scopes,
                endpointHint: new URL(OPENAI_BASE ?? OLLAMA_URL).host,
              }
            : { state: 'offline', reason: `no model endpoint at ${new URL(OPENAI_BASE ?? OLLAMA_URL).host}` },
        ),
      );
      return;
    }

    if (url.pathname === '/generate' && req.method === 'POST') {
      if (!constantTimeEquals(auth, config.localToken)) {
        res.writeHead(401, { ...cors, 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad local token' }));
        return;
      }
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 200_000) {
          res.writeHead(413, cors).end();
          return;
        }
      }
      try {
        const request = JSON.parse(body);
        if (!config.scopes.includes(request.scope)) {
          res.writeHead(403, { ...cors, 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: `scope ${request.scope} was not granted at pairing` }));
          return;
        }
        console.log(`[${new Date().toISOString()}] ${request.scope} · ${request.prompt.length} chars`);
        const result = await generate(request);
        res.writeHead(200, { ...cors, 'content-type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(502, { ...cors, 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: String(err instanceof Error ? err.message : err) }));
      }
      return;
    }

    res.writeHead(404, cors).end();
  });

  // Loopback only. Binding to 0.0.0.0 would expose the model to the network.
  server.listen(PORT, '127.0.0.1', async () => {
    const online = await probe();
    console.log(`School OS bridge ${VERSION} on http://127.0.0.1:${PORT}`);
    console.log(`  app:      ${config.appUrl}`);
    console.log(`  provider: ${config.provider} (${config.model})`);
    console.log(`  model:    ${online ? 'reachable' : 'NOT reachable — the app will show AI as offline'}`);
    console.log(`  scopes:   ${config.scopes.join(', ')}`);
  });
}

/* ---------------------------------- main --------------------------------- */

const pairIndex = process.argv.indexOf('--pair');
if (pairIndex >= 0) {
  const code = process.argv[pairIndex + 1];
  if (!code) {
    console.error('Usage: node bridge/school-os-bridge.mjs --pair <CODE>');
    process.exit(1);
  }
  await pair(code);
} else {
  const config = await loadConfig();
  if (!config) {
    console.error('Not paired yet. Get a code from School OS → Settings → Local AI, then run:');
    console.error('  node bridge/school-os-bridge.mjs --pair <CODE>');
    process.exit(1);
  }
  await serve(config);
}
