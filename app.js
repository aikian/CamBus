/* YU Campus Move prototype
 * Primary source: user-supplied 2026-2 route list + timetable.
 * Stop positions are manually pinned from the user's annotated route images and stop descriptions,
 * then used with OpenStreetMap/OSRM for routing and estimated vehicle position.
 * Bus markers are predictions, not live GPS.
 */

const CAMPUS_CENTER = [35.8327, 128.7576];
const CAMPUS_BOUNDS = [[35.8250, 128.7493], [35.8386, 128.7639]];
const EFFECTIVE_DATE = '2026-09-01';
const DWELL_SECONDS = 5 * 60;
// 승하차 정차시간. 기점(각 노선 출발역)과 서문은 별도 정차 규칙이 있어 제외하고, 나머지
// 정류장에 일괄 적용합니다. 25인승 셔틀에서 문 열고 몇 명 타고 내리는 데 걸리는 현실적인
// 값으로 15초를 기본값으로 두었고, 실측이 들어오면 route-timings.json 쪽에서 보정합니다.
const BOARDING_SECONDS = 15;
const BOARD_NEAR_METERS = 220;
const BOARD_AT_STOP_METERS = 70;
const ALIGHT_SOON_METERS = 350;
const ALIGHT_NOW_METERS = 120;
const API_BASE = '';
const LIVE_POLL_MS = 12000;
const TELEMETRY_UPLOAD_MS = 8000;
const BUS_RENDER_MS = 5000;
const ROUTE_TIMINGS_URL = './data/route-timings.json';
const ROUTE_STOPS_URL = './data/route-stops.json';
const ROUTE_PATHS_URL = './data/route-paths.json';
const PM_ZONES_ENABLED = false;
const { canonicalStopIndex, routeLegIndices, serviceStopEntries, buildTransferStations, transferWalkSeconds } = window.CamBusRouteUtils;

const SCHEDULE = [
  '08:00','08:10','08:20','08:30','08:40','08:50',
  '09:00','09:10','09:20','09:30','09:40','09:50',
  '10:00','10:10','10:20','10:30','10:40','10:50',
  '11:00','11:20','11:40',
  '13:00','13:20','13:40','14:00','14:20','14:40',
  '15:00','15:20','15:40','16:00','16:20','16:40',
  '17:00','17:20','17:40'
];

// 테스트 전용 시간 가속 모드. URL에 ?test=1 을 붙이면 켜지며, 실제 서비스 화면 URL에는
// 절대 붙이지 않습니다. simTime(HH:MM, 기본 09:00)부터 simSpeed배(기본 30배, 최대 500배)로
// 흐르는 가상 시각을 만들어 배차표/버스 마커/정류장 ETA가 항상 움직이는 것처럼 보여줍니다.
const SIM = (() => {
  const params = new URLSearchParams(location.search);
  const isLocalDev = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
  if (params.get('test') === '0') return null;
  if (!params.has('test') && !isLocalDev) return null;
  const [h, m] = (params.get('simTime') || '09:00').split(':').map(Number);
  const speed = Math.max(1, Math.min(500, Number(params.get('simSpeed')) || 30));
  const simStart = new Date(EFFECTIVE_DATE + 'T00:00:00');
  simStart.setHours(Number.isFinite(h) ? h : 9, Number.isFinite(m) ? m : 0, 0, 0);
  return { wallStart: Date.now(), simStart, speed };
})();
function nowClock() {
  if (!SIM) return new Date();
  return new Date(SIM.simStart.getTime() + (Date.now() - SIM.wallStart) * SIM.speed);
}

const stop = (id, name, code, aliases, coord, note = '', dwell = 0, guide = '') => ({
  id, name, code, aliases, coord, note, dwell, guide
});

const ROUTES = {
  r1: {
    id: 'r1',
    name: '1노선 (인문계)',
    short: '1노선',
    color: '#e63946',
    guideImage: 'route-guide-r1.png',
    guideNote: '사용자가 보내준 손그림 경로 이미지 기준으로 정차 위치를 수동 보정했습니다.',
    stops: [
      stop('r1-1','박물관','A02',['국제교류센터','YU International Center','영남대역 4번출구','국제교류센터 주차장 입구 횡단보도'],[35.83676,128.75442],'천연잔디축구장 앞',0,'영남대역 4번출구, 대구은행, 시내·시외버스 환승'),
      stop('r1-2','사범대','B04',['사범대학','College of Education','중앙도서관','중도','중앙도서관 횡단보도'],[35.83526,128.75950],'사범대학 건너편',BOARDING_SECONDS,'사범대, 중앙도서관, 학생회관 학식, GS25, 정행대, 스타벅스'),
      stop('r1-3','음악관','A10',['음악대학','음악관','중앙테니스장','예술대학'],[35.83516,128.76131],'양방향 정차 가능 구간',BOARDING_SECONDS,'음대, 중앙테니스장, 동문 방향'),
      stop('r1-4','인문강당','B03',['인문관','인문관 강당','종강'],[35.83398,128.76029],'천마관 건너편',BOARDING_SECONDS,'인문관, 인문관강당, 종합강의동, 제2인문관'),
      stop('r1-5','인문관','B03',['인문관 정문','대학본부'],[35.83298,128.75899],'대학본부·제1과학관 방향',BOARDING_SECONDS,'인문관, 대학본부, 제1과학관 방향 이동에 유리'),
      stop('r1-6','서문','서문',['서문','인조잔디축구장','기숙사'],[35.83255,128.75190],'5분 정차 · 순환지점',DWELL_SECONDS,'기숙사, 서문, 남매지, 축구장'),
      stop('r1-7','과학관','F21',['제1과학관','정보전산원'],[35.83025,128.75749],'정보전산원 일방통행 오르막길 옆',BOARDING_SECONDS,'제1과학관, 생활과학대학, 거울못, 대학본부'),
      stop('r1-8','천마관','C03',['천마관','종합강의동','General Lecture Hall'],[35.83330,128.76082],'인문관 건너편',BOARDING_SECONDS,'천마관, 인문관 반대편 승하차 지점'),
      stop('r1-9','박물관','A02',['국제교류센터','YU International Center','영남대역 4번출구'],[35.83661,128.75466],'천연잔디축구장 건너편',0,'기점 복귀 지점')
    ]
  },
  r2: {
    id: 'r2',
    name: '2노선 (자연계)',
    short: '2노선',
    color: '#3478f6',
    guideImage: 'route-guide-r2.png',
    guideNote: '현재 공식 정류장 체계를 유지하되, 정차 위치는 손그림 이미지와 설명을 참고해 보정했습니다.',
    stops: [
      stop('r2-1','노천강당','B01',['노천강당','Amphitheater','영남대역 3번출구'],[35.83628,128.75788],'천마로 방향 · 차량출입 통제구역 끝',0,'상경관, 우체국, 영남대역 3번출구'),
      stop('r2-2','과학관','F21',['제1과학관','정보전산원'],[35.83025,128.75749],'정보전산원 일방통행 오르막길 옆',BOARDING_SECONDS,'제1과학관, 정보전산원'),
      stop('r2-3','거울못','F22',['제2과학관','생활과학대학'],[35.83006,128.75893],'생활과학대학 건너편',BOARDING_SECONDS,'제2과학관, 제3과학관, 법전원, 러브로드, 생활과학대학'),
      stop('r2-4','이도','F27',['생명응용과학대학','생명응용과학대 본관','자연계학식','이종우과학도서관','약학관'],[35.82850,128.75879],'약학관 건너편',BOARDING_SECONDS,'생명응용과학대학, 자연계 학식, 이종우과학도서관, 약대'),
      stop('r2-5','아트센터','E02',['천마아트센터','Chunma Art Center'],[35.83286,128.75262],'서문 직전 서측 정차',BOARDING_SECONDS,'천마아트센터, 서문 접근 정류장'),
      stop('r2-6','서문','서문',['서문','인조잔디축구장','기숙사'],[35.83255,128.75190],'5분 정차 · 순환지점',DWELL_SECONDS,'기숙사, 서문, 남매지, 축구장'),
      stop('r2-7','기계관','E29',['기계관','Mechanical Engineering Building','자전거 보관소'],[35.82688,128.75709],'자전거보관소 건너편',BOARDING_SECONDS,'기계관, 소재관, 자동차관, 로봇관, 후문 방향'),
      stop('r2-8','중도','B04',['중앙도서관','상경관'],[35.83548,128.75931],'상경관·정행대 접근',BOARDING_SECONDS,'중앙도서관, 상경관, 정치행정대학, 스타벅스, 중도학식'),
      stop('r2-9','노천강당','B01',['노천강당','Amphitheater','영남대역 3번출구'],[35.83635,128.75799],'천마로 방향 · 차량출입 통제구역 끝',0,'기점 복귀 지점')
    ]
  }
};

// Stops that share the school's own stop code across routes (서문, 제1과학관/F21, 중앙도서관/B04)
// are the same or an adjoining physical point, so they double as transfer stations.
const TRANSFER_STATIONS = buildTransferStations(ROUTES);
function transferStationForStop(routeId, stopInfo) {
  if (!stopInfo?.code) return null;
  return TRANSFER_STATIONS.find(st => st.code === stopInfo.code && st.members.some(m => m.routeId === routeId)) || null;
}

let MOBILITY_ZONES = [
  {
    id: 'pm-b02-bike-rack',
    name: '상경관 편의점 앞 자전거 거치대',
    type: 'pm_parking',
    coord: null,
    searchAliases: ['상경관'],
    confidence: 'building-relative',
    note: '영남대학교 2023 공지에서 전동킥보드 주차 장소로 안내. 정확한 핀은 OSM 상경관 위치를 기준으로 표시하며 현장 확인이 필요합니다.',
    sourceTitle: '전동킥보드 주차 안내',
    sourceUrl: 'https://www.yu.ac.kr/daspo/community/notice.do?articleNo=5996093&mode=view'
  }
];

const CROWD_LABELS = {
  quiet: '여유',
  normal: '보통',
  crowded: '혼잡',
  full: '만석'
};

const state = {
  user: null,
  startName: '',
  destination: null,
  destinationName: '',
  routeLayers: {},
  stopLayers: { r1: [], r2: [] },
  busLayers: [],
  userLayer: null,
  destLayer: null,
  planLayers: [],
  routeModels: {},
  layerVisibility: { route1: true, route2: true, buses: true, pmZones: false },
  pickingPoint: null,
  routeReady: false,
  activeGuidance: null,
  geoWatchId: null,
  audioContext: null,
  guidanceTimer: null,
  mobilityLayers: [],
  crowdBusLayers: [],
  crowdingByTrip: new Map(),
  liveBusByTrip: new Map(),
  livePollTimer: null,
  apiOnline: false,
  timingConfig: null,
  routePathConfig: null,
  predictedBusVisuals: new Map(),
  crowdBusVisuals: new Map(),
  departureAt: null,
  drawnRouteGeometry: {}
};

