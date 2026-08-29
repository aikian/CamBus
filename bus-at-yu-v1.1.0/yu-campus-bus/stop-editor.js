const CAMPUS_CENTER = [35.8327, 128.7576];
const CAMPUS_BOUNDS = [[35.8248, 128.7490], [35.8388, 128.7645]];

const editorMap = L.map('editorMap', { zoomControl: true, minZoom: 14, maxZoom: 20 }).setView(CAMPUS_CENTER, 16);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 20,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(editorMap);

const elements = {
  stopList: document.getElementById('stopList'),
  selectedOrder: document.getElementById('selectedOrder'),
  selectedCode: document.getElementById('selectedCode'),
  selectedName: document.getElementById('selectedName'),
  selectedCoord: document.getElementById('selectedCoord'),
  connectionStatus: document.getElementById('connectionStatus'),
  saveButton: document.getElementById('saveButton'),
  saveState: document.getElementById('saveState'),
  updatedAt: document.getElementById('updatedAt'),
  undoButton: document.getElementById('undoButton'),
  autoNext: document.getElementById('autoNextInput'),
  guideDialog: document.getElementById('guideDialog'),
  guideImage: document.getElementById('guideImage'),
  guideTitle: document.getElementById('guideTitle'),
  toast: document.getElementById('editorToast')
};

const markerGroup = L.layerGroup().addTo(editorMap);
let routeData = null;
let activeRouteId = new URLSearchParams(location.search).get('route') === 'r2' ? 'r2' : 'r1';
let selectedIndex = 0;
let baseline = '';
let history = [];
let straightLine = null;
let roadLine = null;
let previewTimer = null;
let previewController = null;

function activeRoute() {
  return routeData?.routes?.[activeRouteId] || null;
}

function coordinatesSnapshot() {
  if (!routeData) return '';
  return JSON.stringify(['r1', 'r2'].map(routeId =>
    routeData.routes[routeId].stops.map(stop => [stop.id, stop.coord])
  ));
}

function isDirty() {
  return Boolean(routeData) && coordinatesSnapshot() !== baseline;
}

function syncDirtyState() {
  const dirty = isDirty();
  elements.saveButton.disabled = !dirty;
  elements.saveState.textContent = dirty ? '저장하지 않은 변경 있음' : '저장된 좌표';
  elements.undoButton.disabled = history.length === 0;
}

function toast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => elements.toast.classList.remove('show'), 2200);
}

function setConnectionStatus(message, state = '') {
  elements.connectionStatus.className = `connection-status ${state}`.trim();
  elements.connectionStatus.querySelector('span:last-child').textContent = message;
}

