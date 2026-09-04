import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');

const CONFIG = Object.freeze({
  PORT: Number.parseInt(process.env.PORT || process.env.HERMES_MOBILE_PORT || '8643', 10),
  HOST_MODE: process.env.HERMES_MOBILE_HOST || 'loopback',
  STATIC_TOKEN: process.env.API_SERVER_KEY || process.env.HERMES_MOBILE_TOKEN || '',
  STATIC_BACKEND_URL: process.env.HERMES_MOBILE_BACKEND_URL || '',
  CACHE_TTL_MS: 3000,
  UPSTREAM_TIMEOUT_MS: 360000,
  MAX_BODY_BYTES: 8 * 1024 * 1024
});

const POLISH_SYSTEM_INSTRUCTION = Object.freeze({
  role: 'system',
  content:
    'Jesteś autonomicznym, wysoce precyzyjnym asystentem Hermes AI działającym w środowisku mobilnym. ' +
    'Domyślnym i nadrzędnym językiem komunikacji z użytkownikiem jest język polski. ' +
    'Zawsze komunikuj się po polsku, zachowując naturalną, precyzyjną i techniczną polszczyznę, poprawną fleksję, składnię, ortografię oraz interpunkcję. ' +
    'Rozumiej polecenia potoczne, skrótowe, techniczne i zawierające drobne błędy. ' +
    'Nie przełączaj się na język angielski bez wyraźnej prośby użytkownika. ' +
    'Nazwy własne, identyfikatory, nazwy modeli, narzędzi, funkcji, endpointów, komendy, ścieżki i kod zachowuj w oryginalnej postaci. ' +
    'Jeżeli wykonujesz operacje za pomocą narzędzi systemowych, raportuj ich stan, wynik i błędy użytkownikowi po polsku. ' +
    'Stosuj Markdown, gdy poprawia czytelność; kod prezentuj w blokach kodu z oznaczeniem języka. ' +
    'Nie ujawniaj kluczy API, tokenów, sekretów ani poufnych danych konfiguracyjnych.'
});

const upstreamHttpAgent = new http.Agent({ keepAlive: true, maxSockets: 256, maxFreeSockets: 64, timeout: 60000 });
const upstreamHttpsAgent = new https.Agent({ keepAlive: true, maxSockets: 256, maxFreeSockets: 64, timeout: 60000 });

let backendCache = { baseUrl: '', token: '', timestamp: 0 };

function getSearchLocations() {
  const home = os.homedir();
  return [
    process.env.HERMES_MOBILE_BACKEND_FILE && path.resolve(process.env.HERMES_MOBILE_BACKEND_FILE),
    path.join(home, '.context-workspace', 'hermes-backend.json'),
    path.join(home, '.context-workspace', 'backend.json'),
    path.join(home, '.hermes', 'hermes-mobile-backend.json')
  ].filter(Boolean);
}

async function locateAndReadBackend() {
  const now = Date.now();
  if (CONFIG.STATIC_BACKEND_URL) {
    return { baseUrl: CONFIG.STATIC_BACKEND_URL.replace(/\/+$/, ''), token: CONFIG.STATIC_TOKEN };
  }
  if (backendCache.baseUrl && now - backendCache.timestamp < CONFIG.CACHE_TTL_MS) return backendCache;

  for (const candidate of getSearchLocations()) {
    try {
      const parsed = JSON.parse(await fsPromises.readFile(candidate, 'utf8'));
      const baseUrl = (parsed.baseUrl || parsed.url || '').replace(/\/+$/, '');
      const token = parsed.token || parsed.apiKey || parsed.key || CONFIG.STATIC_TOKEN || '';
      if (baseUrl) {
        backendCache = { baseUrl, token, timestamp: now };
        return backendCache;
      }
    } catch {}
  }

  backendCache = { baseUrl: 'http://127.0.0.1:8642', token: CONFIG.STATIC_TOKEN, timestamp: now };
  return backendCache;
}

function setupConfigWatcher() {
  for (const dir of [path.join(os.homedir(), '.context-workspace'), path.join(os.homedir(), '.hermes')]) {
    if (!fs.existsSync(dir)) continue;
    try {
      fs.watch(dir, { persistent: false }, () => {
        backendCache.timestamp = 0;
      });
    } catch {}
  }
}
setupConfigWatcher();

function resolveTailscaleIp() {
  const forced = process.env.HERMES_MOBILE_TAILSCALE_IP;
  if (forced) return forced;
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const addr of entries || []) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      const [a, b] = addr.address.split('.').map(Number);
      if (a === 100 && b >= 64 && b <= 127) return addr.address;
    }
  }
  return null;
}

function resolveBindingHost() {
  if (CONFIG.HOST_MODE === 'tailscale') return resolveTailscaleIp() || '127.0.0.1';
  if (CONFIG.HOST_MODE === 'all') return '0.0.0.0';
  return '127.0.0.1';
}

function isConversationRequest(req, targetPath) {
  return req.method === 'POST' && (targetPath.includes('/chat/completions') || targetPath.includes('/prompt.submit'));
}