// null departureAt means "지금 출발" — planRoutes()/후속 계산은 이 값을 기준 시각으로 사용합니다.
// 지도 위 실시간 버스 위치·정류장 팝업의 다음 버스 안내는 항상 실제 현재 시각을 사용합니다.
function effectiveNow() {
  return state.departureAt || nowClock();
}

const map = L.map('map', { zoomControl: false, attributionControl: true, minZoom: 14, maxZoom: 20 })
  .setView(CAMPUS_CENTER, 16);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 20,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2600);
}

function normalize(s) {
  return (s || '').toLowerCase()
    .replace(/영남대학교/g, '영남대')
    .replace(/교내/g, '')
    .replace(/[\s·()\[\]_,-]/g, '')
    .replace(/대학교/g, '대')
    .replace(/collegeof/g, '');
}

function makeBusIcon(routeColor, label) {
  return L.divIcon({ className: '', html: `<div class="bus-dot" style="background:${routeColor}">${escapeHtml(label)}</div>`, iconSize: [16, 16], iconAnchor: [8, 8] });
}
function makeUserIcon() { return L.divIcon({ className: '', html: '<div class="user-pin"></div>', iconSize: [20, 20], iconAnchor: [10, 10] }); }
function makeDestIcon() { return L.divIcon({ className: '', html: '<div class="dest-pin"></div>', iconSize: [22, 22], iconAnchor: [7, 20] }); }
function makePmIcon() { return L.divIcon({ className: '', html: '<div class="pm-icon">P</div>', iconSize: [30,30], iconAnchor: [15,15] }); }
function makeCrowdBusIcon(routeColor, label) { return L.divIcon({ className: '', html: `<div class="crowd-bus-dot" style="background:${routeColor}">${escapeHtml(label)}</div>`, iconSize: [20, 20], iconAnchor: [10, 10] }); }

function haversine(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}

function stopEtaHtml(routeId, stopIdx) {
  const arrivals = nextArrivalsAtStop(routeId, stopIdx, nowClock(), 2);
  if (!arrivals.length) {
    const effective = new Date(EFFECTIVE_DATE + 'T00:00:00');
    return nowClock() < effective
      ? `<div class="stop-eta"><b>다음 버스</b><span>${EFFECTIVE_DATE}부터 조정 시간표 적용</span></div>`
      : '<div class="stop-eta"><b>다음 버스</b><span>오늘 남은 운행 없음</span></div>';
  }
  return `<div class="stop-eta"><b>다음 버스</b>${arrivals.map((a,i) => `<span>${i === 0 ? '약 ' + Math.max(1, Math.ceil(a.wait / 60)) + '분 후' : timeText(a.arrival)} <small>${a.departure} 출발편</small></span>`).join('')}</div>`;
}

// station.members carries name/coord captured when TRANSFER_STATIONS was built; only routeId/index
// are trustworthy long-term (a stop's own coord can be corrected later via the stop editor), so every
// distance calculation re-reads the live coordinate straight off ROUTES instead of the snapshot.
function liveStopCoord(routeId, index) {
  return ROUTES[routeId]?.stops[index]?.coord;
}

function transferBadgeHtml(routeId, stopInfo, index) {
  const station = transferStationForStop(routeId, stopInfo);
  if (!station) return '';
  const others = station.members.filter(m => m.routeId !== routeId);
  const selfCoord = liveStopCoord(routeId, index);
  const text = others.map(o => {
    const walk = transferWalkSeconds(selfCoord, liveStopCoord(o.routeId, o.index));
    const suffix = walk > 30 ? ` · 도보 약 ${Math.max(1, Math.round(walk / 60))}분` : ' · 같은 위치';
    return `${ROUTES[o.routeId].short}${suffix}`;
  }).join(', ');
  return `<div class="popup-transfer">🔄 환승 가능 · ${escapeHtml(text)}</div>`;
}

function stopPopupHtml(route, stopInfo, index) {
  return `
    <div class="popup-stop">
      <strong>${route.short} ${index + 1}. ${escapeHtml(stopInfo.name)}</strong><br>
      <span style="color:#777">${escapeHtml(stopInfo.code || '')}${stopInfo.note ? ' · ' + escapeHtml(stopInfo.note) : ''}</span>
      ${stopInfo.guide ? `<div style="margin-top:6px;line-height:1.45"><small>${escapeHtml(stopInfo.guide)}</small></div>` : ''}
      ${transferBadgeHtml(route.id, stopInfo, index)}
      ${stopEtaHtml(route.id, index)}
    </div>`;
}

// 서문/1과학관처럼 좌표가 사실상 같은(도보 30m 이내) 환승역은 지하철 노선도처럼 마커 하나로
// 합쳐서 보여줍니다. 정류장 좌표를 실제로 바꾸는 게 아니라 지도에 그리는 위치만 겹치는 것입니다.
const STOP_MERGE_METERS = 30;

function mergeableStation(routeId, stopInfo, index) {
  const station = transferStationForStop(routeId, stopInfo);
  if (!station) return null;
  const selfCoord = liveStopCoord(routeId, index);
  const allClose = station.members.every(m => haversine(selfCoord, liveStopCoord(m.routeId, m.index)) < STOP_MERGE_METERS);
  return allClose ? station : null;
}

function canonicalStationCoord(station) {
  const coords = station.members.map(m => liveStopCoord(m.routeId, m.index)).filter(Boolean);
  const lat = coords.reduce((sum, c) => sum + c[0], 0) / coords.length;
  const lng = coords.reduce((sum, c) => sum + c[1], 0) / coords.length;
  return [lat, lng];
}

function combinedStationPopupHtml(station) {
  const blocks = station.members.map(m => {
    const route = ROUTES[m.routeId];
    const stopInfo = route.stops[m.index];
    return `<div class="popup-stop-line">
      <strong style="color:${route.color}">${escapeHtml(route.short)}</strong>
      <span style="color:#777"> · ${escapeHtml(stopInfo.code || '')}${stopInfo.note ? ' · ' + escapeHtml(stopInfo.note) : ''}</span>
      ${stopEtaHtml(route.id, m.index)}
    </div>`;
  }).join('<div class="popup-divider"></div>');
  return `<div class="popup-stop popup-stop-merged">
    <strong>${escapeHtml(station.name)} <span class="popup-transfer-tag">환승역</span></strong>
    ${blocks}
  </div>`;
}

function makeStopNamePin(name, cls) {
  const label = String(name || '');
  const width = Math.max(30, label.length * 13 + 16);
  return L.divIcon({ className: '', html: `<div class="stop-pin ${cls}">${escapeHtml(label)}</div>`, iconSize: [width, 22], iconAnchor: [width / 2, 11] });
}

function renderStops() {
  for (const routeId of ['r1', 'r2']) {
    state.stopLayers[routeId].forEach(l => map.removeLayer(l));
    state.stopLayers[routeId] = [];
    const route = ROUTES[routeId];
    route.stops.forEach((s, i) => {
      // 배열의 마지막 정류장은 기점으로 되돌아오는 순환 종점(=0번과 같은 지점)이라 별도
      // 마커를 그리지 않습니다. canonicalStopIndex()가 이미 같은 지점으로 취급합니다.
      if (i === route.stops.length - 1) return;
      const station = mergeableStation(routeId, s, i);
      const coord = station ? canonicalStationCoord(station) : s.coord;
      const icon = station
        ? makeStopNamePin(station.name, 'stop-both')
        : makeStopNamePin(s.name, routeId === 'r1' ? 'stop-r1' : 'stop-r2');
      const popupFn = station ? () => combinedStationPopupHtml(station) : () => stopPopupHtml(route, s, i);
      const marker = L.marker(coord, { icon }).bindPopup(popupFn);
      if (state.layerVisibility[routeId === 'r1' ? 'route1' : 'route2']) marker.addTo(map);
      state.stopLayers[routeId].push(marker);
    });
  }
}

async function loadRouteTimingConfig() {
  try {
    let res = await fetch(API_BASE + '/api/route-timings', { cache: 'no-store' });
    if (!res.ok) res = await fetch(ROUTE_TIMINGS_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`timings ${res.status}`);
    state.timingConfig = await res.json();
  } catch (e) {
    console.warn('Route timing config unavailable; using OSRM durations.', e);
    state.timingConfig = null;
  }
}

async function loadRoutePathConfig() {
  try {
    let response = await fetch(API_BASE + '/api/route-paths', { cache: 'no-store' });
    if (!response.ok) response = await fetch(ROUTE_PATHS_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`route paths ${response.status}`);
    state.routePathConfig = await response.json();
  } catch (error) {
    console.warn('Saved route paths unavailable; using OSRM.', error);
    state.routePathConfig = null;
  }
}

function calibratedLegSeconds(routeId, legIndex, fallback) {
  const value = Number(state.timingConfig?.routes?.[routeId]?.legs?.[legIndex]);
  return Number.isFinite(value) && value > 10 && value < 1800 ? value : fallback;
}

async function loadRouteStopOverrides() {
  try {
    let response = await fetch(API_BASE + '/api/route-stops', { cache: 'no-store' });
    if (!response.ok) response = await fetch(ROUTE_STOPS_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`route stops ${response.status}`);
    const data = await response.json();
    for (const routeId of ['r1', 'r2']) {
      const saved = Array.isArray(data?.routes?.[routeId]?.stops) ? data.routes[routeId].stops : [];
      const savedById = new Map(saved.map(stopInfo => [String(stopInfo?.id || ''), stopInfo]));
      ROUTES[routeId].stops.forEach(stopInfo => {
        const coord = savedById.get(stopInfo.id)?.coord;
        const lat = Number(coord?.[0]);
        const lng = Number(coord?.[1]);
        if (Number.isFinite(lat) && Number.isFinite(lng) &&
            lat >= 35.8200 && lat <= 35.8420 && lng >= 128.7460 && lng <= 128.7680) {
          stopInfo.coord = [lat, lng];
        }
      });
    }
  } catch (error) {
    console.warn('Saved route stops unavailable; using bundled coordinates.', error);
  }
}

