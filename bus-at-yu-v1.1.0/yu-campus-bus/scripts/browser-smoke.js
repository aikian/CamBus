#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, 'artifacts');
const chromePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const baseUrl = process.env.CAMBUS_SMOKE_URL || 'http://127.0.0.1:8080';
const debugPort = 19200 + (process.pid % 700);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cambus-smoke-'));
fs.mkdirSync(artifacts, { recursive: true });

let chrome;
let socket;
let messageId = 0;
const pending = new Map();
const eventWaiters = new Map();
const browserErrors = [];

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitJson(url, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {}
    await delay(100);
  }
  throw new Error(`Chrome endpoint timeout: ${url}`);
}

function waitEvent(method, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`CDP event timeout: ${method}`)), timeoutMs);
    const list = eventWaiters.get(method) || [];
    list.push(params => { clearTimeout(timer); resolve(params); });
    eventWaiters.set(method, list);
  });
}

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++messageId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP command timeout: ${method}`));
    }, 15000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || 'browser evaluation failed');
  return response.result?.value;
}

async function navigate(url) {
  const loaded = waitEvent('Page.loadEventFired');
  await send('Page.navigate', { url });
  await loaded;
}

async function waitFor(expression, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(`Boolean(${expression})`)) return;
    await delay(150);
  }
  throw new Error(`page condition timeout: ${expression}`);
}

async function screenshot(name) {
  const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(artifacts, name), Buffer.from(result.data, 'base64'));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  if (!fs.existsSync(chromePath)) throw new Error(`Chrome not found: ${chromePath}`);
  chrome = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-background-networking',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank'
  ], { stdio: 'ignore', windowsHide: true });

  await waitJson(`http://127.0.0.1:${debugPort}/json/version`);
  const target = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' }).then(response => response.json());
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (message.id) {
      const row = pending.get(message.id);
      if (!row) return;
      clearTimeout(row.timer);
      pending.delete(message.id);
      if (message.error) row.reject(new Error(message.error.message));
      else row.resolve(message.result || {});
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') browserErrors.push(message.params?.exceptionDetails?.text || 'uncaught exception');
    const list = eventWaiters.get(message.method);
    if (list?.length) list.shift()(message.params);
  });

  await send('Page.enable');
  await send('Runtime.enable');

  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await navigate(`${baseUrl}/?smoke=mobile-${Date.now()}`);
  await waitFor("document.querySelectorAll('.stop-pin').length >= 10 && window.YUAds");
  const mobile = await evaluate(`(() => {
    const visible = el => Boolean(el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0);
    const rect = el => { const r = el.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right}; };
    const launch = document.getElementById('launchAd');
    const tabs = document.querySelector('.page-switch');
    return {
      title: document.title,
      stops: document.querySelectorAll('.stop-pin').length,
      routePaths: document.querySelectorAll('.leaflet-overlay-pane path').length,
      provider: window.YUAds.config.provider,
      launchVisible: visible(launch),
      bottomVisible: visible(document.getElementById('bottomAd')),
      closeVisible: visible(document.getElementById('closeLaunchAd')),
      fabVisible: visible(document.getElementById('mobilePanelBtn')),
      panelHint: document.querySelector('.mobile-panel-hint')?.textContent.trim(),
      launchRect: rect(launch),
      tabRect: rect(tabs)
    };
  })()`);
  assert(mobile.title.includes('CamBus'), 'mobile title missing');
  assert(mobile.stops >= 10 && mobile.routePaths >= 2, 'mobile map routes/stops missing');
  assert(mobile.provider === 'demo' && mobile.launchVisible && mobile.bottomVisible, 'visible demo ads missing');
  assert(mobile.closeVisible, 'mobile launch ad close button missing');
  assert(mobile.fabVisible || mobile.panelHint === '길찾기 열기', 'mobile route entry missing');
  assert(mobile.tabRect.bottom <= mobile.launchRect.y, 'mobile page tabs overlap launch ad');
  await screenshot('smoke-mobile-launch.png');

  await evaluate("document.getElementById('closeLaunchAd').click()");
  await evaluate(`(() => {
    const start = document.getElementById('startInput');
    const destination = document.getElementById('destinationInput');
    start.value = '중앙도서관'; start.dispatchEvent(new Event('change', {bubbles:true}));
    destination.value = '서문'; destination.dispatchEvent(new Event('change', {bubbles:true}));
    document.getElementById('routeBtn').click();
  })()`);
  await waitFor("document.querySelectorAll('.route-card').length >= 1", 22000);
  const routeCards = await evaluate("document.querySelectorAll('.route-card').length");
  assert(routeCards >= 1, 'route search produced no cards');
  await screenshot('smoke-mobile-route.png');

  await evaluate("document.querySelector('[data-page-index=\"1\"]').click()");
  await waitFor("document.querySelectorAll('.feed-card').length >= 5");
  const picks = await evaluate(`({ cards:document.querySelectorAll('.feed-card').length, ads:document.querySelectorAll('.feed-inline-ad').length, page:document.body.dataset.page })`);
  assert(picks.page === '1' && picks.cards >= 5 && picks.ads >= 1, 'Picks feed or ads missing');
  await screenshot('smoke-mobile-picks.png');

  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await navigate(`${baseUrl}/path-editor.html?smoke=${Date.now()}`);
  await waitFor("document.querySelectorAll('#legList .stop-row').length >= 8 && document.querySelectorAll('.path-stop-pin').length >= 9");
  const editor = await evaluate(`({ legs:document.querySelectorAll('#legList .stop-row').length, pins:document.querySelectorAll('.path-stop-pin').length, anchorPins:document.querySelectorAll('.path-anchor-pin').length, saveDisabled:document.getElementById('saveButton').disabled, status:document.getElementById('connectionStatus').textContent.trim() })`);
  assert(editor.legs >= 8 && editor.pins >= 9, 'path editor route data missing');
  assert(editor.status.includes('저장된 고정 노선'), 'path editor did not load saved route');
  await screenshot('smoke-path-editor.png');
  await evaluate("document.querySelectorAll('#legList .stop-row')[4].click()");
  await delay(500);
  const editedLeg = await evaluate(`({ title:document.getElementById('selectedName').textContent, anchors:document.querySelectorAll('.path-anchor-pin').length })`);
  assert(editedLeg.anchors === 4, 'requested 1-route correction anchors are missing');
  await screenshot('smoke-r1-corrected-leg.png');

  assert(browserErrors.length === 0, `browser exceptions: ${browserErrors.join('; ')}`);
  console.log(JSON.stringify({ mobile, routeCards, picks, editor, editedLeg, browserErrors }, null, 2));
  console.log('CamBus browser smoke passed.');
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
}).finally(async () => {
  try { socket?.close(); } catch {}
  if (chrome && !chrome.killed) chrome.kill();
  await delay(150);
  const resolvedProfile = path.resolve(profile);
  if (resolvedProfile.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolvedProfile).startsWith('cambus-smoke-')) {
    // 윈도우에서는 크롬이 프로필 파일을 잠깐 더 물고 있어 삭제가 실패할 수 있습니다.
    // 임시 디렉터리 청소 실패가 테스트 결과를 덮어쓰지 않도록 무시합니다.
    try {
      fs.rmSync(resolvedProfile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    } catch (cleanupError) {
      console.warn(`temp profile cleanup skipped: ${cleanupError.code || cleanupError.message}`);
    }
  }
});