function prependPolishSystem(messages) {
  const input = Array.isArray(messages) ? messages.filter(Boolean) : [];
  const firstSystemIndex = input.findIndex((message) => message?.role === 'system');
  const withoutSystem = input.filter((message) => message?.role !== 'system');
  if (firstSystemIndex >= 0) {
    const supplied = input[firstSystemIndex];
    return [
      { ...POLISH_SYSTEM_INSTRUCTION, content: `${POLISH_SYSTEM_INSTRUCTION.content}\n\nKontekst dodatkowy:\n${String(supplied.content ?? '')}` },
      ...withoutSystem
    ];
  }
  return [POLISH_SYSTEM_INSTRUCTION, ...withoutSystem];
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > CONFIG.MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Payload too large'), { code: 'PAYLOAD_TOO_LARGE' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
    req.on('aborted', () => reject(new Error('Client aborted request')));
  });
}

function sanitizeOutgoingHeaders(source) {
  const headers = { ...source };
  for (const key of ['host', 'authorization', 'cookie', 'content-length', 'connection']) delete headers[key];
  return headers;
}

function pipeProxyResponses(upstreamReq, clientRes) {
  let settled = false;
  upstreamReq.once('error', (error) => {
    if (settled) return;
    settled = true;
    if (!clientRes.headersSent) {
      clientRes.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      clientRes.end(JSON.stringify({ blad: 'Błąd połączenia z lokalną bramą Hermes Agent' }));
    } else {
      clientRes.destroy(error);
    }
  });
  upstreamReq.once('response', (upstreamRes) => {
    if (settled) return;
    settled = true;
    const headers = { ...upstreamRes.headers, 'x-proxied-by': 'hermes-mobile-apex' };
    if ((headers['content-type'] || '').includes('text/event-stream')) {
      headers['cache-control'] = 'no-cache, no-transform';
      headers.connection = 'keep-alive';
      headers['x-accel-buffering'] = 'no';
    }
    clientRes.writeHead(upstreamRes.statusCode || 200, headers);
    upstreamRes.pipe(clientRes);
    upstreamRes.on('error', () => clientRes.destroy());
  });
}

async function forwardProxyRequest(req, res, targetSubPath) {
  const backend = await locateAndReadBackend();
  const upstreamUrl = new URL(targetSubPath, `${backend.baseUrl}/`);
  const transport = upstreamUrl.protocol === 'https:' ? https : http;
  const agent = upstreamUrl.protocol === 'https:' ? upstreamHttpsAgent : upstreamHttpAgent;
  const headers = sanitizeOutgoingHeaders(req.headers);
  if (backend.token) {
    headers.authorization = `Bearer ${backend.token}`;
    headers['x-api-key'] = backend.token;
  }

  if (!isConversationRequest(req, targetSubPath)) {
    const upstreamReq = transport.request(upstreamUrl, { method: req.method, headers, agent, timeout: CONFIG.UPSTREAM_TIMEOUT_MS });
    pipeProxyResponses(upstreamReq, res);
    req.pipe(upstreamReq);
    return;
  }

  let body;
  try {
    body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
  } catch (error) {
    const status = error?.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400;
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ blad: status === 413 ? 'Żądanie jest zbyt duże' : 'Nieprawidłowy format JSON' }));
    return;
  }

  if (Array.isArray(body.messages)) body.messages = prependPolishSystem(body.messages);
  if (targetSubPath.includes('/prompt.submit')) {
    body.locale = body.locale || 'pl-PL';
    body.system_policy = body.system_policy || POLISH_SYSTEM_INSTRUCTION.content;
  }

  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  headers['content-type'] = headers['content-type'] || 'application/json';
  headers['content-length'] = String(payload.length);

  const upstreamReq = transport.request(upstreamUrl, { method: 'POST', headers, agent, timeout: CONFIG.UPSTREAM_TIMEOUT_MS });
  pipeProxyResponses(upstreamReq, res);
  upstreamReq.end(payload);
}

const MIME_MAP = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
});

async function handleStatic(req, res, pathname) {
  const safePath = path.normalize(pathname).replace(/^\.+[\\/]/, '');
  let fullPath = path.join(PUBLIC_DIR, safePath);
  try {
    let stat = await fsPromises.stat(fullPath);
    if (stat.isDirectory()) {
      fullPath = path.join(fullPath, 'index.html');
      stat = await fsPromises.stat(fullPath);
    }
    const ext = path.extname(fullPath).toLowerCase();
    res.setHeader('Content-Type', MIME_MAP[ext] || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'microphone=(self), clipboard-write=(self)');
    res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self';");
    res.setHeader('Cache-Control', ['.html', '.json', '.webmanifest'].includes(ext) ? 'no-cache, no-store, must-revalidate' : 'public, max-age=31536000, immutable');
    fs.createReadStream(fullPath).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ blad: 'Nie odnaleziono zasobu', kod: 404 }));
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    if (url.pathname === '/healthz' || url.pathname === '/bridge/status') {
      const backend = await locateAndReadBackend();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ status: 'działa', wersja: '4.0.0-apex', jezyk: 'pl-PL', cel_bramy: backend.baseUrl, autoryzacja: Boolean(backend.token), czas_pracy_sekundy: Math.floor(process.uptime()) }));
      return;
    }
    if (url.pathname.startsWith('/hermes-backend/')) {
      await forwardProxyRequest(req, res, url.pathname.replace('/hermes-backend', '') + url.search);
      return;
    }
    await handleStatic(req, res, url.pathname);
  } catch (error) {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ blad: 'Błąd krytyczny serwera mostu' }));
    }
  }
});

const bindHost = resolveBindingHost();
server.listen(CONFIG.PORT, bindHost, () => {
  console.log(`Hermes Mobile Apex 4.0 — http://${bindHost}:${CONFIG.PORT}`);
  console.log('Polityka językowa: pl-PL');
});
