#!/usr/bin/env node
/**
 * CamBus prototype server
 * - Static files
 * - Ephemeral crowd bus telemetry (TTL 120s)
 * - Ephemeral crowding reports (TTL 30m)
 * - Picks vertical feed from data/portal-feed.json
 * - Persistent anonymous unique-browser counts for today / current month
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const transitApi = require('./transit-api');
const { execFile } = require('child_process');

const PORT = Number(process.env.PORT || 8080);
const ROOT = __dirname;
// 배포에서는 마운트한 영구 디스크를 가리키게 한다. 방문자 통계와 편집기 저장분이
// 재배포마다 사라지면 안 되기 때문이다. 미지정이면 기존처럼 프로젝트 안의 data/ 를 쓴다.
const BUNDLED_DATA_DIR = path.join(ROOT, 'data');
const DATA_DIR = process.env.CAMBUS_DATA_DIR
  ? path.resolve(process.env.CAMBUS_DATA_DIR)
  : BUNDLED_DATA_DIR;
const PORTAL_FEED_FILE = path.join(DATA_DIR, 'portal-feed.json');
const PORTAL_AUTO_FILE = path.join(DATA_DIR, 'portal-auto.json');
const LOCAL_ADS_FILE = path.join(DATA_DIR, 'local-ads.json');
const PM_ZONES_FILE = path.join(DATA_DIR, 'pm-zones.json');
const ROUTE_STOPS_FILE = path.join(DATA_DIR, 'route-stops.json');
const ROUTE_PATHS_FILE = path.join(DATA_DIR, 'route-paths.json');
const ROUTE_TIMINGS_FILE = path.join(DATA_DIR, 'route-timings.json');
const VISITOR_STATS_FILE = path.join(DATA_DIR, 'visitor-stats.json');
const METRICS_FILE = path.join(DATA_DIR, 'metrics.json');
const AD_LAYOUT_FILE = path.join(DATA_DIR, 'ad-layout.json');
const FEED_SOURCES_FILE = path.join(DATA_DIR, 'feed-sources.json');
const LEG_STATS_FILE = path.join(DATA_DIR, 'leg-stats.json');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const TELEMETRY_TTL_MS = 120_000;
const CROWD_TTL_MS = 30 * 60_000;
const MAX_BODY = 16 * 1024;
const MAX_EDITOR_BODY = 2 * 1024 * 1024;
const MAX_UPLOAD_BODY = 6 * 1024 * 1024;   // base64 로 감싸면 원본보다 약 33% 커진다
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const AD_SLOTS = new Set(['mainBottom', 'launch', 'picksFeed', 'picksFooter']);
const AD_EVENT_TYPES = new Set(['impression', 'click']);
// 실측 구간 기록. 위치 좌표는 받지도 저장하지도 않고, 구간에 걸린 초만 모읍니다.
const LEG_SAMPLE_TYPES = new Set(['travel', 'dwell']);
const LEG_SECONDS_MIN = 5;
const LEG_SECONDS_MAX = 1800;
const LEG_SAMPLE_KEEP = 60;      // 구간마다 최근 표본 이만큼만 보관(중앙값 계산용)
const UPLOAD_TYPES = new Map([
  ['image/png', '.png'], ['image/jpeg', '.jpg'], ['image/webp', '.webp'], ['image/gif', '.gif']
]);
const CAMPUS = { minLat: 35.8200, maxLat: 35.8420, minLng: 128.7460, maxLng: 128.7680 };
const ROUTES = new Set(['r1', 'r2']);
const CROWD_LEVELS = new Set(['quiet', 'normal', 'crowded', 'full']);
const AD_PROVIDERS = new Set(['demo', 'ezoic', 'none']);

const telemetry = new Map();
const crowdReports = new Map();
const rate = new Map();

fs.mkdirSync(DATA_DIR, { recursive: true });

// 빈 볼륨으로 처음 뜰 때는 저장소에 들어 있는 노선/피드 데이터를 한 번 복사해 넣는다.
// (이게 없으면 route-stops.json 이 없어서 지도가 아예 그려지지 않는다)
if (DATA_DIR !== BUNDLED_DATA_DIR && fs.existsSync(BUNDLED_DATA_DIR)) {
  for (const name of fs.readdirSync(BUNDLED_DATA_DIR)) {
    if (!name.endsWith('.json')) continue;
    const target = path.join(DATA_DIR, name);
    if (!fs.existsSync(target)) fs.copyFileSync(path.join(BUNDLED_DATA_DIR, name), target);
  }
}

if (!fs.existsSync(PORTAL_FEED_FILE)) fs.writeFileSync(PORTAL_FEED_FILE, '[]\n');
if (!fs.existsSync(PORTAL_AUTO_FILE)) fs.writeFileSync(PORTAL_AUTO_FILE, '[]\n');
if (!fs.existsSync(LOCAL_ADS_FILE)) fs.writeFileSync(LOCAL_ADS_FILE, '[]\n');
if (!fs.existsSync(PM_ZONES_FILE)) fs.writeFileSync(PM_ZONES_FILE, '[]\n');
if (!fs.existsSync(ROUTE_PATHS_FILE)) fs.writeFileSync(ROUTE_PATHS_FILE, '{\n  "version": 1,\n  "updatedAt": null,\n  "routes": {}\n}\n');
if (!fs.existsSync(METRICS_FILE)) fs.writeFileSync(METRICS_FILE, '{\n  \"days\": {},\n  \"months\": {}\n}\n');
if (!fs.existsSync(VISITOR_STATS_FILE)) fs.writeFileSync(VISITOR_STATS_FILE, '{\n  "days": {},\n  "months": {}\n}\n');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

let visitorStats = loadVisitorStats();
let metrics = loadMetrics();

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
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

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(self)');
}

function prune(now = Date.now()) {
  for (const [key, row] of telemetry) if (row.expiresAt <= now) telemetry.delete(key);
  for (const [key, row] of crowdReports) if (row.expiresAt <= now) crowdReports.delete(key);
  for (const [key, row] of rate) if (row.windowStart + 60_000 <= now) rate.delete(key);
}

// 캠퍼스 와이파이는 NAT 라 수백 명이 같은 공인 IP 로 보인다. IP 하나에 낮은 한도를 걸면
// 앱이 스스로를 막아버리므로, 프록시 뒤에서는 실제 클라이언트 IP 를 쓰고 한도도 넉넉히 잡는다.
// CAMBUS_TRUST_PROXY=1 은 신뢰할 수 있는 프록시(예: Coolify/nginx) 뒤에서만 켠다.
function clientKey(req) {
  if (process.env.CAMBUS_TRUST_PROXY === '1') {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket.remoteAddress || 'unknown';
}

// TAGO 는 일 10,000건 한도라 GET 이어도 따로 막아야 한다.
const upstreamRate = new Map();
function allowUpstream(req, limit = 20) {
  const key = clientKey(req);
  const now = Date.now();
  let row = upstreamRate.get(key);
  if (!row || row.windowStart + 60_000 <= now) row = { windowStart: now, count: 0 };
  row.count += 1;
  upstreamRate.set(key, row);
  if (upstreamRate.size > 5000) upstreamRate.clear();
  return row.count <= limit;
}

function allow(req, limit = 600) {
  // 읽기 전용 GET 은 캐시로 흡수되고 부작용이 없어 제한 대상에서 뺀다.
  // 제한은 쓰기(POST)와 외부 API 를 태우는 요청에만 건다.
  if (req.method === 'GET') return true;
  const key = clientKey(req);
  const now = Date.now();
  let row = rate.get(key);
  if (!row || row.windowStart + 60_000 <= now) row = { windowStart: now, count: 0 };
  row.count += 1;
  rate.set(key, row);
  return row.count <= limit;
}

function readJson(req, maxBody = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBody) {
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

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function positiveIntegerList(value) {
  return String(value || '').split(',').map(part => positiveInteger(part.trim())).filter(Boolean).slice(0, 20);
}

const DEFAULT_AD_LAYOUT = {
  version: 1,
  updatedAt: null,
  feedBannerLimit: 20,   // Picks 피드에 띄울 배너 총 개수(콘텐츠 + 광고)
  contentsPerAd: 4,      // 콘텐츠 몇 개마다 광고 슬롯을 넣을지
  slots: {
    mainBottom: { enabled: true },
    launch: { enabled: true },
    picksFeed: { enabled: true },
    picksFooter: { enabled: true }
  }
};

function loadAdLayout() {
  const raw = readJsonFile(AD_LAYOUT_FILE, {});
  const slots = {};
  for (const name of AD_SLOTS) {
    slots[name] = { enabled: raw?.slots?.[name]?.enabled !== false };
  }
  return {
    version: 1,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
    feedBannerLimit: clampInt(raw.feedBannerLimit, 4, 60, DEFAULT_AD_LAYOUT.feedBannerLimit),
    contentsPerAd: clampInt(raw.contentsPerAd, 1, 20, DEFAULT_AD_LAYOUT.contentsPerAd),
    slots
  };
}

function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function persistAdLayout(input) {
  const current = loadAdLayout();
  const slots = {};
  for (const name of AD_SLOTS) {
    const incoming = input?.slots?.[name];
    slots[name] = { enabled: incoming ? incoming.enabled !== false : current.slots[name].enabled };
  }
  const next = {
    version: 1,
    updatedAt: new Date().toISOString(),
    feedBannerLimit: clampInt(input?.feedBannerLimit, 4, 60, current.feedBannerLimit),
    contentsPerAd: clampInt(input?.contentsPerAd, 1, 20, current.contentsPerAd),
    slots
  };
  const temp = AD_LAYOUT_FILE + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(next, null, 2) + '\n');
  fs.renameSync(temp, AD_LAYOUT_FILE);
  return next;
}

function publicAdConfig() {
  const requestedProvider = String(process.env.CAMBUS_AD_PROVIDER || 'demo').toLowerCase();
  const provider = AD_PROVIDERS.has(requestedProvider) ? requestedProvider : 'demo';
  return {
    provider,
    launchPlacementId: positiveInteger(process.env.CAMBUS_AD_LAUNCH_PLACEMENT_ID),
    linksPlacementId: positiveInteger(process.env.CAMBUS_AD_LINKS_PLACEMENT_ID),
    feedPlacementIds: positiveIntegerList(process.env.CAMBUS_AD_FEED_PLACEMENT_IDS),
    useEzoicAnchor: String(process.env.CAMBUS_AD_USE_ANCHOR || 'true').toLowerCase() !== 'false',
    bannerHeight: Math.max(48, Math.min(120, Number(process.env.CAMBUS_AD_BANNER_HEIGHT) || 58)),
    networkScriptsReady: String(process.env.CAMBUS_EZOIC_HEADER_READY || '').toLowerCase() === 'true',
    layout: loadAdLayout()
  };
}

function adsTxtRedirect() {
  const raw = process.env.CAMBUS_ADS_TXT_URL;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || (url.hostname !== 'srv.adstxtmanager.com' && !url.hostname.endsWith('.adstxtmanager.com'))) return null;
    return url.href;
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

function readJsonFile(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

let knownStopCache = { at: 0, names: new Set() };
function knownStopNames() {
  if (Date.now() - knownStopCache.at < 300000) return knownStopCache.names;
  const names = new Set();
  try {
    const doc = loadRouteStops();
    for (const route of Object.values(doc.routes || {})) {
      for (const stop of route.stops || []) if (stop?.name) names.add(stop.name);
    }
  } catch {}
  knownStopCache = { at: Date.now(), names };
  return names;
}

let cachedVersion = null;
function appVersion() {
  if (cachedVersion) return cachedVersion;
  try { cachedVersion = fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim(); }
  catch { cachedVersion = 'unknown'; }
  return cachedVersion;
}

function loadRouteStops() {
  return readJsonFile(ROUTE_STOPS_FILE, { version: 1, updatedAt: null, routes: {} });
}

function loopbackRequest(req) {
  const address = String(req.socket.remoteAddress || '').toLowerCase();
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

// 리버스 프록시 뒤에서는 remoteAddress 가 프록시 주소라 루프백 검사만으로는 안전하지 않다.
// CAMBUS_ADMIN_TOKEN 이 설정돼 있으면 그 토큰만 쓰기를 허용한다.
// 토큰이 없으면(로컬 개발) 기존처럼 루프백만 허용한다.
// 브라우저가 CORS 프리플라이트 없이 보낼 수 있는(=단순 요청) 본문 타입.
// 이런 요청은 다른 사이트에서도 사용자 동의 없이 날아오므로 쓰기 API 에서 막는다.
function jsonBodyRequest(req) {
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  return type === 'application/json';
}

// 다른 출처(웹사이트)에서 건너온 요청인지. Origin 이 없으면 curl 등 비브라우저 요청이다.
function crossSiteRequest(req) {
  const site = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (site && site !== 'same-origin' && site !== 'none') return true;
  const origin = req.headers['origin'];
  if (!origin) return false;
  const host = String(req.headers['host'] || '');
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

function adminAuthorized(req) {
  const expected = process.env.CAMBUS_ADMIN_TOKEN || '';
  // 다른 사이트가 대신 보낸 요청은 토큰 유무와 무관하게 거부한다(CSRF 차단).
  if (crossSiteRequest(req)) return false;
  if (!expected) {
    // 토큰이 없으면 로컬 개발로만 허용한다. 운영에서 실수로 열리지 않도록
    // CAMBUS_DEV=1 을 명시할 때만 루프백 폴백을 쓴다.
    return process.env.CAMBUS_DEV === '1' && loopbackRequest(req);
  }
  const header = String(req.headers['authorization'] || '');
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // 길이가 다르면 timingSafeEqual 이 예외를 던지므로 먼저 거른다.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requireAdmin(req, res) {
  if (!adminAuthorized(req)) {
    json(res, 401, { error: 'admin_auth_required' });
    return false;
  }
  // 쓰기 요청은 application/json 만 받는다. text/plain 등은 프리플라이트 없이
  // 다른 사이트에서 보낼 수 있어 CSRF 경로가 된다.
  if (req.method !== 'GET' && !jsonBodyRequest(req)) {
    json(res, 415, { error: 'json_body_required' });
    return false;
  }
  return true;
}

function validatedRouteStops(input) {
  const current = loadRouteStops();
  const next = {
    version: 1,
    updatedAt: new Date().toISOString(),
    routes: {}
  };
  for (const routeId of ['r1', 'r2']) {
    const baseRoute = current.routes?.[routeId];
    const incomingRoute = input?.routes?.[routeId];
    if (!baseRoute || !Array.isArray(baseRoute.stops) || !incomingRoute || !Array.isArray(incomingRoute.stops)) {
      throw Object.assign(new Error('invalid_route_stops'), { status: 400 });
    }
    const incomingById = new Map(incomingRoute.stops.map(stop => [String(stop?.id || ''), stop]));
    const stops = baseRoute.stops.map(baseStop => {
      const incoming = incomingById.get(baseStop.id);
      const lat = Number(incoming?.coord?.[0]);
      const lng = Number(incoming?.coord?.[1]);
      if (!validCoord(lat, lng)) throw Object.assign(new Error(`invalid_coord_${baseStop.id}`), { status: 400 });
      return { ...baseStop, coord: [Number(lat.toFixed(6)), Number(lng.toFixed(6))] };
    });
    next.routes[routeId] = {
      name: baseRoute.name,
      color: baseRoute.color,
      guideImage: baseRoute.guideImage,
      stops
    };
  }
  return next;
}

function persistRouteStops(data) {
  const temp = ROUTE_STOPS_FILE + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(temp, ROUTE_STOPS_FILE);
}

function validCoordinateList(list, min = 2, max = 6000) {
  return Array.isArray(list) && list.length >= min && list.length <= max &&
    list.every(coord => Array.isArray(coord) && coord.length === 2 && validCoord(Number(coord[0]), Number(coord[1])));
}

function validatedRoutePaths(input) {
  const stopData = loadRouteStops();
  const routes = {};
  for (const routeId of ['r1', 'r2']) {
    const stops = stopData.routes?.[routeId]?.stops;
    const incoming = input?.routes?.[routeId];
    if (!Array.isArray(stops) || !incoming || !Array.isArray(incoming.stopIds) || !Array.isArray(incoming.legs)) {
      throw Object.assign(new Error(`invalid_route_path_${routeId}`), { status: 400 });
    }
    const stopIds = stops.map(stop => stop.id);
    if (incoming.stopIds.length !== stopIds.length || incoming.stopIds.some((id, index) => id !== stopIds[index])) {
      throw Object.assign(new Error(`route_path_stop_mismatch_${routeId}`), { status: 400 });
    }
    if (incoming.legs.length !== stops.length - 1 || !validCoordinateList(incoming.geometry, 2, 12000)) {
      throw Object.assign(new Error(`invalid_route_path_geometry_${routeId}`), { status: 400 });
    }
    const anchors = {};
    const legs = incoming.legs.map((leg, index) => {
      const fromId = stops[index].id;
      const toId = stops[index + 1].id;
      if (leg?.fromId !== fromId || leg?.toId !== toId || !validCoordinateList(leg.geometry)) {
        throw Object.assign(new Error(`invalid_route_path_leg_${routeId}_${index}`), { status: 400 });
      }
      const duration = Number(leg.duration);
      const distance = Number(leg.distance);
      if (!Number.isFinite(duration) || duration <= 0 || duration > 3600 ||
          !Number.isFinite(distance) || distance < 0 || distance > 20000) {
        throw Object.assign(new Error(`invalid_route_path_metrics_${routeId}_${index}`), { status: 400 });
      }
      const key = `${fromId}>${toId}`;
      const rawAnchors = Array.isArray(incoming.anchors?.[key]) ? incoming.anchors[key] : [];
      if (rawAnchors.length > 24 || rawAnchors.some(coord => !Array.isArray(coord) || !validCoord(Number(coord[0]), Number(coord[1])))) {
        throw Object.assign(new Error(`invalid_route_path_anchors_${routeId}_${index}`), { status: 400 });
      }
      anchors[key] = rawAnchors.map(coord => [Number(Number(coord[0]).toFixed(6)), Number(Number(coord[1]).toFixed(6))]);
      return { fromId, toId, duration, distance, geometry: leg.geometry };
    });
    routes[routeId] = {
      stopIds,
      stopCoords: stops.map(stop => stop.coord),
      anchors,
      geometry: incoming.geometry,
      distance: Number(incoming.distance) || legs.reduce((sum, leg) => sum + leg.distance, 0),
      duration: Number(incoming.duration) || legs.reduce((sum, leg) => sum + leg.duration, 0),
      legs
    };
  }
  return { version: 1, updatedAt: new Date().toISOString(), source: 'compiled-osrm-with-manual-anchors', routes };
}

function persistRoutePaths(data) {
  const temp = ROUTE_PATHS_FILE + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(temp, ROUTE_PATHS_FILE);
}

function loadRouteTimings() {
  return readJsonFile(ROUTE_TIMINGS_FILE, { version: 1, routes: {} });
}

function validatedRouteTimings(input) {
  const stopData = loadRouteStops();
  const routes = {};
  for (const routeId of ['r1', 'r2']) {
    const expected = Math.max(0, (stopData.routes?.[routeId]?.stops?.length || 0) - 1);
    const incoming = input?.routes?.[routeId];
    if (!incoming || !Array.isArray(incoming.legs) || incoming.legs.length !== expected) {
      throw Object.assign(new Error(`invalid_route_timings_${routeId}`), { status: 400 });
    }
    routes[routeId] = {
      source: String(incoming.source || 'field-measured').slice(0, 80),
      legs: incoming.legs.map((value, index) => {
        if (value == null || value === '') return null;
        const seconds = Number(value);
        if (!Number.isFinite(seconds) || seconds < 10 || seconds > 1800) {
          throw Object.assign(new Error(`invalid_route_timing_${routeId}_${index}`), { status: 400 });
        }
        return Math.round(seconds);
      })
    };
  }
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    description: '정류장 간 현장 측정 초 값입니다. null이면 저장된 도로 경로 시간을 사용합니다.',
    routes
  };
}

function persistRouteTimings(data) {
  const temp = ROUTE_TIMINGS_FILE + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(temp, ROUTE_TIMINGS_FILE);
}

function sanitizeFeedList(parsed, origin = 'manual') {
  const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.items) ? parsed.items : []);
  return list
    .filter(item => item && item.enabled !== false && typeof item.title === 'string' && safeHttpUrl(item.url))
    .map((item, index) => ({
      id: String(item.id || `${origin}-feed-${index + 1}`).slice(0, 80),
      type: typeof item.type === 'string' ? item.type.trim().slice(0, 30) : 'utility',
      badge: typeof item.badge === 'string' ? item.badge.trim().slice(0, 20) : '정보',
      icon: typeof item.icon === 'string' ? item.icon.trim().slice(0, 32) : '↗',
      title: item.title.trim().slice(0, 90),
      summary: typeof item.summary === 'string' ? item.summary.trim().slice(0, 260) : '',
      url: safeHttpUrl(item.url),
      source: typeof item.source === 'string' ? item.source.trim().slice(0, 100) : '',
      publishedAt: typeof item.publishedAt === 'string' ? item.publishedAt.trim().slice(0, 20) : '',
      startsAt: typeof item.startsAt === 'string' ? item.startsAt.trim().slice(0, 35) : '',
      endsAt: typeof item.endsAt === 'string' ? item.endsAt.trim().slice(0, 35) : '',
      lastVerifiedAt: typeof item.lastVerifiedAt === 'string' ? item.lastVerifiedAt.trim().slice(0, 35) : '',
      order: Number.isFinite(Number(item.order)) ? Number(item.order) : 9999,
      pinned: item.pinned === true,
      origin
    }));
}

function feedItemActive(item, now = new Date()) {
  const startsAt = item.startsAt ? new Date(item.startsAt) : null;
  const endsAt = item.endsAt ? new Date(item.endsAt) : null;
  if (startsAt && !Number.isNaN(startsAt.valueOf()) && now < startsAt) return false;
  if (endsAt && !Number.isNaN(endsAt.valueOf()) && now > endsAt) return false;
  return true;
}

function loadPortalFeed(now = new Date()) {
  const manual = sanitizeFeedList(readJsonFile(PORTAL_FEED_FILE, []), 'manual');
  const auto = sanitizeFeedList(readJsonFile(PORTAL_AUTO_FILE, []), 'auto');
  const byUrl = new Map();
  // Manual entries win over automatically collected duplicates.
  for (const item of auto) byUrl.set(item.url, item);
  for (const item of manual) byUrl.set(item.url, item);

  // Picks 노출 순서: 직접 고정한 항목 -> 영대소식 조회수 상위(auto) -> 나머지 수동 항목.
  // 즉 광고와 고정 항목을 뺀 자리는 자동 수집분이 채운다.
  const tier = item => (item.pinned ? 0 : (item.origin === 'auto' ? 1 : 2));
  const ranked = [...byUrl.values()].filter(item => feedItemActive(item, now)).sort((a, b) => {
    const dateCmp = String(b.publishedAt || '').localeCompare(String(a.publishedAt || ''));
    return (tier(a) - tier(b)) || (a.order - b.order) || dateCmp || a.title.localeCompare(b.title, 'ko');
  });
  // order 를 최종 순위로 덮어써서, order 로 다시 정렬하는 클라이언트도 같은 순서를 본다.
  return ranked.map((item, index) => ({ ...item, order: index }));
}

function activeLocalAds(now = new Date()) {
  const parsed = readJsonFile(LOCAL_ADS_FILE, []);
  const list = Array.isArray(parsed) ? parsed : [];
  return list.filter(ad => {
    if (!ad || ad.enabled === false || !ad.title || !ad.url) return false;
    const start = ad.startsAt ? new Date(ad.startsAt) : null;
    const end = ad.endsAt ? new Date(ad.endsAt) : null;
    if (start && !Number.isNaN(start.valueOf()) && now < start) return false;
    if (end && !Number.isNaN(end.valueOf()) && now > end) return false;
    return true;
  }).map((ad, i) => ({
    id: String(ad.id || `ad-${i + 1}`).slice(0,80),
    kind: String(ad.kind || 'local').slice(0,20),
    title: String(ad.title).slice(0,100),
    subtitle: String(ad.subtitle || '').slice(0,180),
    cta: String(ad.cta || '자세히').slice(0,40),
    url: String(ad.url).startsWith('mailto:') ? String(ad.url) : safeHttpUrl(ad.url),
    image: ad.image ? safeHttpUrl(ad.image) : null,
    startsAt: ad.startsAt || null,
    endsAt: ad.endsAt || null,
    weight: Math.max(1, Math.min(100, Number(ad.weight) || 1))
  })).filter(ad => ad.url);
}

function loadPmZones() {
  const parsed = readJsonFile(PM_ZONES_FILE, []);
  return (Array.isArray(parsed) ? parsed : []).filter(x => x && x.enabled !== false && x.name).map((x,i) => ({
    id: String(x.id || `pm-${i+1}`).slice(0,80),
    name: String(x.name).slice(0,100),
    type: String(x.type || 'pm_parking').slice(0,40),
    coord: Array.isArray(x.coord) && x.coord.length === 2 && validCoord(Number(x.coord[0]), Number(x.coord[1])) ? [Number(x.coord[0]), Number(x.coord[1])] : null,
    searchAliases: Array.isArray(x.searchAliases) ? x.searchAliases.map(v => String(v).slice(0,60)).slice(0,8) : [],
    confidence: String(x.confidence || 'unknown').slice(0,30),
    note: String(x.note || '').slice(0,320),
    sourceTitle: String(x.sourceTitle || '').slice(0,120),
    sourceUrl: x.sourceUrl ? safeHttpUrl(x.sourceUrl) : null
  }));
}

function loadMetrics() {
  const parsed = readJsonFile(METRICS_FILE, {days:{}, months:{}});
  return { days: parsed?.days || {}, months: parsed?.months || {} };
}

function persistMetrics() {
  const temp = METRICS_FILE + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(metrics, null, 2) + '\n');
  fs.renameSync(temp, METRICS_FILE);
}

const METRIC_EVENTS = new Set(['route_search','guidance_start','ride_boarded','feed_click','pm_open']);
function recordMetric(type, payload = {}) {
  if (!METRIC_EVENTS.has(type)) return false;
  const { day, month } = koreaDateKeys();
  for (const [bucketName, key] of [['days',day], ['months',month]]) {
    const bucket = metrics[bucketName];
    if (!bucket[key] || typeof bucket[key] !== 'object') bucket[key] = { events: {}, destinations: {}, feedClicks: {} };
    const row = bucket[key];
    row.events[type] = (Number(row.events[type]) || 0) + 1;
    // 사용자가 자유롭게 입력한 목적지 텍스트는 저장하지 않는다.
    // 개인정보처리방침이 "개인 식별 정보 없이 횟수만 누적"이라고 약속하고 있고,
    // 무엇을 칠지 통제할 수 없어 기숙사 호실·이름 등이 들어올 수 있다.
    // 집계가 필요하면 알려진 정류장 이름과 정확히 일치할 때만 센다.
    if (type === 'route_search' && typeof payload.destination === 'string') {
      const name = payload.destination.slice(0, 40);
      if (knownStopNames().has(name)) {
        row.destinations[name] = (Number(row.destinations[name]) || 0) + 1;
      }
    }
    if (type === 'feed_click' && typeof payload.itemId === 'string') {
      const id = payload.itemId.slice(0,80);
      row.feedClicks[id] = (Number(row.feedClicks[id]) || 0) + 1;
    }
  }
  persistMetrics();
  return true;
}

// 광고 지표는 events 와 섞지 않고 ads 버킷에 광고 ID 별로 쌓는다.
// (광고주에게 "이 배너가 몇 번 보였고 몇 번 눌렸다"를 그대로 보여주기 위함)
function recordAdEvent(adId, slot, type) {
  if (!AD_EVENT_TYPES.has(type)) return false;
  const id = String(adId || '').slice(0, 80) || 'unknown';
  const slotName = AD_SLOTS.has(slot) ? slot : 'unknown';
  const { day, month } = koreaDateKeys();
  for (const [bucketName, key] of [['days', day], ['months', month]]) {
    const bucket = metrics[bucketName];
    if (!bucket[key] || typeof bucket[key] !== 'object') bucket[key] = { events: {}, destinations: {}, feedClicks: {} };
    const row = bucket[key];
    if (!row.ads || typeof row.ads !== 'object') row.ads = {};
    if (!row.ads[id]) row.ads[id] = { impressions: 0, clicks: 0, slots: {} };
    const entry = row.ads[id];
    entry[type === 'click' ? 'clicks' : 'impressions'] += 1;
    entry.slots[slotName] = (Number(entry.slots[slotName]) || 0) + 1;
  }
  persistMetrics();
  return true;
}

function adReport(fromDay, toDay, onlyId) {
  const days = Object.keys(metrics.days || {})
    .filter(d => (!fromDay || d >= fromDay) && (!toDay || d <= toDay))
    .sort();
  const totals = {};
  const daily = [];
  for (const day of days) {
    const ads = metrics.days[day]?.ads || {};
    const row = { day, ads: {} };
    for (const [id, entry] of Object.entries(ads)) {
      if (onlyId && id !== onlyId) continue;
      row.ads[id] = { impressions: Number(entry.impressions) || 0, clicks: Number(entry.clicks) || 0 };
      if (!totals[id]) totals[id] = { impressions: 0, clicks: 0 };
      totals[id].impressions += row.ads[id].impressions;
      totals[id].clicks += row.ads[id].clicks;
    }
    if (Object.keys(row.ads).length) daily.push(row);
  }
  for (const entry of Object.values(totals)) {
    entry.ctr = entry.impressions > 0 ? Number((entry.clicks / entry.impressions * 100).toFixed(2)) : 0;
  }
  return { from: fromDay || null, to: toDay || null, totals, daily };
}

// 관리자 화면에서 저장하는 지역 배너 목록. 공개 조회(activeLocalAds)와 달리
// 기간이 지난 것과 꺼둔 것도 그대로 돌려준다.
function persistLocalAds(input) {
  const list = Array.isArray(input) ? input : [];
  const cleaned = list.slice(0, 60).map((ad, index) => ({
    id: String(ad?.id || `local-${Date.now()}-${index}`).slice(0, 80),
    kind: String(ad?.kind || 'local').slice(0, 20),
    title: String(ad?.title || '').slice(0, 100),
    subtitle: String(ad?.subtitle || '').slice(0, 180),
    cta: String(ad?.cta || '자세히').slice(0, 40),
    url: typeof ad?.url === 'string' ? ad.url.slice(0, 500) : '',
    image: typeof ad?.image === 'string' && ad.image ? ad.image.slice(0, 300) : null,
    startsAt: typeof ad?.startsAt === 'string' && ad.startsAt ? ad.startsAt.slice(0, 35) : null,
    endsAt: typeof ad?.endsAt === 'string' && ad.endsAt ? ad.endsAt.slice(0, 35) : null,
    order: clampInt(ad?.order, 0, 9999, index + 1),
    weight: clampInt(ad?.weight, 1, 100, 1),
    enabled: ad?.enabled !== false
  })).filter(ad => ad.title && ad.url);
  cleaned.sort((a, b) => a.order - b.order);
  const temp = LOCAL_ADS_FILE + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(cleaned, null, 2) + '\n');
  fs.renameSync(temp, LOCAL_ADS_FILE);
  return cleaned;
}

// 의존성 없이 처리하려고 multipart 대신 data URL(base64)로 받는다.
function saveUploadedImage(dataUrl) {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!match) throw Object.assign(new Error('invalid_data_url'), { status: 400 });
  const ext = UPLOAD_TYPES.get(match[1].toLowerCase());
  if (!ext) throw Object.assign(new Error('unsupported_image_type'), { status: 415 });
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
    throw Object.assign(new Error('image_too_large'), { status: 413 });
  }
  const name = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buffer);
  return { url: `/uploads/${name}`, bytes: buffer.length };
}

// Picks 수동 항목(기획 배너 포함). 공개 목록과 달리 꺼둔 것·기간 지난 것도 그대로 준다.
function persistPortalFeed(input) {
  const list = Array.isArray(input) ? input : [];
  const cleaned = list.slice(0, 200).map((item, index) => ({
    id: String(item?.id || `manual-${Date.now()}-${index}`).slice(0, 80),
    type: String(item?.type || 'utility').slice(0, 30),
    badge: String(item?.badge || '정보').slice(0, 20),
    icon: String(item?.icon || '↗').slice(0, 32),
    title: String(item?.title || '').slice(0, 90),
    summary: String(item?.summary || '').slice(0, 260),
    url: typeof item?.url === 'string' ? item.url.slice(0, 500) : '',
    source: String(item?.source || '').slice(0, 100),
    publishedAt: String(item?.publishedAt || '').slice(0, 20),
    startsAt: item?.startsAt ? String(item.startsAt).slice(0, 35) : undefined,
    endsAt: item?.endsAt ? String(item.endsAt).slice(0, 35) : undefined,
    order: clampInt(item?.order, 0, 99999, (index + 1) * 10),
    pinned: item?.pinned === true,
    enabled: item?.enabled !== false
  })).filter(item => item.title && safeHttpUrl(item.url));
  cleaned.sort((a, b) => a.order - b.order);
  const temp = PORTAL_FEED_FILE + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(cleaned, null, 2) + '\n');
  fs.renameSync(temp, PORTAL_FEED_FILE);
  return cleaned;
}

function persistFeedSources(input) {
  const list = Array.isArray(input) ? input : [];
  const cleaned = list.slice(0, 20).map((src, index) => ({
    id: String(src?.id || `source-${index + 1}`).slice(0, 40),
    url: typeof src?.url === 'string' ? src.url.slice(0, 400) : '',
    baseUrl: typeof src?.baseUrl === 'string' ? src.baseUrl.slice(0, 200) : '',
    type: String(src?.type || 'news').slice(0, 20),
    badge: String(src?.badge || '영대소식').slice(0, 20),
    icon: String(src?.icon || '📢').slice(0, 32),
    source: String(src?.source || '영남대학교').slice(0, 60),
    pages: clampInt(src?.pages, 1, 10, 2),
    pageSize: clampInt(src?.pageSize, 1, 100, 10),
    limit: clampInt(src?.limit, 1, 60, 12),
    enabled: src?.enabled !== false
  })).filter(src => safeHttpUrl(src.url));
  const temp = FEED_SOURCES_FILE + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(cleaned, null, 2) + '\n');
  fs.renameSync(temp, FEED_SOURCES_FILE);
  return cleaned;
}

let refreshRunning = false;
// 관리자 화면의 "지금 수집" 버튼. 수집기는 독립 스크립트라 자식 프로세스로 돌린다.
function runFeedRefresh() {
  if (refreshRunning) return Promise.resolve({ ok: false, error: 'already_running' });
  refreshRunning = true;
  return new Promise(resolve => {
    execFile(process.execPath, [path.join(ROOT, 'scripts', 'refresh-yu-feed.js')], {
      cwd: ROOT,
      env: { ...process.env, CAMBUS_DATA_DIR: DATA_DIR },
      timeout: 90_000,
      maxBuffer: 512 * 1024
    }, (error, stdout, stderr) => {
      refreshRunning = false;
      const log = String(stdout || '').trim() + (stderr ? '\n' + String(stderr).trim() : '');
      resolve({ ok: !error, log: log.slice(-4000), error: error ? (error.message || 'refresh_failed') : null });
    });
  });
}

function adminOverview() {
  const { day, month } = koreaDateKeys();
  const visitors = visitorCounts();
  const todayAds = metrics.days?.[day]?.ads || {};
  let impressions = 0, clicks = 0;
  for (const entry of Object.values(todayAds)) {
    impressions += Number(entry.impressions) || 0;
    clicks += Number(entry.clicks) || 0;
  }
  const manual = readJsonFile(PORTAL_FEED_FILE, []);
  const auto = readJsonFile(PORTAL_AUTO_FILE, []);
  const stops = loadRouteStops();
  return {
    day, month,
    visitors,
    events: { day: metrics.days?.[day]?.events || {}, month: metrics.months?.[month]?.events || {} },
    ads: { impressions, clicks, ctr: impressions ? Number((clicks / impressions * 100).toFixed(2)) : 0 },
    feed: {
      manual: Array.isArray(manual) ? manual.length : 0,
      pinned: Array.isArray(manual) ? manual.filter(x => x?.pinned).length : 0,
      auto: Array.isArray(auto) ? auto.length : 0,
      autoUpdatedAt: Array.isArray(auto) && auto.length ? (auto[0]?.publishedAt || null) : null
    },
    routes: Object.fromEntries(Object.entries(stops.routes || {}).map(([id, r]) => [id, (r.stops || []).length])),
    adProvider: publicAdConfig().provider,
    dataDir: DATA_DIR
  };
}

/**
 * 순환버스가 실제로 구간을 지나는 데 걸린 시간을 모읍니다.
 *
 * 개인정보 설계상 중요한 점:
 *  - 좌표를 받지 않습니다. 클라이언트가 구간 번호와 걸린 초만 보냅니다.
 *  - 이용자 식별자를 붙이지 않습니다. 표본끼리 같은 사람인지 알 수 없습니다.
 *  - 남는 것은 구간별 통계(표본 수, 중앙값 등)뿐이라 개인 이동 경로가 복원되지 않습니다.
 * 이렇게 모은 중앙값은 route-timings.json 의 legs 값으로 그대로 쓸 수 있습니다.
 */
