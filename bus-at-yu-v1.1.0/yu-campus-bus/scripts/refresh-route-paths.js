#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const STOPS_FILE = path.join(ROOT, 'data', 'route-stops.json');
const PATHS_FILE = path.join(ROOT, 'data', 'route-paths.json');
const ROUTER = process.env.CAMBUS_OSRM_URL || 'https://router.project-osrm.org';

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function validCoord(coord) {
  return Array.isArray(coord) && coord.length === 2 && coord.every(Number.isFinite);
}

function legKey(fromId, toId) {
  return `${fromId}>${toId}`;
}

async function compileRoute(routeId, stopRoute, previous) {
  const stops = stopRoute.stops;
  const anchors = {};
  const coordinates = [];
  const waypointIndices = [];

  for (let i = 0; i < stops.length; i++) {
    waypointIndices.push(coordinates.length);
    coordinates.push(stops[i].coord);
    if (i >= stops.length - 1) continue;
    const key = legKey(stops[i].id, stops[i + 1].id);
    const saved = Array.isArray(previous?.anchors?.[key])
      ? previous.anchors[key].filter(validCoord).slice(0, 24)
      : [];
    anchors[key] = saved;
    coordinates.push(...saved);
  }

  const coordText = coordinates.map(([lat, lng]) => `${lng},${lat}`).join(';');
  const params = new URLSearchParams({
    overview: 'full',
    geometries: 'geojson',
    steps: 'true',
    annotations: 'false',
    continue_straight: 'false',
    waypoints: waypointIndices.join(';')
  });
  const response = await fetch(`${ROUTER}/route/v1/driving/${coordText}?${params}`);
  const data = await response.json();
  if (!response.ok || data.code !== 'Ok' || !data.routes?.[0]) {
    throw new Error(`${routeId}: ${data.message || data.code || response.status}`);
  }
  const result = data.routes[0];
  if (!Array.isArray(result.legs) || result.legs.length !== stops.length - 1) {
    throw new Error(`${routeId}: expected ${stops.length - 1} legs, got ${result.legs?.length}`);
  }

  const legs = result.legs.map((leg, index) => {
    const geometry = [];
    for (const step of leg.steps || []) {
      for (const [lng, lat] of step.geometry?.coordinates || []) {
        const point = [lat, lng];
        const last = geometry.at(-1);
        if (!last || last[0] !== point[0] || last[1] !== point[1]) geometry.push(point);
      }
    }
    if (geometry.length < 2) geometry.push(stops[index].coord, stops[index + 1].coord);
    return {
      fromId: stops[index].id,
      toId: stops[index + 1].id,
      duration: leg.duration,
      distance: leg.distance,
      geometry
    };
  });

  return {
    stopIds: stops.map(stop => stop.id),
    stopCoords: stops.map(stop => stop.coord),
    anchors,
    geometry: result.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    distance: result.distance,
    duration: result.duration,
    legs
  };
}

async function main() {
  const stopData = readJson(STOPS_FILE, null);
  if (!stopData?.routes) throw new Error('route-stops.json is missing or invalid.');
  const previous = readJson(PATHS_FILE, { routes: {} });
  const routes = {};
  for (const routeId of ['r1', 'r2']) {
    routes[routeId] = await compileRoute(routeId, stopData.routes[routeId], previous.routes?.[routeId]);
    console.log(`${routeId}: ${routes[routeId].legs.length} legs, ${Math.round(routes[routeId].distance)}m`);
  }
  const output = {
    version: 1,
    updatedAt: new Date().toISOString(),
    source: 'compiled-osrm-with-manual-anchors',
    routes
  };
  fs.writeFileSync(PATHS_FILE + '.tmp', JSON.stringify(output, null, 2) + '\n');
  fs.renameSync(PATHS_FILE + '.tmp', PATHS_FILE);
  console.log(`Wrote ${PATHS_FILE}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
