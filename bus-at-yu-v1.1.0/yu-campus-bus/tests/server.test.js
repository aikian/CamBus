const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const port = 18100 + (process.pid % 500);
let child;

async function waitForServer() {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('test server did not start');
}

test.before(async () => {
  child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), CAMBUS_AD_PROVIDER: 'demo' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  await waitForServer();
});

test.after(() => {
  if (child && !child.killed) child.kill();
});

test('health and public ad config are explicit', async () => {
  const healthResponse = await fetch(`http://127.0.0.1:${port}/api/health`);
  assert.equal(healthResponse.headers.get('x-content-type-options'), 'nosniff');
  const health = await healthResponse.json();
  assert.equal(health.ok, true);
  // 버전은 VERSION 파일이 유일한 출처다. 하드코딩하면 릴리스마다 어긋난다.
  assert.equal(health.version, fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim());
  assert.equal(health.adProvider, 'demo');

  const config = await fetch(`http://127.0.0.1:${port}/api/ad-config`).then(response => response.json());
  assert.equal(config.provider, 'demo');
  assert.equal(config.networkScriptsReady, false);
  assert.deepEqual(config.feedPlacementIds, []);
});

test('route editor data and Picks feed APIs return usable data', async () => {
  const paths = await fetch(`http://127.0.0.1:${port}/api/route-paths`).then(response => response.json());
  const timings = await fetch(`http://127.0.0.1:${port}/api/route-timings`).then(response => response.json());
  const feed = await fetch(`http://127.0.0.1:${port}/api/portal-feed`).then(response => response.json());
  assert.ok(paths.routes.r1.legs.length > 0);
  assert.equal(timings.routes.r1.legs.length, paths.routes.r1.legs.length);
  assert.ok(feed.items.length > 0);
});
