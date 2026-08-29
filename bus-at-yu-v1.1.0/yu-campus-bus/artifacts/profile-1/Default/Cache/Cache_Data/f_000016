const CAMPUS_CENTER = [35.8327, 128.7576];
const pathMap = L.map('pathMap', { zoomControl: true, minZoom: 14, maxZoom: 20 }).setView(CAMPUS_CENTER, 16);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 20, attribution: '&copy; OpenStreetMap contributors' }).addTo(pathMap);

const ui = Object.fromEntries([
  'legList','selectedOrder','selectedCode','selectedName','selectedMeta','connectionStatus','saveButton','saveState','updatedAt',
  'undoButton','timingInput','measureButton','removeAnchorButton','clearAnchorsButton','guideDialog','guideImage','guideTitle','pathToast'
].map(id => [id, document.getElementById(id)]));

let stopsData = null;
let pathData = null;
let timingData = null;
let activeRouteId = new URLSearchParams(location.search).get('route') === 'r2' ? 'r2' : 'r1';
let selectedLegIndex = 0;
let baseline = '';
let history = [];
let compileTimer = null;
let compileController = null;
let compiling = false;
let measureStartedAt = null;
let measureTicker = null;
const layerGroup = L.layerGroup().addTo(pathMap);

const clone = value => JSON.parse(JSON.stringify(value));
const activeStops = () => stopsData?.routes?.[activeRouteId]?.stops || [];
const activePath = () => pathData?.routes?.[activeRouteId] || null;
const legKey = index => `${activeStops()[index].id}>${activeStops()[index + 1].id}`;
const activeAnchors = () => activePath()?.anchors?.[legKey(selectedLegIndex)] || [];

function editableSnapshot() {
  if (!pathData || !timingData) return '';
  return JSON.stringify(['r1','r2'].map(routeId => ({
    anchors: pathData.routes?.[routeId]?.anchors || {},
    timings: timingData.routes?.[routeId]?.legs || []
  })));
}

function toast(message) {
  ui.pathToast.textContent = message;
  ui.pathToast.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ui.pathToast.classList.remove('show'), 2300);
}

function status(message, state = '') {
  ui.connectionStatus.className = `connection-status ${state}`.trim();
  ui.connectionStatus.querySelector('span:last-child').textContent = message;
}

function pushHistory() {
  history.push({ pathData: clone(pathData), timingData: clone(timingData), routeId: activeRouteId, legIndex: selectedLegIndex });
  if (history.length > 30) history.shift();
}

function syncDirty() {
  const dirty = editableSnapshot() !== baseline;
  ui.saveButton.disabled = !dirty || compiling;
  ui.saveState.textContent = dirty ? '저장하지 않은 변경 있음' : '저장된 노선';
  ui.undoButton.disabled = history.length === 0;
}

function stopIcon(index, color) {
  return L.divIcon({ className:'', html:`<div class="path-stop-pin" style="--pin-color:${color}">${index + 1}</div>`, iconSize:[23,23], iconAnchor:[12,12] });
}

function anchorIcon(index) {
  return L.divIcon({ className:'', html:`<div class="path-anchor-pin">${index + 1}</div>`, iconSize:[28,28], iconAnchor:[14,14] });
}

function renderSelected() {
  const stops = activeStops();
  const path = activePath();
  if (!stops.length || !path) return;
  const from = stops[selectedLegIndex];
  const to = stops[selectedLegIndex + 1];
  const anchors = activeAnchors();
  const timing = timingData.routes[activeRouteId].legs[selectedLegIndex];
  document.documentElement.style.setProperty('--route-color', stopsData.routes[activeRouteId].color);
  ui.selectedOrder.textContent = String(selectedLegIndex + 1);
  ui.selectedCode.textContent = `구간 ${selectedLegIndex + 1}`;
  ui.selectedName.textContent = `${from.name} → ${to.name}`;
  ui.selectedMeta.textContent = `경유점 ${anchors.length}개 · ${timing == null ? '도로 예상시간 사용' : `실측 ${timing}초`}`;
  ui.timingInput.value = timing == null ? '' : String(timing);
  ui.removeAnchorButton.disabled = anchors.length === 0;
  ui.clearAnchorsButton.disabled = anchors.length === 0;
}

