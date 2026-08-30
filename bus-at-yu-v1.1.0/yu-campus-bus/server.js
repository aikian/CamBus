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
const TELEMETRY_TTL_MS = 120_000;
const CROWD_TTL_MS = 30 * 60_000;
const MAX_BODY = 16 * 1024;
const MAX_EDITOR_BODY = 2 * 1024 * 1024;
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

function allow(req, limit = 120) {
  const ip = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  let row = rate.get(ip);
  if (!row || row.windowStart + 60_000 <= now) row = { windowStart: now, count: 0 };
  row.count += 1;
  rate.set(ip, row);
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
    networkScriptsReady: String(process.env.CAMBUS_EZOIC_HEADER_READY || '').toLowerCase() === 'true'
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

function loadRouteStops() {
  return readJsonFile(ROUTE_STOPS_FILE, { version: 1, updatedAt: null, routes: {} });
}

function loopbackRequest(req) {
  const address = String(req.socket.remoteAddress || '').toLowerCase();
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
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
    if (type === 'route_search' && typeof payload.destination === 'string' && payload.destination && payload.destination !== '지도에서 선택한 위치') {
      const d = payload.destination.slice(0,80);
      row.destinations[d] = (Number(row.destinations[d]) || 0) + 1;
    }
    if (type === 'feed_click' && typeof payload.itemId === 'string') {
      const id = payload.itemId.slice(0,80);
      row.feedClicks[id] = (Number(row.feedClicks[id]) || 0) + 1;
    }
  }
  persistMetrics();
  return true;
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
    return json(res, 200, { ok: true, service: 'cambus', version: '1.2.0', adProvider: publicAdConfig().provider, now: new Date().toISOString() });
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

  if (req.method === 'POST' && pathname === '/api/route-stops') {
    if (!loopbackRequest(req)) return json(res, 403, { error: 'route_editor_local_only' });
    const body = await readJson(req);
    const saved = validatedRouteStops(body);
    persistRouteStops(saved);
    return json(res, 200, { ok: true, updatedAt: saved.updatedAt, routes: saved.routes });
  }

  if (req.method === 'POST' && pathname === '/api/route-paths') {
    if (!loopbackRequest(req)) return json(res, 403, { error: 'route_editor_local_only' });
    const saved = validatedRoutePaths(await readJson(req, MAX_EDITOR_BODY));
    persistRoutePaths(saved);
    return json(res, 200, { ok: true, updatedAt: saved.updatedAt, routes: saved.routes });
  }

  if (req.method === 'POST' && pathname === '/api/route-timings') {
    if (!loopbackRequest(req)) return json(res, 403, { error: 'route_editor_local_only' });
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