async function loadMobilityZoneData() {
  try {
    let res = await fetch(API_BASE + '/api/pm-zones', { cache: 'no-store' });
    if (!res.ok) res = await fetch('./data/pm-zones.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`pm zones ${res.status}`);
    const data = await res.json();
    const rows = Array.isArray(data) ? data : data.zones;
    if (Array.isArray(rows) && rows.length) MOBILITY_ZONES = rows;
  } catch (e) {
    console.warn('PM zone data load failed; using bundled fallback.', e);
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 7000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function buildRouteModel(route) {
  const savedModel = buildSavedRouteModel(route);
  if (savedModel) return savedModel;
  const coords = route.stops.map(s => `${s.coord[1]},${s.coord[0]}`).join(';');
  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true&annotations=false&continue_straight=false`;
  try {
    const res = await fetchWithTimeout(url, {}, 8000);
    const data = await res.json();
    if (!res.ok || data.code !== 'Ok' || !data.routes?.[0]) throw new Error(data.message || data.code || 'route fail');
    const r = data.routes[0];
    const legs = r.legs.map((leg, i) => {
      const coords = [];
      (leg.steps || []).forEach(step => {
        const c = step.geometry?.coordinates || [];
        c.forEach(p => coords.push([p[1], p[0]]));
      });
      if (!coords.length) coords.push(route.stops[i].coord, route.stops[i + 1].coord);
      return { duration: calibratedLegSeconds(route.id, i, leg.duration), osrmDuration: leg.duration, distance: leg.distance, coords };
    });
    const offsets = [0];
    let elapsed = 0;
    for (let i = 0; i < legs.length; i++) {
      elapsed += legs[i].duration;
      const arrivedStop = route.stops[i + 1];
      if (arrivedStop?.dwell) elapsed += arrivedStop.dwell;
      offsets.push(elapsed);
    }
    return {
      ok: true,
      duration: elapsed,
      distance: r.distance,
      geometry: r.geometry.coordinates.map(p => [p[1], p[0]]),
      legs,
      offsets
    };
  } catch (e) {
    console.warn('Bus route model failed', route.id, e);
    return { ok: false, error: e };
  }
}

function buildSavedRouteModel(route) {
  const saved = state.routePathConfig?.routes?.[route.id];
  if (!saved || !Array.isArray(saved.stopIds) || !Array.isArray(saved.legs) || !Array.isArray(saved.geometry)) return null;
  if (saved.stopIds.length !== route.stops.length || saved.legs.length !== route.stops.length - 1) return null;
  if (!route.stops.every((stopInfo, index) => saved.stopIds[index] === stopInfo.id)) return null;
  if (!Array.isArray(saved.stopCoords) || saved.stopCoords.some((coord, index) =>
    !Array.isArray(coord) || haversine(coord, route.stops[index].coord) > 35)) return null;

  const legs = [];
  for (let index = 0; index < saved.legs.length; index++) {
    const leg = saved.legs[index];
    if (leg.fromId !== route.stops[index].id || leg.toId !== route.stops[index + 1].id ||
        !Array.isArray(leg.geometry) || leg.geometry.length < 2) return null;
    const osrmDuration = Number(leg.duration);
    const distance = Number(leg.distance);
    if (!Number.isFinite(osrmDuration) || osrmDuration <= 0 || !Number.isFinite(distance) || distance < 0) return null;
    legs.push({
      duration: calibratedLegSeconds(route.id, index, osrmDuration),
      osrmDuration,
      distance,
      coords: leg.geometry
    });
  }

  const offsets = [0];
  let elapsed = 0;
  for (let index = 0; index < legs.length; index++) {
    elapsed += legs[index].duration;
    if (route.stops[index + 1]?.dwell) elapsed += route.stops[index + 1].dwell;
    offsets.push(elapsed);
  }
  return {
    ok: true,
    source: 'saved-route-path',
    duration: elapsed,
    distance: Number(saved.distance) || legs.reduce((sum, leg) => sum + leg.distance, 0),
    geometry: saved.geometry,
    legs,
    offsets
  };
}

// 1노선·2노선이 둘 다 보일 때만 겹치는 구간을 좌우로 살짝 벌립니다. 버스 점도 같은 오프셋을
// 써야 지도 위에서 그려진 선과 어긋나 보이지 않습니다 (predictedPoint()에서 재사용).
function routeOffsetPixels(routeId) {
  const bothRoutesVisible = state.layerVisibility.route1 && state.layerVisibility.route2 &&
    state.routeModels.r1?.ok && state.routeModels.r2?.ok;
  if (!bothRoutesVisible) return 0;
  return routeId === 'r1' ? -4.5 : 4.5;
}

function renderRoute(routeId) {
  const key = routeId === 'r1' ? 'route1' : 'route2';
  if (state.routeLayers[routeId]) map.removeLayer(state.routeLayers[routeId]);
  const model = state.routeModels[routeId];
  const route = ROUTES[routeId];
  if (!model?.ok) return;
  const offset = routeOffsetPixels(routeId);
  const otherRouteId = routeId === 'r1' ? 'r2' : 'r1';
  const geometry = offsetRouteGeometry(model.geometry, offset, state.routeModels[otherRouteId]?.geometry);
  state.drawnRouteGeometry[routeId] = geometry;
  const casing = L.polyline(geometry, {
    color: '#ffffff', weight: 10, opacity: .9, lineCap: 'round', lineJoin: 'round', interactive: false
  });
  const colorLine = L.polyline(geometry, {
    color: route.color, weight: 6, opacity: .94, lineCap: 'round', lineJoin: 'round', interactive: false
  });
  const layer = L.layerGroup([casing, colorLine]);
  if (state.layerVisibility[key]) layer.addTo(map);
  state.routeLayers[routeId] = layer;
}

// Keep both route colors visible only where their strokes would overlap on screen.
// Segment normals are canonicalized so opposite travel directions still offset to opposite sides.
function offsetRouteGeometry(coords, pixels, otherCoords) {
  if (!pixels || !coords?.length || coords.length < 2) return coords;
  const zoom = map.getZoom();
  const points = coords.map(coord => map.project(L.latLng(coord[0], coord[1]), zoom));
  const otherPoints = (otherCoords || []).map(coord => map.project(L.latLng(coord[0], coord[1]), zoom));
  if (otherPoints.length < 2) return coords;
  const normals = [];

  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    const dy = points[i + 1].y - points[i].y;
    const length = Math.hypot(dx, dy);
    if (length < .001) {
      normals.push(normals.at(-1) || { x: 0, y: 1 });
      continue;
    }
    let x = -dy / length;
    let y = dx / length;
    if (y < 0 || (Math.abs(y) < .0001 && x < 0)) {
      x *= -1;
      y *= -1;
    }
    normals.push({ x, y });
  }

  const overlapWeights = points.map((point, index) => {
    const tangentStart = points[Math.max(0, index - 1)];
    const tangentEnd = points[Math.min(points.length - 1, index + 1)];
    const tangentX = tangentEnd.x - tangentStart.x;
    const tangentY = tangentEnd.y - tangentStart.y;
    const tangentLength = Math.hypot(tangentX, tangentY);
    if (tangentLength < .001) return 0;
    let nearestParallel = Infinity;

    for (let i = 0; i < otherPoints.length - 1; i++) {
      const start = otherPoints[i];
      const end = otherPoints[i + 1];
      const segmentX = end.x - start.x;
      const segmentY = end.y - start.y;
      const segmentLength = Math.hypot(segmentX, segmentY);
      if (segmentLength < .001) continue;
      const parallel = Math.abs((tangentX * segmentX + tangentY * segmentY) /
        (tangentLength * segmentLength));
      if (parallel < .88) continue;

      const projection = Math.max(0, Math.min(1,
        ((point.x - start.x) * segmentX + (point.y - start.y) * segmentY) /
        (segmentLength * segmentLength)
      ));
      const closestX = start.x + segmentX * projection;
      const closestY = start.y + segmentY * projection;
      nearestParallel = Math.min(nearestParallel, Math.hypot(point.x - closestX, point.y - closestY));
    }

    // A six-pixel stroke starts visually covering the other line at about this distance.
    return Math.max(0, Math.min(1, (8 - nearestParallel) / 4));
  });

  const smoothedWeights = overlapWeights.map((_, index) => {
    let weighted = 0;
    let total = 0;
    for (let offset = -2; offset <= 2; offset++) {
      const sampleIndex = index + offset;
      if (sampleIndex < 0 || sampleIndex >= overlapWeights.length) continue;
      const weight = 3 - Math.abs(offset);
      weighted += overlapWeights[sampleIndex] * weight;
      total += weight;
    }
    return total ? weighted / total : 0;
  });

  return points.map((point, index) => {
    const before = normals[Math.max(0, index - 1)];
    const after = normals[Math.min(normals.length - 1, index)];
    let x = before.x + after.x;
    let y = before.y + after.y;
    const length = Math.hypot(x, y);
    if (length < .001) {
      x = after.x;
      y = after.y;
    } else {
      x /= length;
      y /= length;
    }
    const localOffset = pixels * smoothedWeights[index];
    const shifted = map.unproject(L.point(point.x + x * localOffset, point.y + y * localOffset), zoom);
    return [shifted.lat, shifted.lng];
  });
}

async function initializeRoutes() {
  updateStatus('loading');
  const configLoads = [loadRouteTimingConfig(), loadRoutePathConfig()];
  if (PM_ZONES_ENABLED) configLoads.push(loadMobilityZoneData());
  await Promise.all(configLoads);
  renderStops();
  const [r1, r2] = await Promise.all([buildRouteModel(ROUTES.r1), buildRouteModel(ROUTES.r2)]);
  state.routeModels.r1 = r1;
  state.routeModels.r2 = r2;
  renderRoute('r1');
  renderRoute('r2');
  state.routeReady = r1.ok && r2.ok;
  updateStatus(state.routeReady ? 'ready' : 'partial');
  populateDestinations();
  updateBuses();
  setInterval(updateBuses, BUS_RENDER_MS);
  requestAnimationFrame(tickBusPositions);
  if (PM_ZONES_ENABLED) {
    resolveMobilityZones().then(renderMobilityZones).catch(err => console.warn('PM zone resolution failed', err));
  }
  updateLiveData();
  state.livePollTimer = setInterval(updateLiveData, LIVE_POLL_MS);
}

function updateStatus(mode) {
  const dot = document.getElementById('statusDot');
  const title = document.getElementById('statusTitle');
  const detail = document.getElementById('statusDetail');
  dot.className = 'status-dot';
  if (mode === 'loading') {
    title.textContent = '노선 불러오는 중';
    detail.textContent = '사용자 제공 정차 위치와 OpenStreetMap 도로 경로를 결합 중…';
    return;
  }
  if (mode === 'ready') {
    dot.classList.add('ok');
    title.textContent = '노선 준비 완료';
    const next = nextDispatchInfo(nowClock());
    detail.textContent = next ? `다음 기준 출발 ${next.time} · 정차 위치는 손그림 참고 수동 보정` : '오늘 남은 배차 없음 · 정차 위치는 손그림 참고 수동 보정';
  } else {
    dot.classList.add('warn');
    title.textContent = '일부 라우팅 확인 필요';
    detail.textContent = '정류장 위치는 반영했지만 도로 경로 서버 연결이 원활하지 않을 수 있습니다.';
  }
}

function scheduleDate(time, base = nowClock()) {
  const [h, m] = time.split(':').map(Number);
  const d = new Date(base);
  d.setHours(h, m, 0, 0);
  return d;
}
function nextDispatchInfo(now) {
  const future = SCHEDULE.map(t => ({ time: t, date: scheduleDate(t, now) })).find(x => x.date >= now);
  return future || null;
}
function activeTrips(routeId, now = nowClock()) {
  const model = state.routeModels[routeId];
  if (!model?.ok) return [];
  const effective = new Date(EFFECTIVE_DATE + 'T00:00:00');
  if (now < effective) return [];
  return SCHEDULE.map((time, idx) => {
    const dep = scheduleDate(time, now);
    const elapsed = (now - dep) / 1000;
    return { time, idx, dep, elapsed };
  }).filter(t => t.elapsed >= 0 && t.elapsed <= model.duration);
}

// pointAlong()은 매 프레임 버스마다 호출되므로, 폴리라인별 누적거리 표를 한 번만 만들어
// 캐시하고 이분탐색으로 지점을 찾습니다. 캐시는 좌표 배열 자체를 키로 쓰는 WeakMap이라
// 노선을 다시 그려 새 배열이 만들어지면 자동으로 폐기됩니다.
const cumulativeDistanceCache = new WeakMap();
function cumulativeDistances(coords) {
  let cached = cumulativeDistanceCache.get(coords);
  if (cached) return cached;
  const cum = new Float64Array(coords.length);
  for (let i = 1; i < coords.length; i++) cum[i] = cum[i - 1] + haversine(coords[i - 1], coords[i]);
  cached = { cum, total: cum[coords.length - 1] };
  cumulativeDistanceCache.set(coords, cached);
  return cached;
}

function pointAlong(coords, frac) {
  if (!coords?.length) return null;
  if (coords.length === 1) return coords[0];
  const { cum, total } = cumulativeDistances(coords);
  if (!(total > 0)) return coords[0];
  const target = Math.max(0, Math.min(1, frac)) * total;
  let lo = 0, hi = coords.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= target) lo = mid; else hi = mid;
  }
  const segLength = cum[hi] - cum[lo];
  const f = segLength ? (target - cum[lo]) / segLength : 0;
  return [coords[lo][0] + (coords[hi][0] - coords[lo][0]) * f, coords[lo][1] + (coords[hi][1] - coords[lo][1]) * f];
}

// 버스는 항상 "지도에 그려진 그 선" 위에만 있어야 합니다. 그래서 위치를 좌표로 직접 만들지
// 않고, 노선 전체 거리 대비 진행 비율(0~1)만 계산한 뒤 그려진 선 위에서 그 지점을 찾습니다.
// renderRoute()가 캐시해 둔 좌표를 그대로 써서, 두 노선이 겹쳐 선이 좌우로 벌어진 구간에서도
// 선과 어긋나지 않습니다.
function routeGeometryForBus(routeId) {
  return state.drawnRouteGeometry[routeId] || state.routeModels[routeId].geometry;
}

function legDistanceBefore(model, legIndex) {
  let before = 0;
  for (let j = 0; j < legIndex; j++) before += model.legs[j].distance;
  return before;
}

function predictedPoint(routeId, elapsed) {
  const route = ROUTES[routeId], model = state.routeModels[routeId];
  if (!model?.ok) return null;
  const totalDistance = model.legs.reduce((sum, leg) => sum + leg.distance, 0);
  const geometry = routeGeometryForBus(routeId);
  const at = fraction => pointAlong(geometry, totalDistance > 0 ? fraction : 0);

  let t = elapsed;
  for (let i = 0; i < model.legs.length; i++) {
    const leg = model.legs[i];
    if (t <= leg.duration) {
      const traveled = legDistanceBefore(model, i) + leg.distance * (leg.duration ? t / leg.duration : 0);
      return {
        coord: at(traveled / totalDistance),
        label: `${i + 1}→${i + 2}`, nextStopIdx: i + 1, etaToNextSec: Math.max(0, leg.duration - t), legIndex: i
      };
    }
    t -= leg.duration;
    const arrived = route.stops[i + 1];
    if (arrived?.dwell) {
      if (t <= arrived.dwell) {
        const traveled = legDistanceBefore(model, i) + leg.distance;
        return {
          coord: at(traveled / totalDistance),
          label: `${i + 2}번 정차`, nextStopIdx: i + 2 < route.stops.length ? i + 2 : null,
          etaToNextSec: arrived.dwell - t, dwelling: true
        };
      }
      t -= arrived.dwell;
    }
  }
  return { coord: at(1), label: '종점', nextStopIdx: null, etaToNextSec: 0 };
}

function etaShort(sec) {
  if (!Number.isFinite(sec)) return '';
  if (sec <= 30) return '곧';
  return `${Math.max(1, Math.ceil(sec / 60))}분`;
}

function animateMarkerTo(marker, target, duration = 4200) {
  if (!marker || !target) return;
  const startLatLng = marker.getLatLng();
  const start = [startLatLng.lat, startLatLng.lng];
  if (haversine(start, target) < 1) return;
  if (marker.__moveRaf) cancelAnimationFrame(marker.__moveRaf);
  const started = performance.now();
  const step = now => {
    const raw = Math.min(1, (now - started) / Math.max(250, duration));
    const f = raw < .5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2;
    marker.setLatLng([start[0] + (target[0]-start[0])*f, start[1] + (target[1]-start[1])*f]);
    if (raw < 1) marker.__moveRaf = requestAnimationFrame(step);
  };
  marker.__moveRaf = requestAnimationFrame(step);
}

function closestProgressOnLeg(coord, leg) {
  let best = { d: Infinity, index: 0 };
  for (let i = 0; i < leg.coords.length; i++) {
    const d = haversine(coord, leg.coords[i]);
    if (d < best.d) best = { d, index: i };
  }
  let total = 0, before = 0;
  for (let i = 0; i < leg.coords.length - 1; i++) {
    const d = haversine(leg.coords[i], leg.coords[i+1]);
    total += d;
    if (i < best.index) before += d;
  }
  return { distance: best.d, fraction: total ? Math.min(1, before / total) : 0 };
}

function liveProgress(routeId, coord) {
  const model = state.routeModels[routeId];
  if (!model?.ok) return null;
  let best = null;
  model.legs.forEach((leg, i) => {
    const p = closestProgressOnLeg(coord, leg);
    if (!best || p.distance < best.distance) best = { ...p, legIndex: i, etaToNextSec: Math.max(0, leg.duration * (1-p.fraction)), nextStopIdx: i+1 };
  });
  return best;
}

// 마커 생성·제거와 팝업 내용만 담당합니다. 실제 위치 이동은 tickBusPositions()가 매 프레임
// 노선 위에서 다시 계산합니다 (두 지점을 직선 보간하면 배속에서 도로를 가로질러 버림).
function updateBuses() {
  if (!state.layerVisibility.buses) {
    for (const visual of state.predictedBusVisuals.values()) map.removeLayer(visual.marker);
    state.predictedBusVisuals.clear();
    return;
  }
  const now = nowClock();
  const activeKeys = new Set();
  for (const routeId of ['r1','r2']) {
    for (const trip of activeTrips(routeId, now)) {
      const key = `${routeId}|${tripKey(routeId, trip.time)}`;
      if (state.liveBusByTrip.has(key)) continue;
      const p = predictedPoint(routeId, trip.elapsed);
      if (!p?.coord) continue;
      activeKeys.add(key);
      const route = ROUTES[routeId];
      const eta = p.nextStopIdx != null ? etaShort(p.etaToNextSec) : '';
      const nextName = p.nextStopIdx != null ? route.stops[p.nextStopIdx]?.name : '종점';
      let visual = state.predictedBusVisuals.get(key);
      if (!visual) {
        const marker = L.marker(p.coord, { icon: makeBusIcon(route.color, route.short[0]), zIndexOffset: 400 }).bindPopup('').addTo(map);
        visual = { marker, routeId, departure: trip.time };
        state.predictedBusVisuals.set(key, visual);
      } else {
        visual.routeId = routeId;
        visual.departure = trip.time;
        markerSetIconSafe(visual.marker, makeBusIcon(route.color, route.short[0]));
        visual.marker.setLatLng(p.coord);
      }
      visual.marker.setPopupContent(`<strong>${route.name} 예상 차량</strong><br>${trip.time} 기준 출발 · ${escapeHtml(p.label)}<br><b>다음: ${escapeHtml(nextName || '종점')} ${eta ? `· 약 ${eta}` : ''}</b><br><small>시간표·구간시간 기반 예상 위치 · 실제 버스 GPS 아님</small>`);
    }
  }
  for (const [key, visual] of state.predictedBusVisuals) {
    if (activeKeys.has(key)) continue;
    map.removeLayer(visual.marker);
    state.predictedBusVisuals.delete(key);
  }
}

// 매 프레임 현재(가상) 시각으로 노선 위 위치를 다시 계산합니다. 위치가 항상 노선 폴리라인
// 위에서 나오므로, 배속을 아무리 올려도 도로를 벗어나거나 코너를 가로지르지 않습니다.
function tickBusPositions() {
  if (state.layerVisibility.buses && state.predictedBusVisuals.size) {
    const now = nowClock();
    for (const visual of state.predictedBusVisuals.values()) {
      const model = state.routeModels[visual.routeId];
      if (!model?.ok) continue;
      const elapsed = (now - scheduleDate(visual.departure, now)) / 1000;
      if (elapsed < 0 || elapsed > model.duration) continue;
      const p = predictedPoint(visual.routeId, elapsed);
      if (p?.coord) visual.marker.setLatLng(p.coord);
    }
  }
  requestAnimationFrame(tickBusPositions);
}

function markerSetIconSafe(marker, icon) {
  try { marker.setIcon(icon); } catch {}
}


function elementCenter(el) {
  if (Number.isFinite(el.lat) && Number.isFinite(el.lon)) return [el.lat, el.lon];
  if (el.center && Number.isFinite(el.center.lat) && Number.isFinite(el.center.lon)) return [el.center.lat, el.center.lon];
  return null;
}

async function resolveMobilityZones() {
  const unresolved = MOBILITY_ZONES.filter(z => !z.coord && z.searchAliases?.length);
  if (!unresolved.length) return;
  const bbox = '35.8248,128.7490,35.8388,128.7645';
  const q = `[out:json][timeout:14];(nwr["name"](${bbox}););out center tags;`;
  const res = await fetchWithTimeout('https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(q), {}, 7000);
  if (!res.ok) throw new Error(`Overpass ${res.status}`);
  const data = await res.json();
  const named = (data.elements || [])
    .map(el => ({ name: el.tags?.name || '', coord: elementCenter(el) }))
    .filter(x => x.name && x.coord);

  for (const zone of unresolved) {
    let best = null;
    let bestScore = 0;
    for (const item of named) {
      const n = normalize(item.name);
      for (const alias of zone.searchAliases) {
        const a = normalize(alias);
        const score = n === a ? 100 : (n.includes(a) || a.includes(n)) && Math.min(n.length, a.length) >= 3 ? 70 : 0;
        if (score > bestScore) { best = item; bestScore = score; }
      }
    }
    if (bestScore >= 70) zone.coord = best.coord;
  }
}

function renderMobilityZones() {
  state.mobilityLayers.forEach(l => map.removeLayer(l));
  state.mobilityLayers = [];
  for (const zone of MOBILITY_ZONES) {
    if (!zone.coord) continue;
    const confidenceText = zone.confidence === 'verified' ? '공식 확인' : zone.confidence === 'building-relative' ? '공식 안내 · 핀 현장 확인 필요' : '검증 필요';
    const popup = `<strong>PM 주차 · ${escapeHtml(zone.name)}</strong><br><span style="color:#777">${escapeHtml(confidenceText)}</span><div style="margin-top:6px"><small>${escapeHtml(zone.note)}</small></div>`;
    const marker = L.marker(zone.coord, { icon: makePmIcon(), zIndexOffset: 300 }).bindPopup(popup);
    if (state.layerVisibility.pmZones) marker.addTo(map);
    state.mobilityLayers.push(marker);
  }
}

function tripKey(routeId, departure) {
  return `${routeId}-${departure}`;
}

async function apiJson(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const res = await fetch(API_BASE + path, { cache: 'no-store', ...options, signal: controller.signal });
    if (!res.ok) throw new Error(`${res.status}`);
    state.apiOnline = true;
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function trackMetric(type, payload = {}) {
  fetch(API_BASE + '/api/event', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, payload }), keepalive: true
  }).catch(() => {});
}

function renderCrowdBuses(rows = []) {
  state.liveBusByTrip.clear();
  const active = new Set();
  for (const row of rows) {
    if (!ROUTES[row.routeId] || !Number.isFinite(row.lat) || !Number.isFinite(row.lng)) continue;
    const key = `${row.routeId}|${row.tripKey}`;
    active.add(key);
    state.liveBusByTrip.set(key, row);
    if (!state.layerVisibility.buses) continue;
    const route = ROUTES[row.routeId];
    const progress = liveProgress(row.routeId, [row.lat,row.lng]);
    const eta = progress ? etaShort(progress.etaToNextSec) : '';
    const nextName = progress ? route.stops[progress.nextStopIdx]?.name : '';
    let visual = state.crowdBusVisuals.get(key);
    if (!visual) {
      const marker = L.marker([row.lat,row.lng], { icon: makeCrowdBusIcon(route.color, route.short[0]), zIndexOffset: 470 }).bindPopup('').addTo(map);
      visual = { marker };
      state.crowdBusVisuals.set(key, visual);
    } else {
      markerSetIconSafe(visual.marker, makeCrowdBusIcon(route.color, route.short[0]));
      animateMarkerTo(visual.marker, [row.lat,row.lng], Math.max(1500, LIVE_POLL_MS - 800));
    }
    visual.marker.setPopupContent(`<strong>${route.name} 탑승객 공유 위치</strong><br>${escapeHtml(row.tripKey)}${nextName ? `<br><b>다음: ${escapeHtml(nextName)} · 약 ${eta || '계산중'}</b>` : ''}<br><small>기여 ${row.contributors}명 · ${row.sampleAgeSeconds}초 전 · 실제 버스 GPS가 아니라 동의한 탑승객 위치 집계</small>`);
  }
  for (const [key, visual] of state.crowdBusVisuals) {
    if (active.has(key) && state.layerVisibility.buses) continue;
    if (visual.marker.__moveRaf) cancelAnimationFrame(visual.marker.__moveRaf);
    map.removeLayer(visual.marker);
    state.crowdBusVisuals.delete(key);
  }
  // Crowd data can replace an estimated trip, so refresh predicted markers immediately.
  updateBuses();
}


function applyCrowdingToCards() {
  document.querySelectorAll('[data-crowding-key]').forEach(el => {
    const row = state.crowdingByTrip.get(el.dataset.crowdingKey);
    const dot = el.querySelector('.crowding-dot');
    const text = el.querySelector('.crowding-text');
    if (!dot || !text) return;
    dot.className = 'crowding-dot';
    if (!row) {
      text.textContent = state.apiOnline ? '혼잡도 정보 없음' : '혼잡도 서버 미연결';
      return;
    }
    dot.classList.add(row.level);
    text.textContent = `${CROWD_LABELS[row.level] || row.level} · 최근 ${row.reports}명 신고`;
  });
}

async function updateLiveData() {
  try {
    const [live, crowd] = await Promise.all([apiJson('/api/live-buses'), apiJson('/api/crowding')]);
    renderCrowdBuses(live.buses || []);
    state.crowdingByTrip.clear();
    for (const row of crowd.crowding || []) state.crowdingByTrip.set(`${row.routeId}|${row.tripKey}`, row);
    applyCrowdingToCards();
  } catch (e) {
    state.apiOnline = false;
    applyCrowdingToCards();
  }
}

function token(prefix) {
  const value = globalThis.crypto?.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${prefix}-${value}`;
}

async function sendRideTelemetry(coord, accuracy) {
  const g = state.activeGuidance;
  if (!g || g.stage !== 'riding' || !g.shareRideTelemetry) return;
  const now = Date.now();
  if (g.lastTelemetryAt && now - g.lastTelemetryAt < TELEMETRY_UPLOAD_MS) return;
  g.lastTelemetryAt = now;
  try {
    await apiJson('/api/telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        riderToken: g.riderToken,
        routeId: g.plan.routeId,
        tripKey: g.tripKey,
        lat: coord[0], lng: coord[1], accuracy,
        clientTimestamp: now
      })
    });
    const btn = document.getElementById('shareRideBtn');
    if (btn) btn.title = '익명 위치 공유 중 · 서버 연결됨';
  } catch (e) {
    const btn = document.getElementById('shareRideBtn');
    if (btn) btn.title = '위치 공유를 켰지만 실시간 서버에 연결되지 않았습니다.';
  }
}

