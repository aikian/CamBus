const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { createHash } = require('crypto');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const testData = fs.mkdtempSync(path.join(os.tmpdir(), 'cambus-api-'));
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
  const sources = JSON.parse(fs.readFileSync(path.join(root, 'data/feed-sources.json')));
  fs.writeFileSync(path.join(testData, 'feed-sources.json'), JSON.stringify(sources.map(s => ({ ...s, enabled: false }))));
  const visitors = Array.from({ length: 999 }, (_, i) => createHash('sha256').update('BUS@YU:browser-token-' + i).digest('hex'));
  fs.writeFileSync(path.join(testData, 'visitor-stats.json'), JSON.stringify({
    days: {}, months: { '2026-01': visitors, '2026-02': visitors.slice(0, 20) }
  }));
  child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), CAMBUS_DATA_DIR: testData, CAMBUS_AD_PROVIDER: 'demo', CAMBUS_ADMIN_TOKEN: 'test-admin' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  await waitForServer();
});

test.after(async () => {
  const exited = child && child.exitCode === null ? new Promise(resolve => child.once('exit', resolve)) : Promise.resolve();
  if (child && !child.killed) child.kill();
  await exited;
  fs.rmSync(testData, { recursive: true, force: true });
});

test('health and public ad config are explicit', async () => {
  const healthResponse = await fetch(`http://127.0.0.1:${port}/api/health`);
  assert.equal(healthResponse.headers.get('x-content-type-options'), 'nosniff');
  const health = await healthResponse.json();
  assert.equal(health.ok, true);
  // 버전은 VERSION 파일이 유일한 출처다. 하드코딩하면 릴리스마다 어긋난다.
  assert.equal(health.version, fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim());
  assert.equal(health.adProvider, 'none');

  const config = await fetch(`http://127.0.0.1:${port}/api/ad-config`).then(response => response.json());
  assert.equal(config.provider, 'none');
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

test('ads unlock on the thousandth distinct browser across months', async () => {
  const getConfig = () => fetch(`http://127.0.0.1:${port}/api/ad-config`).then(r => r.json());
  const visit = visitorToken => fetch(`http://127.0.0.1:${port}/api/visit`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visitorToken })
  });
  await visit('browser-token-0');
  assert.equal((await getConfig()).audienceReached, false);
  await visit('browser-token-999');
  assert.equal((await getConfig()).audienceReached, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(testData, 'visitor-stats.json'))).adAudienceReached, true);
});

test('audience counts are private, categorical, and idempotent', async () => {
  const base = 'http://127.0.0.1:' + port;
  const month = (await fetch(base + '/api/visitors').then(r => r.json())).monthKey;
  const body = { month, ageBand: '20대', gender: '응답하지 않음', occupation: '학생', receipt: require('node:crypto').randomUUID() };
  const submit = payload => fetch(base + '/api/audience', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  assert.equal((await submit({ ...body, age: 23 })).status, 400);
  assert.equal((await submit({ ...body, ageBand: '13' })).status, 400);
  assert.equal((await submit({ ...body, month: '2000-01' })).status, 409);
  await Promise.all([1, 2].map(async () => assert.equal((await submit(body)).status, 200)));
  assert.equal((await fetch(base + '/api/admin/overview')).status, 401);
  assert.equal((await fetch(base + '/data/audience.json')).status, 404);
  const overview = await fetch(base + '/api/admin/overview', { headers: { Authorization: 'Bearer test-admin' } }).then(r => r.json());
  assert.deepEqual(overview.audienceMonths[month], {
    total: 1, ageBand: { '20대': 1 }, gender: { '응답하지 않음': 1 }, occupation: { '학생': 1 }
  });
  const stored = fs.readFileSync(path.join(testData, 'audience.json'), 'utf8');
  assert.ok(!stored.includes(body.receipt));
});

test('audience receipts expire on rollover and aggregates after twelve calendar months', () => {
  let month = '2025-12';
  const file = path.join(testData, 'retention.json');
  const store = require('../audience').openAudience(file, () => month);
  const fields = { ageBand: '20대', gender: '남성', occupation: '학생', receipt: require('node:crypto').randomUUID() };
  assert.equal(store.record({ ...fields, month }), 200);
  month = '2026-11';
  store.rotate();
  assert.deepEqual(JSON.parse(fs.readFileSync(file)).receipts, {});
  assert.equal(store.record({ ...fields, month }), 200);
  assert.deepEqual(Object.keys(store.summary()), ['2025-12', '2026-11']);
  month = '2026-12';
  const reopened = require('../audience').openAudience(file, () => month);
  assert.deepEqual(Object.keys(reopened.summary()), ['2026-11']);
});