function markerIcon(index, selected, color) {
  return L.divIcon({
    className: '',
    html: `<div class="editor-stop-pin${selected ? ' selected' : ''}" style="--pin-color:${color}">${index + 1}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15]
  });
}

function renderSelectedStop() {
  const route = activeRoute();
  const stop = route?.stops?.[selectedIndex];
  if (!route || !stop) return;
  document.documentElement.style.setProperty('--route-color', route.color);
  elements.selectedOrder.textContent = String(selectedIndex + 1);
  elements.selectedCode.textContent = stop.code || '정류장';
  elements.selectedName.textContent = stop.name;
  elements.selectedCoord.textContent = `${stop.coord[0].toFixed(6)}, ${stop.coord[1].toFixed(6)}`;
}

function renderStopList() {
  const route = activeRoute();
  if (!route) return;
  elements.stopList.replaceChildren();
  route.stops.forEach((stop, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `stop-row${index === selectedIndex ? ' active' : ''}`;
    button.style.setProperty('--route-color', route.color);

    const number = document.createElement('span');
    number.className = 'stop-number';
    number.textContent = String(index + 1);
    const copy = document.createElement('span');
    copy.className = 'stop-copy';
    const name = document.createElement('strong');
    name.textContent = stop.name;
    const code = document.createElement('small');
    code.textContent = stop.code || stop.id;
    copy.append(name, code);
    const coord = document.createElement('span');
    coord.className = 'stop-coord';
    coord.textContent = `${stop.coord[0].toFixed(5)}\n${stop.coord[1].toFixed(5)}`;
    button.append(number, copy, coord);
    button.addEventListener('click', () => selectStop(index, true));
    elements.stopList.appendChild(button);
  });
  const selectedRow = elements.stopList.querySelector('.stop-row.active');
  selectedRow?.scrollIntoView({ block: 'nearest' });
}

function renderMapLayers({ fit = false } = {}) {
  const route = activeRoute();
  if (!route) return;
  markerGroup.clearLayers();
  route.stops.forEach((stop, index) => {
    const marker = L.marker(stop.coord, {
      icon: markerIcon(index, index === selectedIndex, route.color),
      draggable: true,
      zIndexOffset: index === selectedIndex ? 1000 : 100
    }).addTo(markerGroup);
    let dragStartCoord = null;
    marker.on('click', () => selectStop(index, false));
    marker.on('dragstart', () => { dragStartCoord = [...stop.coord]; });
    marker.on('dragend', event => {
      const latlng = event.target.getLatLng();
      updateStopCoord(index, [latlng.lat, latlng.lng], { previous: dragStartCoord, autoAdvance: false });
    });
  });

  const coords = route.stops.map(stop => stop.coord);
  if (straightLine) editorMap.removeLayer(straightLine);
  straightLine = L.polyline(coords, {
    color: '#5f6873', weight: 3, opacity: .65, dashArray: '3 9', lineCap: 'round'
  }).addTo(editorMap);
  straightLine.bringToBack();

  if (fit && coords.length) editorMap.fitBounds(L.latLngBounds(coords), { padding: [55, 55] });
  scheduleRoadPreview();
}

function renderAll(options = {}) {
  renderSelectedStop();
  renderStopList();
  renderMapLayers(options);
  syncDirtyState();
}

function selectStop(index, recenter = false) {
  const route = activeRoute();
  if (!route || index < 0 || index >= route.stops.length) return;
  selectedIndex = index;
  renderSelectedStop();
  renderStopList();
  renderMapLayers();
  if (recenter) editorMap.setView(route.stops[index].coord, Math.max(editorMap.getZoom(), 18));
}

function updateStopCoord(index, coord, { previous = null, autoAdvance = true } = {}) {
  const route = activeRoute();
  const stop = route?.stops?.[index];
  if (!stop) return;
  const next = [Number(coord[0].toFixed(6)), Number(coord[1].toFixed(6))];
  const before = previous || [...stop.coord];
  if (before[0] === next[0] && before[1] === next[1]) return;
  history.push({ routeId: activeRouteId, index, coord: before });
  stop.coord = next;
  selectedIndex = autoAdvance && elements.autoNext.checked
    ? Math.min(index + 1, route.stops.length - 1)
    : index;
  renderAll();
  toast(`${index + 1}번 정류장 좌표를 변경했습니다.`);
}

function scheduleRoadPreview() {
  clearTimeout(previewTimer);
  setConnectionStatus('도로를 따라 노선을 다시 연결하는 중…');
  previewTimer = setTimeout(refreshRoadPreview, 320);
}

async function refreshRoadPreview() {
  const route = activeRoute();
  if (!route) return;
  previewController?.abort();
  previewController = new AbortController();
  const coords = route.stops.map(stop => `${stop.coord[1]},${stop.coord[0]}`).join(';');
  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false&continue_straight=false`;
  try {
    const response = await fetch(url, { signal: previewController.signal });
    const data = await response.json();
    if (!response.ok || data.code !== 'Ok' || !data.routes?.[0]) throw new Error(data.message || data.code || 'route failed');
    const geometry = data.routes[0].geometry.coordinates.map(point => [point[1], point[0]]);
    if (roadLine) editorMap.removeLayer(roadLine);
    roadLine = L.polyline(geometry, { color: route.color, weight: 7, opacity: .86, lineJoin: 'round' }).addTo(editorMap);
    roadLine.bringToBack();
    straightLine?.bringToBack();
    setConnectionStatus(`도로 연결 완료 · ${(data.routes[0].distance / 1000).toFixed(1)}km`, 'ready');
  } catch (error) {
    if (error.name === 'AbortError') return;
    if (roadLine) {
      editorMap.removeLayer(roadLine);
      roadLine = null;
    }
    setConnectionStatus('도로 연결 실패 · 점선으로 정류장 순서만 표시', 'error');
  }
}

function switchRoute(routeId) {
  if (!routeData?.routes?.[routeId]) return;
  activeRouteId = routeId;
  selectedIndex = 0;
  document.querySelectorAll('.route-tab').forEach(button => {
    const active = button.dataset.route === routeId;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  if (roadLine) {
    editorMap.removeLayer(roadLine);
    roadLine = null;
  }
  renderAll({ fit: true });
}

function undo() {
  const change = history.pop();
  if (!change) return;
  const route = routeData.routes[change.routeId];
  route.stops[change.index].coord = [...change.coord];
  activeRouteId = change.routeId;
  selectedIndex = change.index;
  document.querySelectorAll('.route-tab').forEach(button => {
    const active = button.dataset.route === activeRouteId;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  renderAll();
  toast('직전 좌표 변경을 되돌렸습니다.');
}

async function save() {
  if (!isDirty()) return;
  elements.saveButton.disabled = true;
  elements.saveButton.textContent = '저장 중…';
  try {
    const response = await fetch('/api/route-stops', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(routeData)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `save ${response.status}`);
    routeData.updatedAt = result.updatedAt;
    routeData.routes = result.routes;
    baseline = coordinatesSnapshot();
    history = [];
    elements.updatedAt.textContent = new Date(result.updatedAt).toLocaleString('ko-KR');
    renderAll();
    toast('저장했습니다. CamBus를 새로고침하면 반영됩니다.');
  } catch (error) {
    console.error(error);
    toast('저장하지 못했습니다. Node 서버로 열었는지 확인하세요.');
  } finally {
    elements.saveButton.textContent = '좌표 저장';
    syncDirtyState();
  }
}

function showGuide() {
  const route = activeRoute();
  if (!route) return;
  elements.guideTitle.textContent = `${route.name} 손그림`;
  elements.guideImage.src = route.guideImage;
  elements.guideImage.alt = `${route.name} 손그림 노선도`;
  elements.guideDialog.showModal();
}

async function copySelectedCoord() {
  const stop = activeRoute()?.stops?.[selectedIndex];
  if (!stop) return;
  const text = `${stop.coord[0].toFixed(6)}, ${stop.coord[1].toFixed(6)}`;
  try {
    await navigator.clipboard.writeText(text);
    toast('좌표를 복사했습니다.');
  } catch {
    toast(text);
  }
}

async function load() {
  try {
    let response = await fetch('/api/route-stops', { cache: 'no-store' });
    if (!response.ok) response = await fetch('./data/route-stops.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`load ${response.status}`);
    routeData = await response.json();
    baseline = coordinatesSnapshot();
    document.querySelectorAll('.route-tab').forEach(button => {
      const active = button.dataset.route === activeRouteId;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    elements.updatedAt.textContent = routeData.updatedAt
      ? new Date(routeData.updatedAt).toLocaleString('ko-KR')
      : '초기 좌표 · 아직 편집하지 않음';
    renderAll({ fit: true });
  } catch (error) {
    console.error(error);
    setConnectionStatus('정류장 데이터를 불러오지 못했습니다.', 'error');
    toast('정류장 데이터를 불러오지 못했습니다.');
  }
}

editorMap.on('click', event => {
  if (!activeRoute()?.stops?.[selectedIndex]) return;
  updateStopCoord(selectedIndex, [event.latlng.lat, event.latlng.lng], { autoAdvance: true });
});

document.querySelectorAll('.route-tab').forEach(button => button.addEventListener('click', () => switchRoute(button.dataset.route)));
document.getElementById('guideButton').addEventListener('click', showGuide);
document.getElementById('fitButton').addEventListener('click', () => renderMapLayers({ fit: true }));
document.getElementById('undoButton').addEventListener('click', undo);
document.getElementById('saveButton').addEventListener('click', save);
document.getElementById('copyCoordBtn').addEventListener('click', copySelectedCoord);
document.getElementById('closeGuideButton').addEventListener('click', () => elements.guideDialog.close());
elements.guideDialog.addEventListener('click', event => { if (event.target === elements.guideDialog) elements.guideDialog.close(); });
window.addEventListener('beforeunload', event => { if (isDirty()) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    save();
  }
});

load();