function setRideSharing(enabled) {
  const g = state.activeGuidance;
  if (!g || g.stage !== 'riding') return;
  g.shareRideTelemetry = Boolean(enabled);
  if (enabled && !g.riderToken) g.riderToken = token('ride');
  renderGuidance();
  if (enabled && state.user) sendRideTelemetry(state.user, null);
}

function openCrowdConsent() {
  const g = state.activeGuidance;
  if (!g || g.stage !== 'riding') return;
  if (g.shareRideTelemetry) {
    setRideSharing(false);
    toast('익명 탑승 위치 공유를 껐습니다.');
    return;
  }
  document.getElementById('crowdConsentDialog')?.showModal();
}

async function submitCrowding(level) {
  const g = state.activeGuidance;
  if (!g || g.stage !== 'riding') return;
  if (!CROWD_LABELS[level]) return;
  if (!g.reportToken) g.reportToken = token('crowd');
  try {
    await apiJson('/api/crowding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportToken: g.reportToken, routeId: g.plan.routeId, tripKey: g.tripKey, level })
    });
    toast(`혼잡도를 '${CROWD_LABELS[level]}'로 공유했습니다.`);
    document.getElementById('crowdingDialog')?.close();
    updateLiveData();
  } catch (e) {
    toast('혼잡도 서버에 연결하지 못했습니다.');
  }
}

