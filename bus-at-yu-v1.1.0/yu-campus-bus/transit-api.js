/* 국토교통부 TAGO 시내버스 공개 API 서버 프록시
 *
 * 인증키는 반드시 서버 환경변수(CAMBUS_TAGO_KEY)로만 둡니다.
 * 이 앱은 PWA라서 클라이언트로 내려간 파일은 누구나 열어볼 수 있고, 키를 거기에 넣으면
 * 그대로 유출됩니다. 그래서 브라우저는 이 프록시만 호출하고 키는 서버에만 존재합니다.
 *
 * 발급: https://www.data.go.kr/  (개발계정 자동승인, 무료)
 *  - 버스도착정보  ArvlInfoInqireService     https://www.data.go.kr/data/15098530/openapi.do
 *  - 버스정류소정보 BusSttnInfoInqireService  https://www.data.go.kr/data/15098534/openapi.do
 * 두 API 각각 활용신청이 필요합니다(키는 동일).
 */
'use strict';

const BASE = 'https://apis.data.go.kr/1613000';
const TIMEOUT_MS = 6000;
const CACHE_MS = { arrivals: 20_000, stops: 6 * 60 * 60 * 1000 };

const cache = new Map();

function rawKey() {
  return (process.env.CAMBUS_TAGO_KEY || '').trim();
}

function isConfigured() {
  return rawKey().length > 0;
}

function cached(key, ttl) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  return null;
}

function store(key, value) {
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 300) cache.delete(cache.keys().next().value);
}

