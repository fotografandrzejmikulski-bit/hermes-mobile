import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const port = 28643;
const child = spawn(process.execPath, ['server.mjs'], {
  cwd: new URL('..', import.meta.url),
  env: {
    ...process.env,
    PORT: String(port),
    HERMES_MOBILE_HOST: 'loopback',
    HERMES_MOBILE_BACKEND_URL: 'http://127.0.0.1:9',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

try {
  await once(child.stdout, 'data');
  const health = await fetch(`http://127.0.0.1:${port}/healthz`);
  assert.equal(health.status, 200);
  const payload = await health.json();
  assert.equal(payload.jezyk, 'pl-PL');
  assert.equal(payload.wersja, '4.0.0-apex');

  const manifest = await fetch(`http://127.0.0.1:${port}/manifest.json`);
  assert.equal(manifest.status, 200);
  const manifestPayload = await manifest.json();
  assert.equal(manifestPayload.lang, 'pl-PL');
} finally {
  child.kill('SIGTERM');
}