function populateDestinations() {
  const list = document.getElementById('destinationList');
  list.innerHTML = '';
  const unique = new Map();
  Object.values(ROUTES).forEach(r => r.stops.forEach(s => {
    if (!unique.has(s.name)) unique.set(s.name, s);
  }));
  [...unique.values()].forEach(s => {
    const o = document.createElement('option');
    o.value = s.name;
    o.label = s.code ? `${s.code} · ${s.name}` : s.name;
    list.appendChild(o);
  });
}

function findDestinationByName(name) {
  const n = normalize(name);
  if (!n) return null;
  let best = null, score = 0;
  Object.values(ROUTES).forEach(r => r.stops.forEach(s => {
    const names = [s.name, s.code, ...s.aliases, s.guide];
    names.forEach(x => {
      const xn = normalize(x);
      let sc = 0;
      if (xn === n) sc = 100;
      else if (xn.includes(n) || n.includes(xn)) sc = 60;
      if (sc > score) {
        score = sc;
        best = s;
      }
    });
  }));
  return score >= 60 ? best : null;
}

function setStartLocation(coord, name = '지도에서 선택한 출발 위치', accuracy = null, recenter = true) {
  state.user = coord;
  state.startName = name;
  if (state.userLayer) map.removeLayer(state.userLayer);
  state.userLayer = L.marker(coord, { icon: makeUserIcon(), zIndexOffset: 1000 })
    .bindPopup(`<strong>${escapeHtml(name)}</strong>${accuracy ? `<br><small>정확도 약 ${Math.round(accuracy)}m</small>` : ''}`)
    .addTo(map);
  if (recenter) map.setView(coord, 17);
  document.getElementById('startInput').value = name;
}

function setUserLocation(coord, accuracy = null, recenter = true) {
  setStartLocation(coord, '현재 위치', accuracy, recenter);
}

function requestLocation() {
  if (window.YUAds?.dismissLaunchAd) window.YUAds.dismissLaunchAd();
  if (!navigator.geolocation) {
    toast('이 브라우저는 위치 기능을 지원하지 않습니다.');
    return;
  }
  toast('현재 위치를 확인하는 중…');
  navigator.geolocation.getCurrentPosition(
    pos => {
      setUserLocation([pos.coords.latitude, pos.coords.longitude], pos.coords.accuracy);
      toast('현재 위치를 표시했습니다.');
    },
    err => {
      console.warn(err);
      toast('위치 권한을 허용하거나 HTTPS/localhost에서 실행하세요.');
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 }
  );
}

function setDestination(coord, name = '지도에서 선택한 위치') {
  state.destination = coord;
  state.destinationName = name;
  if (state.destLayer) map.removeLayer(state.destLayer);
  state.destLayer = L.marker(coord, { icon: makeDestIcon(), zIndexOffset: 900 })
    .bindPopup(`<strong>${escapeHtml(name)}</strong>`)
    .addTo(map);
  document.getElementById('destinationInput').value = name;
}

const footCache = new Map();
const WALK_FALLBACK_MPS = 1.2;

// 보행 라우팅 서버가 응답하지 않아도 결과가 아예 사라지지 않도록, 직선거리 기준 추정치로
// 대체합니다. approx:true인 구간은 화면에 "직선거리 추정"으로 표시합니다.
function fallbackWalk(a, b) {
  const distance = haversine(a, b);
  return { ok: true, approx: true, duration: distance / WALK_FALLBACK_MPS, distance, geometry: [a, b] };
}

async function footRoute(a, b) {
  const key = `${a.map(x => x.toFixed(5)).join(',')}|${b.map(x => x.toFixed(5)).join(',')}`;
  if (footCache.has(key)) return footCache.get(key);
  const url = `https://routing.openstreetmap.de/routed-foot/route/v1/driving/${a[1]},${a[0]};${b[1]},${b[0]}?overview=full&geometries=geojson&steps=false`;
  try {
    const res = await fetchWithTimeout(url, {}, 7000);
    const data = await res.json();
    if (!res.ok || data.code !== 'Ok' || !data.routes?.[0]) throw new Error(data.message || data.code);
    const r = data.routes[0];
    const out = { ok: true, duration: r.duration, distance: r.distance, geometry: r.geometry.coordinates.map(p => [p[1], p[0]]) };
    footCache.set(key, out);
    return out;
  } catch (e) {
    console.warn('foot route fail; falling back to straight-line estimate', e);
    const out = fallbackWalk(a, b);
    footCache.set(key, out);
    return out;
  }
}