function loadLegStats() {
  const raw = readJsonFile(LEG_STATS_FILE, {});
  return (raw && typeof raw === 'object' && raw.routes) ? raw : { version: 1, updatedAt: null, routes: {} };
}

function persistLegStats(stats) {
  const temp = LEG_STATS_FILE + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(stats, null, 2) + '\n');
  fs.renameSync(temp, LEG_STATS_FILE);
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function recordLegSample(routeId, type, index, seconds) {
  if (!ROUTES.has(routeId) || !LEG_SAMPLE_TYPES.has(type)) return false;
  const idx = Number(index);
  const value = Math.round(Number(seconds));
  if (!Number.isInteger(idx) || idx < 0 || idx > 60) return false;
  if (!Number.isFinite(value) || value < LEG_SECONDS_MIN || value > LEG_SECONDS_MAX) return false;

  const stats = loadLegStats();
  if (!stats.routes[routeId]) stats.routes[routeId] = { travel: {}, dwell: {} };
  const bucket = stats.routes[routeId][type] || (stats.routes[routeId][type] = {});
  const key = String(idx);
  if (!bucket[key]) bucket[key] = { samples: [], count: 0, updatedAt: null };
  const entry = bucket[key];
  entry.samples.push(value);
  if (entry.samples.length > LEG_SAMPLE_KEEP) entry.samples.shift();
  entry.count += 1;
  entry.updatedAt = new Date().toISOString();
  stats.updatedAt = entry.updatedAt;
  persistLegStats(stats);
  return true;
}