function renderLegList() {
  const stops = activeStops();
  const path = activePath();
  ui.legList.replaceChildren();
  for (let index = 0; index < stops.length - 1; index++) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `stop-row${index === selectedLegIndex ? ' active' : ''}`;
    button.style.setProperty('--route-color', stopsData.routes[activeRouteId].color);
    const number = document.createElement('span');
    number.className = 'stop-number';
    number.textContent = String(index + 1);
    const copy = document.createElement('span');
    copy.className = 'stop-copy';
    const name = document.createElement('strong');
    name.textContent = `${stops[index].name} → ${stops[index + 1].name}`;
    const meta = document.createElement('small');
    meta.textContent = `경유점 ${(path.anchors?.[`${stops[index].id}>${stops[index + 1].id}`] || []).length}개`;
    copy.append(name, meta);
    const time = document.createElement('span');
    time.className = 'leg-time';
    const seconds = timingData.routes[activeRouteId].legs[index];
    time.textContent = seconds == null ? '자동' : `${seconds}초`;
    button.append(number, copy, time);
    button.addEventListener('click', () => { selectedLegIndex = index; stopMeasurement(); renderAll(); fitSelectedLeg(); });
    ui.legList.appendChild(button);
  }
  ui.legList.querySelector('.active')?.scrollIntoView({ block:'nearest' });
}

function renderMap({ fit = false } = {}) {
  layerGroup.clearLayers();
  const stops = activeStops();
  const route = activePath();
  if (!stops.length || !route) return;
  const color = stopsData.routes[activeRouteId].color;
  if (Array.isArray(route.geometry) && route.geometry.length > 1) {
    L.polyline(route.geometry, { color:'#fff', weight:11, opacity:.9, interactive:false }).addTo(layerGroup);
    L.polyline(route.geometry, { color, weight:7, opacity:.9, interactive:false }).addTo(layerGroup);
  }
  const selectedGeometry = route.legs?.[selectedLegIndex]?.geometry;
  if (Array.isArray(selectedGeometry) && selectedGeometry.length > 1) {
    L.polyline(selectedGeometry, { color:'#ff9f1c', weight:5, opacity:.95, interactive:false }).addTo(layerGroup);
  }
  stops.forEach((stop, index) => L.marker(stop.coord, { icon:stopIcon(index, color), zIndexOffset:500 }).addTo(layerGroup));
  activeAnchors().forEach((coord, index) => {
    const marker = L.marker(coord, { icon:anchorIcon(index), draggable:true, zIndexOffset:1000 }).addTo(layerGroup);
    marker.on('dragstart', pushHistory);
    marker.on('dragend', event => {
      const point = event.target.getLatLng();
      activePath().anchors[legKey(selectedLegIndex)][index] = [Number(point.lat.toFixed(6)), Number(point.lng.toFixed(6))];
      scheduleCompile();
      renderAll();
    });
  });
  if (fit && route.geometry?.length) pathMap.fitBounds(L.latLngBounds(route.geometry), { padding:[55,55] });
}

function renderAll(options = {}) {
  renderSelected();
  renderLegList();
  renderMap(options);
  syncDirty();
}

function fitSelectedLeg() {
  const geometry = activePath()?.legs?.[selectedLegIndex]?.geometry;
  if (geometry?.length) pathMap.fitBounds(L.latLngBounds(geometry), { padding:[90,90] });
}

function expandedRoute(routeId) {
  const stops = stopsData.routes[routeId].stops;
  const route = pathData.routes[routeId];
  const coordinates = [];
  const waypointIndices = [];
  for (let index = 0; index < stops.length; index++) {
    waypointIndices.push(coordinates.length);
    coordinates.push(stops[index].coord);
    if (index < stops.length - 1) coordinates.push(...(route.anchors?.[`${stops[index].id}>${stops[index + 1].id}`] || []));
  }
  return { stops, route, coordinates, waypointIndices };
}

function scheduleCompile() {
  clearTimeout(compileTimer);
  compiling = true;
  status('경유점을 반영해 노선을 다시 연결하는 중…');
  syncDirty();
  compileTimer = setTimeout(compileActiveRoute, 350);
}