async function call(service, operation, params) {
  const key = rawKey();
  if (!key) throw Object.assign(new Error('tago_key_missing'), { code: 'tago_key_missing' });

  const query = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  // 포털이 주는 "일반 인증키"는 이미 URL 인코딩된 문자열입니다. 다시 인코딩하면 키가 깨집니다.
  const url = `${BASE}/${service}/${operation}?serviceKey=${key}&_type=json&${query}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch {}

  // 인증 실패는 JSON 이 아니라 OpenAPI_ServiceResponse 형태로 옵니다.
  const authMessage = body?.OpenAPI_ServiceResponse?.cmmMsgHeader?.returnAuthMsg;
  if (authMessage) throw Object.assign(new Error(authMessage), { code: 'tago_auth', service });

  const header = body?.response?.header;
  if (!response.ok || (header && header.resultCode !== '00')) {
    throw Object.assign(new Error(header?.resultMsg || `tago_http_${response.status}`), { code: 'tago_error' });
  }

  const items = body?.response?.body?.items?.item;
  return Array.isArray(items) ? items : items ? [items] : [];
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** 좌표 주변 정류소 목록. 정류소정보 API 활용신청이 되어 있어야 합니다. */
async function nearbyStops(lat, lng, rows = 20) {
  const cacheKey = `stops:${lat.toFixed(4)},${lng.toFixed(4)},${rows}`;
  const hit = cached(cacheKey, CACHE_MS.stops);
  if (hit) return hit;

  const items = await call('BusSttnInfoInqireService', 'getCrdntPrxmtSttnList', {
    gpsLati: lat, gpsLong: lng, numOfRows: rows, pageNo: 1
  });
  const stops = items.map(i => ({
    nodeId: i.nodeid,
    nodeName: i.nodenm,
    cityCode: num(i.citycode),
    coord: [num(i.gpslati), num(i.gpslong)]
  })).filter(s => s.nodeId && s.coord[0] != null);

  store(cacheKey, stops);
  return stops;
}

/** 한 정류소의 도착 예정 버스. */
async function arrivals(cityCode, nodeId, rows = 20) {
  const cacheKey = `arr:${cityCode}:${nodeId}`;
  const hit = cached(cacheKey, CACHE_MS.arrivals);
  if (hit) return hit;

  const items = await call('ArvlInfoInqireService', 'getSttnAcctoArvlPrearngeInfoList', {
    cityCode, nodeId, numOfRows: rows, pageNo: 1
  });
  const list = items.map(i => ({
    routeNo: String(i.routeno ?? ''),
    routeType: i.routetp || '',
    arrivalSeconds: num(i.arrtime),
    stopsAway: num(i.arrprevstationcnt),
    nodeName: i.nodenm || ''
  })).filter(a => a.arrivalSeconds != null)
    .sort((a, b) => a.arrivalSeconds - b.arrivalSeconds);

  store(cacheKey, list);
  return list;
}

/** 이 정류소를 지나는 노선 번호 목록. */
async function routesAtStop(cityCode, nodeId) {
  const cacheKey = `thru:${cityCode}:${nodeId}`;
  const hit = cached(cacheKey, CACHE_MS.stops);
  if (hit) return hit;

  const items = await call('BusSttnInfoInqireService', 'getSttnThrghRouteList', {
    cityCode, nodeid: nodeId, numOfRows: 200, pageNo: 1
  });
  const routes = [...new Set(items.map(i => String(i.routeno ?? '')).filter(Boolean))];
  store(cacheKey, routes);
  return routes;
}

// 시내버스 표정속도(정차 포함) 추정치. 구간 소요시간을 직선거리로 어림잡을 때 씁니다.
const CITY_BUS_MPS = 18 * 1000 / 3600;

/**
 * 출발지 주변 정류소와 목적지(캠퍼스) 주변 정류소의 "경유노선"을 교집합해서
 * 갈아타지 않고 갈 수 있는 버스를 찾습니다. 노선 전체 경로 데이터 없이도
 * "어디서 타고 어디서 내리는지"를 알 수 있습니다.
 *
 * 한계: 교집합은 두 정류소를 지난다는 사실만 알려주므로, 순환/왕복 노선에서는
 * 반대 방향일 수 있습니다. 그래서 결과를 '예상'으로 다룹니다.
 */
async function directRoutes(fromLat, fromLng, toLat, toLng, maxOriginStops = 6) {
  const [originStops, destStops] = await Promise.all([
    nearbyStops(fromLat, fromLng, 15),
    nearbyStops(toLat, toLng, 15)
  ]);
  if (!originStops.length || !destStops.length) return [];

  // 목적지 쪽: 도시코드별로 노선 -> 정류소
  const destIndex = new Map();
  for (const stop of destStops.slice(0, 4)) {
    for (const routeNo of await routesAtStop(stop.cityCode, stop.nodeId)) {
      const key = `${stop.cityCode}:${routeNo}`;
      if (!destIndex.has(key)) destIndex.set(key, stop);
    }
  }

  const results = [];
  for (const stop of originStops.slice(0, maxOriginStops)) {
    for (const routeNo of await routesAtStop(stop.cityCode, stop.nodeId)) {
      const key = `${stop.cityCode}:${routeNo}`;
      const alight = destIndex.get(key);
      if (!alight) continue;
      const metres = Math.hypot(
        (alight.coord[0] - stop.coord[0]) * 111320,
        (alight.coord[1] - stop.coord[1]) * 111320 * Math.cos(stop.coord[0] * Math.PI / 180)
      );
      results.push({
        routeNo,
        cityCode: stop.cityCode,
        board: { nodeId: stop.nodeId, name: stop.nodeName, coord: stop.coord },
        alight: { nodeId: alight.nodeId, name: alight.nodeName, coord: alight.coord },
        // 직선거리 기반이라 실제보다 짧게 나옵니다. 굽은 길을 감안해 1.35배 보정.
        rideSeconds: Math.round((metres * 1.35) / CITY_BUS_MPS)
      });
    }
  }
  // 같은 승차 정류소면 노선 번호를 묶어 하나로 보여줍니다.
  const byBoard = new Map();
  for (const r of results) {
    const key = `${r.cityCode}:${r.board.nodeId}:${r.alight.nodeId}`;
    if (!byBoard.has(key)) byBoard.set(key, { ...r, routeNos: [] });
    byBoard.get(key).routeNos.push(r.routeNo);
  }
  return [...byBoard.values()].sort((a, b) => a.rideSeconds - b.rideSeconds).slice(0, 5);
}

module.exports = { isConfigured, nearbyStops, arrivals, routesAtStop, directRoutes };