/** 관리자 화면에 보여줄 요약: 구간별 표본 수와 중앙값, 현재 저장된 값 비교. */
function legStatsSummary() {
  const stats = loadLegStats();
  const timings = loadRouteTimings();
  const stopData = loadRouteStops();
  const out = { updatedAt: stats.updatedAt, routes: {} };
  for (const routeId of ROUTES) {
    const stops = stopData.routes?.[routeId]?.stops || [];
    const legCount = Math.max(0, stops.length - 1);
    const saved = timings.routes?.[routeId]?.legs || [];
    const travel = stats.routes?.[routeId]?.travel || {};
    const dwell = stats.routes?.[routeId]?.dwell || {};
    out.routes[routeId] = {
      legs: Array.from({ length: legCount }, (_, i) => {
        const entry = travel[String(i)];
        return {
          index: i,
          from: stops[i]?.name || '',
          to: stops[i + 1]?.name || '',
          savedSeconds: saved[i] ?? null,
          samples: entry ? entry.count : 0,
          medianSeconds: entry ? median(entry.samples) : null
        };
      }),
      dwell: Object.entries(dwell).map(([key, entry]) => ({
        index: Number(key),
        stop: stops[Number(key)]?.name || '',
        samples: entry.count,
        medianSeconds: median(entry.samples)
      })).sort((a, b) => a.index - b.index)
    };
  }
  return out;
}