async function compileActiveRoute() {
  const routeId = activeRouteId;
  const { stops, route, coordinates, waypointIndices } = expandedRoute(routeId);
  compileController?.abort();
  compileController = new AbortController();
  const coords = coordinates.map(([lat,lng]) => `${lng},${lat}`).join(';');
  const params = new URLSearchParams({ overview:'full', geometries:'geojson', steps:'true', annotations:'false', continue_straight:'false', waypoints:waypointIndices.join(';') });
  try {
    const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?${params}`, { signal:compileController.signal });
    const data = await response.json();
    if (!response.ok || data.code !== 'Ok' || !data.routes?.[0]) throw new Error(data.message || data.code || 'route failed');
    const result = data.routes[0];
    if (result.legs.length !== stops.length - 1) throw new Error('정류장 구간 수가 일치하지 않습니다.');
    route.stopIds = stops.map(stop => stop.id);
    route.stopCoords = stops.map(stop => stop.coord);
    route.geometry = result.geometry.coordinates.map(([lng,lat]) => [lat,lng]);
    route.distance = result.distance;
    route.duration = result.duration;
    route.legs = result.legs.map((leg, index) => {
      const geometry = [];
      for (const step of leg.steps || []) for (const [lng,lat] of step.geometry?.coordinates || []) {
        const point = [lat,lng];
        const last = geometry.at(-1);
        if (!last || last[0] !== point[0] || last[1] !== point[1]) geometry.push(point);
      }
      if (geometry.length < 2) geometry.push(stops[index].coord, stops[index + 1].coord);
      return { fromId:stops[index].id, toId:stops[index + 1].id, duration:leg.duration, distance:leg.distance, geometry };
    });
    status(`고정 노선 준비 완료 · ${(result.distance / 1000).toFixed(1)}km`, 'ready');
    renderAll();
  } catch (error) {
    if (error.name === 'AbortError') return;
    status(`노선 연결 실패 · ${error.message}`, 'error');
    toast('경유점을 줄이거나 도로 위에 다시 찍어주세요.');
  } finally {
    compiling = false;
    syncDirty();
  }
}

function addAnchor(coord) {
  pushHistory();
  const key = legKey(selectedLegIndex);
  if (!activePath().anchors[key]) activePath().anchors[key] = [];
  if (activePath().anchors[key].length >= 24) return toast('한 구간에는 경유점을 최대 24개까지 넣을 수 있습니다.');
  activePath().anchors[key].push([Number(coord.lat.toFixed(6)), Number(coord.lng.toFixed(6))]);
  scheduleCompile();
  renderAll();
}

function removeLastAnchor(clearAll = false) {
  const anchors = activeAnchors();
  if (!anchors.length) return;
  pushHistory();
  if (clearAll) anchors.splice(0); else anchors.pop();
  scheduleCompile();
  renderAll();
}

function undo() {
  const previous = history.pop();
  if (!previous) return;
  pathData = previous.pathData;
  timingData = previous.timingData;
  activeRouteId = previous.routeId;
  selectedLegIndex = previous.legIndex;
  syncTabs();
  stopMeasurement();
  renderAll();
  toast('직전 변경을 되돌렸습니다.');
}

function setTiming(raw) {
  const value = raw === '' ? null : Number(raw);
  if (value != null && (!Number.isFinite(value) || value < 10 || value > 1800)) return;
  pushHistory();
  timingData.routes[activeRouteId].legs[selectedLegIndex] = value == null ? null : Math.round(value);
  renderAll();
}

function stopMeasurement() {
  measureStartedAt = null;
  clearInterval(measureTicker);
  measureTicker = null;
  ui.measureButton.classList.remove('measuring');
  ui.measureButton.textContent = '측정 시작';
}

function toggleMeasurement() {
  if (measureStartedAt == null) {
    measureStartedAt = Date.now();
    ui.measureButton.classList.add('measuring');
    ui.measureButton.textContent = '도착 기록';
    measureTicker = setInterval(() => { ui.measureButton.textContent = `${Math.floor((Date.now() - measureStartedAt) / 1000)}초 · 도착`; }, 1000);
    return;
  }
  const seconds = Math.round((Date.now() - measureStartedAt) / 1000);
  stopMeasurement();
  if (seconds < 10) return toast('측정값은 10초 이상이어야 합니다.');
  setTiming(String(seconds));
  toast(`${seconds}초를 선택 구간에 기록했습니다.`);
}

function syncTabs() {
  document.querySelectorAll('.route-tab').forEach(button => {
    const active = button.dataset.route === activeRouteId;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
}

function switchRoute(routeId) {
  if (!stopsData.routes?.[routeId]) return;
  activeRouteId = routeId;
  selectedLegIndex = 0;
  stopMeasurement();
  syncTabs();
  renderAll({ fit:true });
}

async function save() {
  if (compiling || editableSnapshot() === baseline) return;
  ui.saveButton.disabled = true;
  ui.saveButton.textContent = '저장 중…';
  try {
    const [pathResponse, timingResponse] = await Promise.all([
      fetch('/api/route-paths', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(pathData) }),
      fetch('/api/route-timings', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(timingData) })
    ]);
    const pathResult = await pathResponse.json();
    const timingResult = await timingResponse.json();
    if (!pathResponse.ok) throw new Error(pathResult.error || `path save ${pathResponse.status}`);
    if (!timingResponse.ok) throw new Error(timingResult.error || `timing save ${timingResponse.status}`);
    pathData.updatedAt = pathResult.updatedAt;
    pathData.routes = pathResult.routes;
    timingData.updatedAt = timingResult.updatedAt;
    timingData.routes = timingResult.routes;
    history = [];
    baseline = editableSnapshot();
    ui.updatedAt.textContent = new Date(pathResult.updatedAt).toLocaleString('ko-KR');
    renderAll();
    toast('고정 노선과 실측 시간을 저장했습니다.');
  } catch (error) {
    console.error(error);
    toast(`저장하지 못했습니다: ${error.message}`);
  } finally {
    ui.saveButton.textContent = '노선·시간 저장';
    syncDirty();
  }
}

function showGuide() {
  ui.guideTitle.textContent = activeRouteId === 'r1' ? '1노선 손그림 노선도' : '2노선 손그림 노선도';
  ui.guideImage.src = activeRouteId === 'r1' ? './route-guide-r1.png' : './route-guide-r2.png';
  ui.guideDialog.showModal();
}

async function loadJson(api, fallback) {
  let response = await fetch(api, { cache:'no-store' });
  if (!response.ok) response = await fetch(fallback, { cache:'no-store' });
  if (!response.ok) throw new Error(`${api} ${response.status}`);
  return response.json();
}

async function load() {
  try {
    [stopsData, pathData, timingData] = await Promise.all([
      loadJson('/api/route-stops', './data/route-stops.json'),
      loadJson('/api/route-paths', './data/route-paths.json'),
      loadJson('/api/route-timings', './data/route-timings.json')
    ]);
    for (const routeId of ['r1','r2']) {
      const stopCount = stopsData.routes[routeId].stops.length;
      pathData.routes[routeId].anchors ||= {};
      timingData.routes[routeId] ||= { source:'field-measured', legs:Array(stopCount - 1).fill(null) };
    }
    baseline = editableSnapshot();
    ui.updatedAt.textContent = pathData.updatedAt ? new Date(pathData.updatedAt).toLocaleString('ko-KR') : '아직 저장하지 않음';
    syncTabs();
    renderAll({ fit:true });
    status('저장된 고정 노선을 사용 중 · 경유점을 추가하면 다시 계산됩니다.', 'ready');
  } catch (error) {
    console.error(error);
    status('데이터를 불러오지 못했습니다. Node 서버를 확인하세요.', 'error');
  }
}

pathMap.on('click', event => addAnchor(event.latlng));
document.querySelectorAll('.route-tab').forEach(button => button.addEventListener('click', () => switchRoute(button.dataset.route)));
document.getElementById('guideButton').addEventListener('click', showGuide);
document.getElementById('fitButton').addEventListener('click', () => renderMap({ fit:true }));
ui.undoButton.addEventListener('click', undo);
ui.removeAnchorButton.addEventListener('click', () => removeLastAnchor(false));
ui.clearAnchorsButton.addEventListener('click', () => removeLastAnchor(true));
ui.timingInput.addEventListener('change', event => setTiming(event.target.value));
ui.measureButton.addEventListener('click', toggleMeasurement);
ui.saveButton.addEventListener('click', save);
document.getElementById('closeGuideButton').addEventListener('click', () => ui.guideDialog.close());
ui.guideDialog.addEventListener('click', event => { if (event.target === ui.guideDialog) ui.guideDialog.close(); });
window.addEventListener('beforeunload', event => { if (editableSnapshot() !== baseline) { event.preventDefault(); event.returnValue = ''; } });
load();
