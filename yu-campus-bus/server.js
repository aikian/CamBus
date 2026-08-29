#!/usr/bin/env node
/**
 * BUS@YU prototype server
 * - Static files
 * - Ephemeral crowd bus telemetry (TTL 120s)
 * - Ephemeral crowding reports (TTL 30m)
 * - Useful-site feed from data/useful-sites.json
 * - Persistent anonymous unique-browser counts for today / current month
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8080);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const USEFUL_SITES_FILE = path.join(DATA_DIR, 'useful-sites.json');
const VISITOR_STATS_FILE = path.join(DATA_DIR, 'visitor-stats.json');
const TELEMETRY_TTL_MS = 120_000;
const CROWD_TTL_MS = 30 * 60_000;
const MAX_BODY = 16 * 1024;
const CAMPUS = { minLat: 35.8200, maxLat: 35.8420, minLng: 128.7460, maxLng: 128.7680 };
const ROUTES = new Set(['r1', 'r2']);
const CROWD_LEVELS = new Set(['quiet', 'normal', 'crowded', 'full']);

const telemetry = new Map();
const crowdReports = new Map();
const rate = new Map();

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(USEFUL_SITES_FILE)) fs.writeFileSync(USEFUL_SITES_FILE, '[]\n');
if (!fs.existsSync(VISITOR_STATS_FILE)) fs.writeFileSync(VISITOR_STATS_FILE, '{\n  "days": {},\n  "months": {}\n}\n');

let visitorStats = loadVisitorStats();

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8'
};

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(payload)
  });
  res.end(payload);
}

function prune(now = Date.now()) {
  for (const [key, row] of telemetry) if (row.expiresAt <= now) telemetry.delete(key);
  for (const [key, row] of crowdReports) if (row.expiresAt <= now) crowdReports.delete(key);
  for (const [key, row] of rate) if (row.windowStart + 60_000 <= now) rate.delete(key);
}

function allow(req, limit = 120) {
  const ip = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  let row = rate.get(ip);
  if (!row || row.windowStart + 60_000 <= now) row = { windowStart: now, count: 0 };
  row.count += 1;
  rate.set(ip, row);
  return row.count <= limit;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(Object.assign(new Error('invalid json'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function validToken(v) {
  return typeof v === 'string' && v.length >= 8 && v.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(v);
}
function validTrip(v) {
  return typeof v === 'string' && v.length >= 4 && v.length <= 40 && /^[A-Za-z0-9:_-]+$/.test(v);
}
function validCoord(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= CAMPUS.minLat && lat <= CAMPUS.maxLat && lng >= CAMPUS.minLng && lng <= CAMPUS.maxLng;
}
function safeHttpUrl(value) {
  try {
    const u = new URL(String(value));
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : null;
  } catch { return null; }
}

function median(nums) {
  if (!nums.length) return null;
  const a = [...nums].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function liveBusAggregates(now = Date.now()) {
  prune(now);
  const groups = new Map();
  for (const row of telemetry.values()) {
    const key = `${row.routeId}|${row.tripKey}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const out = [];
  for (const rows of groups.values()) {
    const lat = median(rows.map(x => x.lat));
    const lng = median(rows.map(x => x.lng));
    const newest = Math.max(...rows.map(x => x.serverTimestamp));
    out.push({
      routeId: rows[0].routeId,
      tripKey: rows[0].tripKey,
      lat: Number(lat.toFixed(5)),
      lng: Number(lng.toFixed(5)),
      contributors: rows.length,
      sampleAgeSeconds: Math.max(0, Math.round((now - newest) / 1000)),
      source: 'crowd'
    });
  }
  return out;
}

function crowdingAggregates(now = Date.now()) {
  prune(now);
  const weights = { quiet: 1, normal: 2, crowded: 3, full: 4 };
  const labels = ['quiet', 'normal', 'crowded', 'full'];
  const groups = new Map();
  for (const row of crowdReports.values()) {
    const key = `${row.routeId}|${row.tripKey}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const out = [];
  for (const rows of groups.values()) {
    const avg = rows.reduce((s, x) => s + weights[x.level], 0) / rows.length;
    const idx = Math.max(0, Math.min(3, Math.round(avg) - 1));
    const newest = Math.max(...rows.map(x => x.createdAt));
    out.push({
      routeId: rows[0].routeId,
      tripKey: rows[0].tripKey,
      level: labels[idx],
      reports: rows.length,
      updatedSecondsAgo: Math.max(0, Math.round((now - newest) / 1000))
    });
  }
  return out;
}

function loadUsefulSites() {
  try {
    const parsed = JSON.parse(fs.readFileSync(USEFUL_SITES_FILE, 'utf8'));
    const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.sites) ? parsed.sites : []);
    return list
      .filter(item => item && item.enabled !== false && typeof item.title === 'string' && safeHttpUrl(item.url))
      .map((item, index) => ({
        id: String(item.id || `site-${index + 1}`).slice(0, 80),
        title: item.title.trim().slice(0, 50),
        url: safeHttpUrl(item.url),
        icon: typeof item.icon === 'string' ? item.icon.trim().slice(0, 500) : '',
        description: typeof item.description === 'string' ? item.description.trim().slice(0, 120) : '',
        order: Number.isFinite(Number(item.order)) ? Number(item.order) : 9999
      }))
      .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'ko'));
  } catch (e) {
    console.warn('Could not read useful-sites.json:', e.message);
    return [];
  }
}

function loadVisitorStats() {
  try {
    const parsed = JSON.parse(fs.readFileSync(VISITOR_STATS_FILE, 'utf8'));
    return {
      days: parsed && typeof parsed.days === 'object' && parsed.days ? parsed.days : {},
      months: parsed && typeof parsed.months === 'object' && parsed.months ? parsed.months : {}
    };
  } catch {
    return { days: {}, months: {} };
  }
}

function koreaDateKeys(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  return { day, month: `${parts.year}-${parts.month}` };
}

function pruneVisitorStats() {
  const dayKeys = Object.keys(visitorStats.days).sort();
  const monthKeys = Object.keys(visitorStats.months).sort();
  dayKeys.slice(0, Math.max(0, dayKeys.length - 70)).forEach(k => delete visitorStats.days[k]);
  monthKeys.slice(0, Math.max(0, monthKeys.length - 24)).forEach(k => delete visitorStats.months[k]);
}

function persistVisitorStats() {
  pruneVisitorStats();
  const temp = VISITOR_STATS_FILE + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(visitorStats, null, 2) + '\n');
  fs.renameSync(temp, VISITOR_STATS_FILE);
}

function visitorCounts() {
  const { day, month } = koreaDateKeys();
  const today = Array.isArray(visitorStats.days[day]) ? visitorStats.days[day].length : 0;
  const monthCount = Array.isArray(visitorStats.months[month]) ? visitorStats.months[month].length : 0;
  return { today, month: monthCount, dayKey: day, monthKey: month };
}

function registerVisitor(visitorToken) {
  const digest = crypto.createHash('sha256').update(`BUS@YU:${visitorToken}`).digest('hex');
  const { day, month } = koreaDateKeys();
  if (!Array.isArray(visitorStats.days[day])) visitorStats.days[day] = [];
  if (!Array.isArray(visitorStats.months[month])) visitorStats.months[month] = [];
  let changed = false;
  if (!visitorStats.days[day].includes(digest)) { visitorStats.days[day].push(digest); changed = true; }
  if (!visitorStats.months[month].includes(digest)) { visitorStats.months[month].push(digest); changed = true; }
  if (changed) persistVisitorStats();
  return visitorCounts();
}

async function api(req, res, pathname) {
  if (!allow(req)) return json(res, 429, { error: 'rate_limited' });
  prune();

  if (req.method === 'GET' && pathname === '/api/health') {
    return json(res, 200, { ok: true, service: 'bus-at-yu', now: new Date().toISOString() });
  }
  if (req.method === 'GET' && pathname === '/api/live-buses') {
    return json(res, 200, { buses: liveBusAggregates() });
  }
  if (req.method === 'GET' && pathname === '/api/crowding') {
    return json(res, 200, { crowding: crowdingAggregates() });
  }
  if (req.method === 'GET' && pathname === '/api/useful-sites') {
    return json(res, 200, { sites: loadUsefulSites() });
  }
  if (req.method === 'GET' && pathname === '/api/visitors') {
    return json(res, 200, visitorCounts());
  }

  if (req.method === 'POST' && pathname === '/api/visit') {
    const body = await readJson(req);
    if (!validToken(body.visitorToken)) return json(res, 400, { error: 'invalid_visitor_token' });
    return json(res, 200, registerVisitor(body.visitorToken));
  }

  if (req.method === 'POST' && pathname === '/api/telemetry') {
    const body = await readJson(req);
    const { riderToken, routeId, tripKey } = body;
    const lat = Number(body.lat), lng = Number(body.lng), accuracy = Number(body.accuracy);
    if (!validToken(riderToken) || !ROUTES.has(routeId) || !validTrip(tripKey) || !validCoord(lat, lng)) {
      return json(res, 400, { error: 'invalid_telemetry' });
    }
    if (Number.isFinite(accuracy) && (accuracy < 0 || accuracy > 500)) return json(res, 400, { error: 'invalid_accuracy' });
    const now = Date.now();
    telemetry.set(riderToken, {
      riderToken, routeId, tripKey, lat, lng,
      accuracy: Number.isFinite(accuracy) ? accuracy : null,
      clientTimestamp: Number.isFinite(Number(body.clientTimestamp)) ? Number(body.clientTimestamp) : null,
      serverTimestamp: now,
      expiresAt: now + TELEMETRY_TTL_MS
    });
    return json(res, 202, { ok: true, expiresInSeconds: TELEMETRY_TTL_MS / 1000 });
  }

  if (req.method === 'POST' && pathname === '/api/crowding') {
    const body = await readJson(req);
    const { reportToken, routeId, tripKey, level } = body;
    if (!validToken(reportToken) || !ROUTES.has(routeId) || !validTrip(tripKey) || !CROWD_LEVELS.has(level)) {
      return json(res, 400, { error: 'invalid_crowding_report' });
    }
    const now = Date.now();
    const key = `${reportToken}:${routeId}:${tripKey}`;
    crowdReports.set(key, { reportToken, routeId, tripKey, level, createdAt: now, expiresAt: now + CROWD_TTL_MS });
    return json(res, 202, { ok: true, expiresInSeconds: CROWD_TTL_MS / 1000 });
  }

  return json(res, 404, { error: 'not_found' });
}

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  try { rel = decodeURIComponent(rel); } catch { return json(res, 400, { error: 'bad_path' }); }
  const file = path.resolve(ROOT, '.' + rel);
  if (!file.startsWith(ROOT + path.sep)) return json(res, 403, { error: 'forbidden' });
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const type = mime[path.extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': path.basename(file) === 'sw.js' ? 'no-cache' : 'public, max-age=60'
    });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url.pathname);
    return serveStatic(req, res, url.pathname);
  } catch (e) {
    console.error(e);
    return json(res, e.status || 500, { error: e.message || 'server_error' });
  }
});

server.listen(PORT, () => {
  console.log(`BUS@YU running at http://localhost:${PORT}`);
  console.log(`Useful sites file: ${USEFUL_SITES_FILE}`);
  console.log('Crowd telemetry stays in memory; visitor counts are stored as token hashes only.');
});
