(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CamBusRouteUtils = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function canonicalStopIndex(stopCount, index) {
    const count = Number(stopCount);
    const value = Number(index);
    if (!Number.isInteger(count) || count < 2 || !Number.isInteger(value)) return null;
    const serviceStopCount = count - 1;
    if (value < 0 || value >= count) return null;
    return value === serviceStopCount ? 0 : value;
  }

  function routeLegIndices(stopCount, boardIndex, alightIndex) {
    const legCount = Number(stopCount) - 1;
    const board = canonicalStopIndex(stopCount, boardIndex);
    const alight = canonicalStopIndex(stopCount, alightIndex);
    if (!Number.isInteger(legCount) || legCount < 1 || board == null || alight == null || board === alight) return [];
    const result = [];
    let cursor = board;
    while (cursor !== alight && result.length < legCount) {
      result.push(cursor);
      cursor = (cursor + 1) % legCount;
    }
    return cursor === alight ? result : [];
  }

  function serviceStopEntries(stops) {
    if (!Array.isArray(stops)) return [];
    const stopCount = stops.length;
    const serviceStopCount = Math.max(0, stopCount - 1);
    return stops.slice(0, serviceStopCount).map((stop, index) => ({ stop, index }));
  }

  function haversineMeters(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b)) return Infinity;
    const R = 6371000, rad = Math.PI / 180;
    const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }

  // Groups stops that share the school's own stop code (e.g. "서문", "F21", "B04") across
  // different routes into a transfer station. A code repeated within a single route (a loop
  // passing the same point twice) is not a transfer and is collapsed to its first occurrence.
  function buildTransferStations(routesMap) {
    const byCode = new Map();
    for (const routeId of Object.keys(routesMap || {})) {
      const stops = routesMap[routeId]?.stops || [];
      stops.forEach((stopInfo, index) => {
        const code = stopInfo?.code;
        if (!code) return;
        if (!byCode.has(code)) byCode.set(code, []);
        const bucket = byCode.get(code);
        if (!bucket.some(m => m.routeId === routeId)) {
          bucket.push({ routeId, index, name: stopInfo.name, coord: stopInfo.coord });
        }
      });
    }
    const stations = [];
    for (const [code, members] of byCode) {
      if (members.length < 2) continue;
      stations.push({ code, name: members[0].name, members });
    }
    return stations;
  }

  // Straight-line walking estimate between two colocated/near stop points. Real "same pole"
  // transfers (a few meters apart) resolve to ~0s; a further shared-code stop pair (e.g. two
  // crosswalks on opposite sides of the same building) gets a small honest walking estimate.
  function transferWalkSeconds(a, b, walkSpeedMps = 1.2) {
    return haversineMeters(a, b) / walkSpeedMps;
  }

  return { canonicalStopIndex, routeLegIndices, serviceStopEntries, haversineMeters, buildTransferStations, transferWalkSeconds };
});