function rideSeconds(routeId, boardIdx, alightIdx) {
  const model = state.routeModels[routeId], route = ROUTES[routeId];
  if (!model?.ok) return null;
  const legIndices = routeLegIndices(route.stops.length, boardIdx, alightIdx);
  if (!legIndices.length) return null;
  let sec = 0;
  for (const i of legIndices) {
    sec += model.legs[i].duration;
    const arrived = route.stops[i + 1];
    if (arrived?.dwell) sec += arrived.dwell;
  }
  return sec;
}

function nextArrivalsAtStop(routeId, stopIdx, now = nowClock(), limit = 2) {
  const model = state.routeModels[routeId];
  if (!model?.ok) return [];
  const effective = new Date(EFFECTIVE_DATE + 'T00:00:00');
  if (now < effective) return [];
  const canonicalIndex = canonicalStopIndex(ROUTES[routeId].stops.length, stopIdx);
  const offset = model.offsets[canonicalIndex ?? stopIdx] || 0;
  return SCHEDULE.map(t => {
    const dep = scheduleDate(t, now);
    const arrival = new Date(dep.getTime() + offset * 1000);
    return { departure: t, arrival, wait: (arrival - now) / 1000 };
  }).filter(x => x.wait >= 0).slice(0, limit);
}

function nextArrivalAtStop(routeId, stopIdx, now = nowClock()) {
  return nextArrivalsAtStop(routeId, stopIdx, now, 1)[0] || null;
}

function secToMin(sec) { return Math.max(1, Math.round(sec / 60)); }
function mToText(m) { return m < 1000 ? `${Math.round(m / 10) * 10}m` : `${(m / 1000).toFixed(1)}km`; }
function timeText(date) { return date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }); }

async function buildTransferPlan(station, first, second) {
  const firstRoute = ROUTES[first.routeId], firstModel = state.routeModels[first.routeId];
  const secondRoute = ROUTES[second.routeId], secondModel = state.routeModels[second.routeId];
  if (!firstModel?.ok || !secondModel?.ok) return null;

  const boards = serviceStopEntries(firstRoute.stops)
    .map(({ stop: s, index: i }) => ({ s, i, d: haversine(state.user, s.coord) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 3);
  const alights = serviceStopEntries(secondRoute.stops)
    .map(({ stop: s, index: i }) => ({ s, i, d: haversine(state.destination, s.coord) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 3);

  let best = null;
  for (const b of boards) {
    const ride1 = rideSeconds(first.routeId, b.i, first.index);
    if (ride1 == null) continue;
    const boardNext = nextArrivalAtStop(first.routeId, b.i, effectiveNow());
    if (!boardNext) continue;
    for (const a of alights) {
      const ride2 = rideSeconds(second.routeId, second.index, a.i);
      if (ride2 == null) continue;
      const rough = b.d / 1.35 + boardNext.wait + ride1 + ride2 + a.d / 1.35;
      if (!best || rough < best.rough) best = { b, a, ride1, ride2, rough };
    }
  }
  if (!best) return null;

  const walkIn = await footRoute(state.user, best.b.s.coord);
  const walkOut = await footRoute(best.a.s.coord, state.destination);
  if (!walkIn.ok || !walkOut.ok) return null;

  const boardNext = nextArrivalAtStop(first.routeId, best.b.i, effectiveNow());
  if (!boardNext) return null;
  const arrivalAtTransfer = new Date(boardNext.arrival.getTime() + best.ride1 * 1000);
  const transferWalkSec = transferWalkSeconds(liveStopCoord(first.routeId, first.index), liveStopCoord(second.routeId, second.index));
  const readyForSecond = new Date(arrivalAtTransfer.getTime() + transferWalkSec * 1000);
  const secondNext = nextArrivalAtStop(second.routeId, second.index, readyForSecond);
  if (!secondNext) return null;

  const total = walkIn.duration + boardNext.wait + best.ride1 + transferWalkSec + secondNext.wait + best.ride2 + walkOut.duration;

  return {
    type: 'bus-transfer',
    duration: total,
    distance: walkIn.distance + walkOut.distance,
    firstRouteId: first.routeId,
    secondRouteId: second.routeId,
    board: best.b.s,
    alight: best.a.s,
    boardIdx: best.b.i,
    alightIdx: best.a.i,
    transferStationName: station.name,
    firstLegIndices: routeLegIndices(firstRoute.stops.length, best.b.i, first.index),
    secondLegIndices: routeLegIndices(secondRoute.stops.length, second.index, best.a.i),
    walkIn,
    walkOut,
    wait: boardNext.wait,
    ride: best.ride1 + best.ride2,
    transferWait: secondNext.wait,
    transferWalkSeconds: transferWalkSec,
    baseDeparture: boardNext.departure,
    title: `${firstRoute.short} → ${secondRoute.short} 환승`,
    steps: [
      `${best.b.s.name}까지 도보 ${mToText(walkIn.distance)}`,
      `${timeText(boardNext.arrival)}경 ${firstRoute.short} 승차 · 예상 대기 ${secToMin(boardNext.wait)}분`,
      `${station.name}에서 ${secondRoute.short} 환승${transferWalkSec > 30 ? ` · 도보 약 ${secToMin(transferWalkSec)}분` : ''} · 대기 약 ${secToMin(secondNext.wait)}분`,
      `${best.a.s.name} 하차 · 버스 약 ${secToMin(best.ride1 + best.ride2)}분`,
      `목적지까지 도보 ${mToText(walkOut.distance)}`
    ]
  };
}

async function planRoutes() {
  if (window.YUAds?.dismissLaunchAd) window.YUAds.dismissLaunchAd();
  const startInput = document.getElementById('startInput').value.trim();
  const destinationInput = document.getElementById('destinationInput').value.trim();
  if (!state.user || normalize(startInput) !== normalize(state.startName)) {
    if (!startInput || normalize(startInput) === normalize('현재 위치')) {
      toast('현재 위치를 확인하거나 출발지를 검색·지도에서 선택해 주세요.');
      requestLocation();
      return;
    }
    const found = findDestinationByName(startInput);
    if (found) setStartLocation(found.coord, found.name);
    else {
      toast('출발지를 목록에서 선택하거나 지도에 찍어주세요.');
      return;
    }
  }
  if (!state.destination || normalize(destinationInput) !== normalize(state.destinationName)) {
    const found = findDestinationByName(destinationInput);
    if (found) setDestination(found.coord, found.name);
    else {
      toast('목적지를 목록에서 선택하거나 지도에 찍어주세요.');
      return;
    }
  }

  document.getElementById('routeBtn').disabled = true;
  document.getElementById('results').innerHTML = '<div class="empty-state"><strong>경로 계산 중…</strong><p>도보 경로와 다음 순환버스를 비교하고 있습니다.</p></div>';
  clearPlanLayers();

  const plans = [];
  const direct = await footRoute(state.user, state.destination);
  if (direct.ok) {
    plans.push({ type: 'walk', duration: direct.duration, distance: direct.distance, geometry: direct.geometry, title: '도보', steps: [`도보 ${mToText(direct.distance)}`] });
  }

  for (const routeId of ['r1', 'r2']) {
    const route = ROUTES[routeId], model = state.routeModels[routeId];
    if (!model?.ok) continue;

    const boards = serviceStopEntries(route.stops)
      .map(({ stop: s, index: i }) => ({ s, i, d: haversine(state.user, s.coord) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 3);
    const alights = serviceStopEntries(route.stops)
      .map(({ stop: s, index: i }) => ({ s, i, d: haversine(state.destination, s.coord) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 3);

    let candidate = null;
    for (const b of boards) for (const a of alights) {
      const ride = rideSeconds(routeId, b.i, a.i);
      if (ride == null) continue;
      const next = nextArrivalAtStop(routeId, b.i, effectiveNow());
      if (!next) continue;
      const rough = b.d / 1.35 + next.wait + ride + a.d / 1.35;
      if (!candidate || rough < candidate.rough) candidate = { b, a, ride, next, rough };
    }
    if (!candidate) continue;

    const walkIn = await footRoute(state.user, candidate.b.s.coord);
    const walkOut = await footRoute(candidate.a.s.coord, state.destination);
    if (!walkIn.ok || !walkOut.ok) continue;

    const next = nextArrivalAtStop(routeId, candidate.b.i, effectiveNow());
    if (!next) continue;
    const total = walkIn.duration + next.wait + candidate.ride + walkOut.duration;
    plans.push({
      type: 'bus',
      routeId,
      duration: total,
      distance: walkIn.distance + walkOut.distance,
      board: candidate.b.s,
      alight: candidate.a.s,
      boardIdx: candidate.b.i,
      alightIdx: candidate.a.i,
      legIndices: routeLegIndices(route.stops.length, candidate.b.i, candidate.a.i),
      walkIn,
      walkOut,
      wait: next.wait,
      ride: candidate.ride,
      busArrival: next.arrival,
      baseDeparture: next.departure,
      title: `${route.short} 이용`,
      steps: [
        `${candidate.b.s.name}까지 도보 ${mToText(walkIn.distance)}`,
        `${timeText(next.arrival)}경 승차 · 예상 대기 ${secToMin(next.wait)}분`,
        `${candidate.a.s.name} 하차 · 버스 약 ${secToMin(candidate.ride)}분`,
        `목적지까지 도보 ${mToText(walkOut.distance)}`
      ]
    });
  }

  for (const station of TRANSFER_STATIONS) {
    for (const first of station.members) {
      for (const second of station.members) {
        if (first.routeId === second.routeId) continue;
        const plan = await buildTransferPlan(station, first, second);
        if (plan) plans.push(plan);
      }
    }
  }

  plans.sort((a, b) => a.duration - b.duration);
  trackMetric('route_search', { destination: state.destinationName || destinationInput || '' });
  renderPlans(plans);
  if (plans[0]) drawPlan(plans[0]);
  document.getElementById('routeBtn').disabled = false;
}

function renderPlans(plans) {
  const root = document.getElementById('results');
  if (!plans.length) {
    root.innerHTML = '<div class="empty-state"><strong>경로를 계산하지 못했습니다.</strong><p>도보 라우팅 서버 연결 또는 목적지 선택을 확인하세요.</p></div>';
    return;
  }
  root.innerHTML = plans.map((p, i) => {
    const badge = i === 0
      ? '<span class="badge best">가장 빠름</span>'
      : p.type === 'bus'
        ? `<span class="badge ${p.routeId}">${ROUTES[p.routeId].short}</span>`
        : p.type === 'bus-transfer'
          ? `<span class="badge transfer">🔄 ${ROUTES[p.firstRouteId].short}→${ROUTES[p.secondRouteId].short}</span>`
          : '<span class="badge">도보</span>';
    const meta = p.type === 'walk'
      ? `${mToText(p.distance)} · OSM 보행 경로`
      : p.type === 'bus-transfer'
        ? `도보 ${mToText(p.distance)} + 순환버스 환승 1회 · ${p.baseDeparture} 기준 출발편`
        : `도보 ${mToText(p.distance)} + 순환버스 · ${p.baseDeparture} 기준 출발편`;
    const crowding = p.type === 'bus'
      ? `<div class="crowding-meta" data-crowding-key="${p.routeId}|${tripKey(p.routeId, p.baseDeparture)}"><span class="crowding-dot"></span><span class="crowding-text">혼잡도 확인 중</span></div>`
      : '';
    const guideButton = p.type === 'bus'
      ? `<button class="guide-btn" data-guide="${i}">승·하차 알림 시작</button>`
      : '';
    return `<article class="route-card ${i === 0 ? 'best' : ''}" data-plan="${i}">
      <div class="route-card-head"><div><h3>${escapeHtml(p.title)}</h3><div class="route-meta">${escapeHtml(meta)}</div></div><div style="text-align:right">${badge}<div class="route-time">${secToMin(p.duration)}분</div></div></div>
      <ol class="route-steps">${p.steps.map((s, j) => `<li><span class="step-icon">${j + 1}</span><span>${escapeHtml(s)}</span></li>`).join('')}</ol>
      ${crowding}
      ${guideButton}
    </article>`;
  }).join('');
  root.querySelectorAll('.route-card').forEach((el, i) => el.addEventListener('click', () => drawPlan(plans[i])));
  applyCrowdingToCards();
  root.querySelectorAll('.guide-btn').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    const plan = plans[Number(btn.dataset.guide)];
    if (plan?.type === 'bus') startGuidance(plan);
  }));
}

function clearPlanLayers() {
  state.planLayers.forEach(l => map.removeLayer(l));
  state.planLayers = [];
}
function drawPlan(plan) {
  clearPlanLayers();
  if (plan.type === 'walk') {
    const l = L.polyline(plan.geometry, { color: '#17191c', weight: 7, opacity: .8, dashArray: '2 10', lineCap: 'round' }).addTo(map);
    state.planLayers.push(l);
    map.fitBounds(l.getBounds(), { padding: [70, 70] });
    return;
  }
  const a = L.polyline(plan.walkIn.geometry, { color: '#333', weight: 5, opacity: .75, dashArray: '3 8' }).addTo(map);
  const b = L.polyline(plan.walkOut.geometry, { color: '#333', weight: 5, opacity: .75, dashArray: '3 8' }).addTo(map);
  state.planLayers.push(a, b);

  if (plan.type === 'bus-transfer') {
    const firstModel = state.routeModels[plan.firstRouteId], secondModel = state.routeModels[plan.secondRouteId];
    const firstCoords = [], secondCoords = [];
    for (const i of plan.firstLegIndices) firstCoords.push(...firstModel.legs[i].coords);
    for (const i of plan.secondLegIndices) secondCoords.push(...secondModel.legs[i].coords);
    const c1 = L.polyline(firstCoords, { color: ROUTES[plan.firstRouteId].color, weight: 8, opacity: .9 }).addTo(map);
    const c2 = L.polyline(secondCoords, { color: ROUTES[plan.secondRouteId].color, weight: 8, opacity: .9 }).addTo(map);
    state.planLayers.push(c1, c2);
    const g = L.featureGroup([a, b, c1, c2]);
    map.fitBounds(g.getBounds(), { padding: [70, 70] });
    return;
  }

  const model = state.routeModels[plan.routeId];
  const coords = [];
  const legIndices = plan.legIndices?.length
    ? plan.legIndices
    : routeLegIndices(ROUTES[plan.routeId].stops.length, plan.boardIdx, plan.alightIdx);
  for (const i of legIndices) coords.push(...model.legs[i].coords);
  const c = L.polyline(coords, { color: ROUTES[plan.routeId].color, weight: 8, opacity: .9 }).addTo(map);
  state.planLayers.push(c);
  const g = L.featureGroup([a, b, c]);
  map.fitBounds(g.getBounds(), { padding: [70, 70] });
}

// 승·하차 안내 ------------------------------------------------------------
function prepareAlertAudio() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!state.audioContext) state.audioContext = new AudioCtx();
    if (state.audioContext.state === 'suspended') state.audioContext.resume();
  } catch (e) {
    console.warn('Audio alert unavailable', e);
  }
}

function playAlertTone(urgent = false) {
  try {
    if (!state.audioContext) return;
    const ctx = state.audioContext;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(urgent ? 920 : 760, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (urgent ? 0.7 : 0.4));
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + (urgent ? 0.75 : 0.45));
  } catch (e) {
    console.warn('Alert tone failed', e);
  }
}

async function requestNotificationPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'default') {
    try { return await Notification.requestPermission(); }
    catch (e) { return 'denied'; }
  }
  return Notification.permission;
}