/** 실측 중앙값을 route-timings.json 에 반영합니다(표본이 minSamples 이상인 구간만). */
function applyMeasuredTimings(minSamples = 3) {
  const summary = legStatsSummary();
  const current = loadRouteTimings();
  const next = { version: 1, updatedAt: new Date().toISOString(), routes: {} };
  let applied = 0;
  for (const routeId of ROUTES) {
    const legs = summary.routes[routeId]?.legs || [];
    const saved = current.routes?.[routeId]?.legs || [];
    next.routes[routeId] = {
      source: 'field-measured-from-riders',
      legs: legs.map((leg, i) => {
        if (leg.samples >= minSamples && leg.medianSeconds != null) { applied += 1; return leg.medianSeconds; }
        return saved[i] ?? null;
      })
    };
  }
  const validated = validatedRouteTimings(next);
  persistRouteTimings(validated);
  return { applied, timings: validated };
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
    return json(res, 200, { ok: true, service: 'cambus', version: appVersion(), adProvider: publicAdConfig().provider, now: new Date().toISOString() });
  }
  if (req.method === 'GET' && pathname === '/api/ad-config') {
    return json(res, 200, publicAdConfig());
  }
  if (req.method === 'GET' && pathname === '/api/live-buses') {
    return json(res, 200, { buses: liveBusAggregates() });
  }
  // 시내버스(TAGO) 프록시 — 인증키는 서버 환경변수에만 두고 클라이언트로 내려보내지 않습니다.
  if (req.method === 'GET' && pathname === '/api/city-bus/config') {
    return json(res, 200, { enabled: transitApi.isConfigured() });
  }
  if (req.method === 'GET' && pathname === '/api/city-bus/stops') {
    if (!allowUpstream(req)) return json(res, 429, { error: 'rate_limited' });
    const lat = Number(new URL(req.url, 'http://localhost').searchParams.get('lat'));
    const lng = Number(new URL(req.url, 'http://localhost').searchParams.get('lng'));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return json(res, 400, { error: 'bad_coords' });
    try {
      return json(res, 200, { stops: await transitApi.nearbyStops(lat, lng) });
    } catch (error) {
      return json(res, 502, { error: error.code || 'tago_error', message: error.message });
    }
  }
  if (req.method === 'GET' && pathname === '/api/city-bus/direct') {
    if (!allowUpstream(req)) return json(res, 429, { error: 'rate_limited' });
    const params = new URL(req.url, 'http://localhost').searchParams;
    const fromLat = Number(params.get('fromLat')), fromLng = Number(params.get('fromLng'));
    const toLat = Number(params.get('toLat')), toLng = Number(params.get('toLng'));
    if (![fromLat, fromLng, toLat, toLng].every(Number.isFinite)) return json(res, 400, { error: 'bad_coords' });
    try {
      return json(res, 200, { routes: await transitApi.directRoutes(fromLat, fromLng, toLat, toLng) });
    } catch (error) {
      return json(res, 502, { error: error.code || 'tago_error', message: error.message });
    }
  }
  if (req.method === 'GET' && pathname === '/api/city-bus/arrivals') {
    if (!allowUpstream(req)) return json(res, 429, { error: 'rate_limited' });
    const params = new URL(req.url, 'http://localhost').searchParams;
    const cityCode = params.get('cityCode');
    const nodeId = params.get('nodeId');
    if (!cityCode || !nodeId) return json(res, 400, { error: 'missing_params' });
    try {
      return json(res, 200, { arrivals: await transitApi.arrivals(cityCode, nodeId) });
    } catch (error) {
      return json(res, 502, { error: error.code || 'tago_error', message: error.message });
    }
  }
  if (req.method === 'GET' && pathname === '/api/crowding') {
    return json(res, 200, { crowding: crowdingAggregates() });
  }
  if (req.method === 'GET' && pathname === '/api/portal-feed') {
    return json(res, 200, { items: loadPortalFeed() });
  }
  if (req.method === 'GET' && pathname === '/api/local-ads') {
    return json(res, 200, { ads: activeLocalAds() });
  }
  if (req.method === 'GET' && pathname === '/api/pm-zones') {
    return json(res, 200, { zones: loadPmZones() });
  }
  if (req.method === 'GET' && pathname === '/api/route-stops') {
    return json(res, 200, loadRouteStops());
  }
  if (req.method === 'GET' && pathname === '/api/route-paths') {
    return json(res, 200, readJsonFile(ROUTE_PATHS_FILE, { version: 1, routes: {} }));
  }
  if (req.method === 'GET' && pathname === '/api/route-timings') {
    return json(res, 200, loadRouteTimings());
  }
  if (req.method === 'GET' && pathname === '/api/metrics') {
    const { day, month } = koreaDateKeys();
    return json(res, 200, { day: metrics.days[day] || {}, month: metrics.months[month] || {} });
  }
  if (req.method === 'GET' && pathname === '/api/visitors') {
    return json(res, 200, visitorCounts());
  }

  if (req.method === 'POST' && pathname === '/api/visit') {
    const body = await readJson(req);
    if (!validToken(body.visitorToken)) return json(res, 400, { error: 'invalid_visitor_token' });
    return json(res, 200, registerVisitor(body.visitorToken));
  }

  if (req.method === 'POST' && pathname === '/api/event') {
    const body = await readJson(req);
    if (!METRIC_EVENTS.has(body.type)) return json(res, 400, { error: 'invalid_event' });
    recordMetric(body.type, body.payload && typeof body.payload === 'object' ? body.payload : {});
    return json(res, 202, { ok: true });
  }

  if (req.method === 'POST' && pathname === '/api/leg-sample') {
    const body = await readJson(req);
    const saved = recordLegSample(body.routeId, body.type, body.index, body.seconds);
    return json(res, saved ? 202 : 400, saved ? { ok: true } : { error: 'invalid_leg_sample' });
  }

  if (req.method === 'GET' && pathname === '/api/admin/leg-stats') {
    if (!requireAdmin(req, res)) return;
    return json(res, 200, legStatsSummary());
  }

  if (req.method === 'POST' && pathname === '/api/admin/apply-timings') {
    if (!requireAdmin(req, res)) return;
    const body = await readJson(req);
    const minSamples = clampInt(body.minSamples, 1, 50, 3);
    return json(res, 200, { ok: true, ...applyMeasuredTimings(minSamples) });
  }

  if (req.method === 'POST' && pathname === '/api/ad-event') {
    const body = await readJson(req);
    if (!AD_EVENT_TYPES.has(body.type)) return json(res, 400, { error: 'invalid_ad_event' });
    recordAdEvent(body.adId, body.slot, body.type);
    return json(res, 202, { ok: true });
  }

  if (req.method === 'GET' && pathname === '/api/ad-report') {
    if (!requireAdmin(req, res)) return;
    const params = new URL(req.url, 'http://localhost').searchParams;
    return json(res, 200, adReport(params.get('from') || '', params.get('to') || '', params.get('id') || ''));
  }

  if (req.method === 'GET' && pathname === '/api/admin/session') {
    if (!requireAdmin(req, res)) return;
    return json(res, 200, { ok: true, tokenRequired: Boolean(process.env.CAMBUS_ADMIN_TOKEN) });
  }

  if (req.method === 'GET' && pathname === '/api/admin/overview') {
    if (!requireAdmin(req, res)) return;
    return json(res, 200, adminOverview());
  }

  if (req.method === 'GET' && pathname === '/api/admin/portal-feed') {
    if (!requireAdmin(req, res)) return;
    const parsed = readJsonFile(PORTAL_FEED_FILE, []);
    return json(res, 200, { items: Array.isArray(parsed) ? parsed : [] });
  }

  if (req.method === 'POST' && pathname === '/api/admin/portal-feed') {
    if (!requireAdmin(req, res)) return;
    const body = await readJson(req, MAX_EDITOR_BODY);
    return json(res, 200, { ok: true, items: persistPortalFeed(body.items) });
  }

  if (req.method === 'GET' && pathname === '/api/admin/feed-sources') {
    if (!requireAdmin(req, res)) return;
    const parsed = readJsonFile(FEED_SOURCES_FILE, []);
    return json(res, 200, { sources: Array.isArray(parsed) ? parsed : [] });
  }

  if (req.method === 'POST' && pathname === '/api/admin/feed-sources') {
    if (!requireAdmin(req, res)) return;
    const body = await readJson(req, MAX_EDITOR_BODY);
    return json(res, 200, { ok: true, sources: persistFeedSources(body.sources) });
  }

  if (req.method === 'POST' && pathname === '/api/admin/refresh-feed') {
    if (!requireAdmin(req, res)) return;
    const out = await runFeedRefresh();
    const auto = readJsonFile(PORTAL_AUTO_FILE, []);
    return json(res, out.ok ? 200 : 409, { ...out, collected: Array.isArray(auto) ? auto.length : 0 });
  }

  if (req.method === 'GET' && pathname === '/api/admin/local-ads') {
    if (!requireAdmin(req, res)) return;
    const parsed = readJsonFile(LOCAL_ADS_FILE, []);
    return json(res, 200, { ads: Array.isArray(parsed) ? parsed : [] });
  }

  if (req.method === 'POST' && pathname === '/api/admin/local-ads') {
    if (!requireAdmin(req, res)) return;
    const body = await readJson(req, MAX_EDITOR_BODY);
    return json(res, 200, { ok: true, ads: persistLocalAds(body.ads) });
  }

  if (req.method === 'POST' && pathname === '/api/admin/ad-layout') {
    if (!requireAdmin(req, res)) return;
    const body = await readJson(req);
    return json(res, 200, { ok: true, layout: persistAdLayout(body) });
  }

  if (req.method === 'POST' && pathname === '/api/admin/upload') {
    if (!requireAdmin(req, res)) return;
    const body = await readJson(req, MAX_UPLOAD_BODY);
    return json(res, 200, { ok: true, ...saveUploadedImage(body.dataUrl) });
  }

  if (req.method === 'POST' && pathname === '/api/route-stops') {
    if (!requireAdmin(req, res)) return;
    const body = await readJson(req);
    const saved = validatedRouteStops(body);
    persistRouteStops(saved);
    return json(res, 200, { ok: true, updatedAt: saved.updatedAt, routes: saved.routes });
  }

  if (req.method === 'POST' && pathname === '/api/route-paths') {
    if (!requireAdmin(req, res)) return;
    const saved = validatedRoutePaths(await readJson(req, MAX_EDITOR_BODY));
    persistRoutePaths(saved);
    return json(res, 200, { ok: true, updatedAt: saved.updatedAt, routes: saved.routes });
  }

  if (req.method === 'POST' && pathname === '/api/route-timings') {
    if (!requireAdmin(req, res)) return;
    const saved = validatedRouteTimings(await readJson(req));
    persistRouteTimings(saved);
    return json(res, 200, { ok: true, updatedAt: saved.updatedAt, routes: saved.routes });
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

// 프로젝트 루트를 통째로 노출하면 server.js(인증 로직), Dockerfile, data/ 의 방문자
// 통계까지 공개된다. 브라우저가 실제로 받아야 하는 것만 허용한다.
const PUBLIC_FILES = new Set([
  'index.html', 'styles.css', 'app.js', 'portal.js', 'ads.js', 'map-ui.js',
  'install.js', 'route-utils.js', 'subway-router.js', 'sw.js',
  'manifest.webmanifest', 'privacy.html',
  // 관리자 콘솔. 로그인 폼 외에는 아무것도 보여주지 않고, 모든 관리 API 는
  // CAMBUS_ADMIN_TOKEN 없이는 401 이다. 운영에서 못 열면 존재 이유가 없어 공개한다.
  'admin.html',
  'icon.svg', 'icon-192.png', 'icon-512.png',
  'icon-192-maskable.png', 'icon-512-maskable.png', 'apple-touch-icon.png',
  'vendor/leaflet.js', 'vendor/leaflet.css',
  'data/route-stops.json', 'data/route-paths.json', 'data/route-timings.json',
  'data/subway-daegu.json', 'data/portal-feed.json', 'data/portal-auto.json',
  'data/local-ads.json', 'data/pm-zones.json'
]);
// 로컬 편집 도구는 운영에 배포하지 않는다.
const DEV_ONLY_FILES = new Set([
  'stop-editor.html', 'stop-editor.css', 'stop-editor.js',
  'path-editor.html', 'path-editor.css', 'path-editor.js',
  'route-guide-r1.png', 'route-guide-r2.png'
]);

function publiclyServable(relPath) {
  if (PUBLIC_FILES.has(relPath)) return true;
  if (relPath.startsWith('vendor/images/')) return true;   // Leaflet 마커 이미지
  if (DEV_ONLY_FILES.has(relPath)) return process.env.CAMBUS_DEV === '1';
  return false;
}

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  try { rel = decodeURIComponent(rel); } catch { return json(res, 400, { error: 'bad_path' }); }
  const file = path.resolve(ROOT, '.' + rel);
  if (!file.startsWith(ROOT + path.sep)) return json(res, 403, { error: 'forbidden' });
  const relKey = path.relative(ROOT, file).split(path.sep).join('/');
  if (!publiclyServable(relKey)) return json(res, 404, { error: 'not_found' });
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

function serveUpload(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname.slice('/uploads/'.length)); } catch { return json(res, 400, { error: 'bad_path' }); }
  // 경로 조작으로 볼륨 밖 파일을 읽지 못하게 파일명만 허용한다.
  if (!rel || rel !== path.basename(rel)) return json(res, 403, { error: 'forbidden' });
  const file = path.join(UPLOAD_DIR, rel);
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    const type = mime[path.extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=86400' });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  setSecurityHeaders(res);
  try {
    if (req.method === 'GET' && url.pathname === '/ads.txt') {
      const target = adsTxtRedirect();
      if (target) {
        res.writeHead(302, { Location: target, 'Cache-Control': 'no-store' });
        return res.end();
      }
    }
    if (url.pathname.startsWith('/api/')) return await api(req, res, url.pathname);
    // 업로드 배너는 프로젝트가 아니라 데이터 볼륨에 있으므로 따로 내보낸다.
    if (url.pathname.startsWith('/uploads/')) return serveUpload(req, res, url.pathname);
    return serveStatic(req, res, url.pathname);
  } catch (e) {
    console.error(e);
    return json(res, e.status || 500, { error: e.message || 'server_error' });
  }
});

server.listen(PORT, () => {
  console.log(`CamBus running at http://localhost:${PORT}`);
  console.log(`Portal feed files: ${PORTAL_FEED_FILE}, ${PORTAL_AUTO_FILE}`);
  console.log('Crowd telemetry stays in memory; visitor counts are stored as token hashes only.');
});