function guidanceNotify(title, body, urgent = false) {
  toast(`${title} · ${body}`);
  playAlertTone(urgent);
  if ('vibrate' in navigator) {
    navigator.vibrate(urgent ? [300, 120, 300, 120, 450] : [180, 90, 180]);
  }
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title, { body, tag: urgent ? 'yu-bus-urgent' : 'yu-bus-guide', renotify: true });
    } catch (e) {
      console.warn('Notification failed', e);
    }
  }
}

function guidanceNextBusText(g) {
  const next = nextArrivalAtStop(g.plan.routeId, g.plan.boardIdx, new Date());
  if (!next) return '오늘 남은 배차 없음';
  const min = Math.max(0, Math.ceil(next.wait / 60));
  return min <= 0 ? '도착 예정 시각' : `약 ${min}분 후 도착 예상`;
}

function nearestGuidanceStopIndex(g, coord) {
  const route = ROUTES[g.plan.routeId];
  const relevant = [g.plan.boardIdx, ...((g.plan.legIndices || []).map(index => (index + 1) % (route.stops.length - 1)))];
  let best = g.plan.boardIdx, bestD = Infinity;
  for (const i of relevant) {
    const d = haversine(coord, route.stops[i].coord);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function renderGuidance() {
  const g = state.activeGuidance;
  const bar = document.getElementById('guidanceBar');
  if (!g) { bar.hidden = true; return; }

  bar.hidden = false;
  const title = document.getElementById('guidanceTitle');
  const detail = document.getElementById('guidanceDetail');
  const icon = document.getElementById('guidanceIcon');
  const stageBtn = document.getElementById('guidanceStageBtn');
  const shareBtn = document.getElementById('shareRideBtn');
  const crowdBtn = document.getElementById('crowdingBtn');
  const route = ROUTES[g.plan.routeId];
  icon.textContent = route.short;
  icon.style.background = route.color;
  if (shareBtn) {
    shareBtn.hidden = g.stage !== 'riding';
    shareBtn.textContent = g.shareRideTelemetry ? '위치공유 ON' : '위치공유 OFF';
    shareBtn.classList.toggle('share-on', Boolean(g.shareRideTelemetry));
  }
  if (crowdBtn) crowdBtn.hidden = g.stage !== 'riding';

  const current = state.user || g.startedAtCoord;
  if (g.stage === 'to_board' || g.stage === 'waiting') {
    const distance = current ? haversine(current, g.plan.board.coord) : null;
    title.textContent = g.stage === 'waiting' ? `${g.plan.board.name}에서 탑승 대기` : `${g.plan.board.name}으로 이동`;
    const dText = distance == null ? '' : `정류장까지 ${mToText(distance)} · `;
    detail.textContent = `${dText}${route.short} ${guidanceNextBusText(g)}`;
    stageBtn.hidden = false;
    stageBtn.textContent = '탑승했어요';
  } else if (g.stage === 'riding') {
    const distance = current ? haversine(current, g.plan.alight.coord) : null;
    const nearestIdx = current ? nearestGuidanceStopIndex(g, current) : g.plan.boardIdx;
    const remaining = routeLegIndices(route.stops.length, nearestIdx, g.plan.alightIdx).length;
    title.textContent = `${g.plan.alight.name}에서 하차`;
    detail.textContent = `${remaining > 0 ? `${remaining}개 정류장 남음 · ` : ''}${distance == null ? '' : `하차 지점까지 약 ${mToText(distance)}`}`;
    stageBtn.hidden = false;
    stageBtn.textContent = '하차 완료';
  }
}

function refreshGuidanceAlerts() {
  const g = state.activeGuidance;
  if (!g) return;
  renderGuidance();
  if (g.stage === 'waiting') {
    const next = nextArrivalAtStop(g.plan.routeId, g.plan.boardIdx, new Date());
    if (next && next.wait <= 180 && next.wait >= 0 && !g.flags.busSoon) {
      g.flags.busSoon = true;
      guidanceNotify('버스 도착 임박', `${ROUTES[g.plan.routeId].short}이 약 ${Math.max(1, Math.ceil(next.wait / 60))}분 후 정류장에 도착할 것으로 예상됩니다.`);
    }
  }
}

function processGuidancePosition(position) {
  const g = state.activeGuidance;
  if (!g) return;
  const coord = [position.coords.latitude, position.coords.longitude];
  setUserLocation(coord, position.coords.accuracy, false);

  if (g.stage === 'to_board') {
    const dist = haversine(coord, g.plan.board.coord);
    if (dist <= BOARD_NEAR_METERS && !g.flags.boardNear) {
      g.flags.boardNear = true;
      guidanceNotify('승차 정류장이 가까워요', `${g.plan.board.name}까지 약 ${mToText(dist)} 남았습니다.`);
    }
    if (dist <= BOARD_AT_STOP_METERS && !g.flags.atBoard) {
      g.flags.atBoard = true;
      g.stage = 'waiting';
      guidanceNotify('승차 정류장 도착', `${ROUTES[g.plan.routeId].short} 탑승 위치입니다. 차량 노선을 확인하세요.`);
    }
  } else if (g.stage === 'riding') {
    sendRideTelemetry(coord, position.coords.accuracy);
    const dist = haversine(coord, g.plan.alight.coord);
    if (dist <= ALIGHT_SOON_METERS && !g.flags.alightSoon) {
      g.flags.alightSoon = true;
      guidanceNotify('하차 정류장이 가까워요', `${g.plan.alight.name}까지 약 ${mToText(dist)} 남았습니다.`);
    }
    if (dist <= ALIGHT_NOW_METERS && !g.flags.alightNow) {
      g.flags.alightNow = true;
      guidanceNotify('곧 하차하세요', `${g.plan.alight.name}에 접근 중입니다. 하차를 준비하세요.`, true);
    }
  }
  refreshGuidanceAlerts();
}

async function startGuidance(plan) {
  stopGuidance(false);
  prepareAlertAudio();
  const permission = await requestNotificationPermission();
  state.activeGuidance = {
    plan,
    stage: 'to_board',
    startedAt: new Date(),
    startedAtCoord: state.user,
    flags: { boardNear: false, atBoard: false, busSoon: false, alightSoon: false, alightNow: false },
    shareRideTelemetry: false,
    riderToken: null,
    reportToken: null,
    tripKey: tripKey(plan.routeId, plan.baseDeparture),
    lastTelemetryAt: 0
  };
  trackMetric('guidance_start', { routeId: plan.routeId });
  renderGuidance();
  drawPlan(plan);

  if (navigator.geolocation) {
    state.geoWatchId = navigator.geolocation.watchPosition(
      processGuidancePosition,
      err => console.warn('Guidance geolocation error', err),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 4000 }
    );
  }
  state.guidanceTimer = setInterval(refreshGuidanceAlerts, 10000);

  const notificationText = permission === 'granted'
    ? '브라우저 알림과 진동을 사용합니다.'
    : '화면 내 알림과 진동을 사용합니다.';
  guidanceNotify('승·하차 안내 시작', `${plan.board.name}으로 이동하세요. ${notificationText}`);
  if (innerWidth <= 720) sidePanel.classList.remove('open');
}

function markGuidanceStage() {
  const g = state.activeGuidance;
  if (!g) return;
  if (g.stage === 'to_board' || g.stage === 'waiting') {
    g.stage = 'riding';
    trackMetric('ride_boarded', { routeId: g.plan.routeId });
    g.flags.alightSoon = false;
    g.flags.alightNow = false;
    guidanceNotify('탑승 안내', `${ROUTES[g.plan.routeId].short} 탑승으로 전환했습니다. ${g.plan.alight.name} 하차 전에 알려드릴게요.`);
    renderGuidance();
    setTimeout(() => document.getElementById('crowdConsentDialog')?.showModal(), 250);
    return;
  }
  if (g.stage === 'riding') {
    guidanceNotify('안내 종료', `${g.plan.alight.name} 하차 완료로 처리했습니다.`);
    stopGuidance(false);
  }
}

function stopGuidance(showToast = true) {
  if (state.geoWatchId != null && navigator.geolocation) {
    navigator.geolocation.clearWatch(state.geoWatchId);
    state.geoWatchId = null;
  }
  if (state.guidanceTimer) {
    clearInterval(state.guidanceTimer);
    state.guidanceTimer = null;
  }
  state.activeGuidance = null;
  const bar = document.getElementById('guidanceBar');
  if (bar) bar.hidden = true;
  if (showToast) toast('승·하차 알림을 종료했습니다.');
}

// UI wiring
const sidePanel = document.getElementById('sidePanel');
document.getElementById('shareRideBtn')?.addEventListener('click', openCrowdConsent);
document.getElementById('crowdingBtn')?.addEventListener('click', () => { if (state.activeGuidance?.stage === 'riding') document.getElementById('crowdingDialog')?.showModal(); });
document.getElementById('guidanceStageBtn').addEventListener('click', markGuidanceStage);
document.getElementById('stopGuidanceBtn').addEventListener('click', () => stopGuidance(true));
document.getElementById('locateBtn').addEventListener('click', requestLocation);
document.getElementById('mapLocateBtn').addEventListener('click', requestLocation);
document.getElementById('routeBtn').addEventListener('click', planRoutes);

const departureModeSelect = document.getElementById('departureModeSelect');
const departureTimeInput = document.getElementById('departureTimeInput');
function applyDepartureSelection() {
  if (departureModeSelect.value !== 'scheduled') {
    departureTimeInput.disabled = true;
    state.departureAt = null;
    return;
  }
  departureTimeInput.disabled = false;
  const [h, m] = (departureTimeInput.value || '').split(':').map(Number);
  if (!Number.isInteger(h) || !Number.isInteger(m)) {
    state.departureAt = null;
    return;
  }
  const now = nowClock();
  const picked = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
  if (picked < now) picked.setDate(picked.getDate() + 1);
  state.departureAt = picked;
}
departureModeSelect.addEventListener('change', () => {
  applyDepartureSelection();
  if (departureModeSelect.value === 'scheduled' && !departureTimeInput.value) {
    departureTimeInput.focus();
    return;
  }
  if (departureModeSelect.value === 'now') toast('지금 출발 기준으로 검색합니다.');
  else if (state.departureAt) toast(departureTimeToast(state.departureAt));
  if (state.destination) planRoutes();
});
departureTimeInput.addEventListener('change', () => {
  applyDepartureSelection();
  if (state.departureAt) toast(departureTimeToast(state.departureAt));
  if (state.destination) planRoutes();
});
function departureTimeToast(departureAt) {
  const effective = new Date(EFFECTIVE_DATE + 'T00:00:00');
  if (departureAt < effective) return `조정 시간표는 ${EFFECTIVE_DATE}부터 적용됩니다 · 그 전에는 도보 경로만 표시됩니다.`;
  return `${timeText(departureAt)} 출발 기준으로 검색합니다.`;
}
document.getElementById('fitCampusBtn').addEventListener('click', () => map.fitBounds(CAMPUS_BOUNDS, { padding: [30, 30] }));
document.getElementById('zoomInBtn').addEventListener('click', () => map.zoomIn());
document.getElementById('zoomOutBtn').addEventListener('click', () => map.zoomOut());
function setPickingPoint(type) {
  state.pickingPoint = type;
  const startButton = document.getElementById('pickStartMapBtn');
  const destinationButton = document.getElementById('pickMapBtn');
  const startActive = type === 'start';
  const destinationActive = type === 'destination';
  startButton.classList.toggle('active', startActive);
  startButton.setAttribute('aria-pressed', startActive ? 'true' : 'false');
  destinationButton.classList.toggle('active', destinationActive);
  destinationButton.setAttribute('aria-pressed', destinationActive ? 'true' : 'false');
}
function togglePickingPoint(type) {
  const next = state.pickingPoint === type ? null : type;
  setPickingPoint(next);
  const label = type === 'start' ? '출발 위치' : '도착 위치';
  toast(next ? `지도에서 ${label}를 눌러주세요.` : '지도 선택을 취소했습니다.');
}
document.getElementById('pickStartMapBtn').addEventListener('click', () => togglePickingPoint('start'));
document.getElementById('pickMapBtn').addEventListener('click', () => togglePickingPoint('destination'));
document.getElementById('startInput').addEventListener('change', e => {
  const found = findDestinationByName(e.target.value);
  if (found) setStartLocation(found.coord, found.name);
});
document.getElementById('startInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const found = findDestinationByName(e.target.value);
    if (found) {
      setStartLocation(found.coord, found.name);
      document.getElementById('destinationInput').focus();
    }
  }
});
document.getElementById('destinationInput').addEventListener('change', e => {
  const found = findDestinationByName(e.target.value);
  if (found) setDestination(found.coord, found.name);
});
document.getElementById('destinationInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const found = findDestinationByName(e.target.value);
    if (found) {
      setDestination(found.coord, found.name);
      planRoutes();
    }
  }
});
map.on('click', e => {
  const type = state.pickingPoint;
  if (!type) return;
  setPickingPoint(null);
  if (type === 'start') {
    setStartLocation([e.latlng.lat, e.latlng.lng], '지도에서 선택한 출발 위치');
    toast('출발 위치를 설정했습니다.');
  } else {
    setDestination([e.latlng.lat, e.latlng.lng], '지도에서 선택한 도착 위치');
    toast('도착 위치를 설정했습니다.');
  }
});

document.querySelectorAll('.chip').forEach(btn => btn.addEventListener('click', () => {
  const k = btn.dataset.layer;
  state.layerVisibility[k] = !state.layerVisibility[k];
  btn.classList.toggle('active', state.layerVisibility[k]);
  if (k === 'route1') {
    renderRoute('r1');
    renderRoute('r2');
    updateBuses();
    state.stopLayers.r1.forEach(x => state.layerVisibility[k] ? x.addTo(map) : map.removeLayer(x));
  }
  if (k === 'route2') {
    renderRoute('r1');
    renderRoute('r2');
    updateBuses();
    state.stopLayers.r2.forEach(x => state.layerVisibility[k] ? x.addTo(map) : map.removeLayer(x));
  }
  if (k === 'buses') { updateBuses(); renderCrowdBuses([...state.liveBusByTrip.values()]); }
  if (k === 'pmZones') state.mobilityLayers.forEach(x => state.layerVisibility[k] ? x.addTo(map) : map.removeLayer(x));
}));

map.on('zoomend', () => {
  if (!state.routeModels.r1?.ok && !state.routeModels.r2?.ok) return;
  renderRoute('r1');
  renderRoute('r2');
  updateBuses();
});

const dialog = document.getElementById('timetableDialog');
document.getElementById('timetableBtn').addEventListener('click', () => dialog.showModal());
document.getElementById('closeTimetable').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });

const guideDialog = document.getElementById('guideDialog');
if (guideDialog) {
  document.getElementById('guideBtn').addEventListener('click', () => guideDialog.showModal());
  document.getElementById('closeGuide').addEventListener('click', () => guideDialog.close());
  guideDialog.addEventListener('click', e => { if (e.target === guideDialog) guideDialog.close(); });
}


const crowdConsentDialog = document.getElementById('crowdConsentDialog');
document.getElementById('closeCrowdConsent')?.addEventListener('click', () => crowdConsentDialog.close());
document.getElementById('declineCrowdShare')?.addEventListener('click', () => { setRideSharing(false); crowdConsentDialog.close(); });
document.getElementById('acceptCrowdShare')?.addEventListener('click', () => { setRideSharing(true); crowdConsentDialog.close(); toast('탑승 중 익명 위치 공유를 켰습니다.'); });

const crowdingDialog = document.getElementById('crowdingDialog');
document.getElementById('closeCrowding')?.addEventListener('click', () => crowdingDialog.close());
document.querySelectorAll('[data-crowding]').forEach(btn => btn.addEventListener('click', () => submitCrowding(btn.dataset.crowding)));

document.getElementById('mobilePanelBtn').addEventListener('click', () => sidePanel.classList.add('open'));
document.getElementById('collapsePanel').addEventListener('click', () => sidePanel.classList.remove('open'));
document.querySelector('.brand-row').addEventListener('click', () => { if (innerWidth <= 720) sidePanel.classList.toggle('open'); });

async function bootMap() {
  await loadRouteStopOverrides();
  map.fitBounds(CAMPUS_BOUNDS, { padding: [20, 20] });
  await initializeRoutes();
  if (SIM) {
    const badge = document.getElementById('simBadge');
    if (badge) {
      const paint = () => { badge.textContent = `TEST ${SIM.speed}x · ${timeText(nowClock())}`; };
      badge.hidden = false;
      paint();
      setInterval(paint, 1000);
    }
    toast(`테스트 모드 · ${SIM.speed}배속 · ${timeText(nowClock())}부터 시작`);
  }
  // 로컬 개발/자동 캡처용 핸들. 운영 도메인에서는 노출하지 않습니다.
  if (['localhost', '127.0.0.1', '::1'].includes(location.hostname)) {
    window.__cambusDebug = { map, state, ROUTES, predictedPoint, nowClock };
  }
}
bootMap().catch(error => {
  console.error('CamBus map initialization failed', error);
  updateStatus('partial');
});


if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1', '::1'].includes(location.hostname))) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(err => console.warn('Service worker registration failed', err)));
}
