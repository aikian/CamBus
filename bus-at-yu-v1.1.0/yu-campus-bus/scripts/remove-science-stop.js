const fs = require('node:fs');
const path = require('node:path');

function updateFile(dir, name, edit) {
  const file = path.join(dir, name + '.json');
  if (!fs.existsSync(file)) return;
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!edit(data)) return;
  data.updatedAt = new Date().toISOString();
  fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(file + '.tmp', file);
}

function mergeLegs(route, index) {
  const [first, second] = route.legs.slice(index - 1, index + 1);
  const before = first.fromId + '>' + first.toId;
  const after = second.fromId + '>' + second.toId;
  route.anchors[first.fromId + '>' + second.toId] = [
    ...(route.anchors[before] || []), route.stopCoords[index], ...(route.anchors[after] || [])
  ];
  delete route.anchors[before];
  delete route.anchors[after];
  const samePoint = first.geometry.at(-1).every((v, i) => v === second.geometry[0][i]);
  route.legs.splice(index - 1, 2, {
    fromId: first.fromId, toId: second.toId,
    duration: Number((first.duration + second.duration).toFixed(1)),
    distance: Number((first.distance + second.distance).toFixed(1)),
    geometry: first.geometry.concat(second.geometry.slice(samePoint ? 1 : 0))
  });
  route.stopIds.splice(index, 1);
  route.stopCoords.splice(index, 1);
}

// The stops file is written last. Each earlier update can be retried independently.
function removeScienceStop(dir) {
  updateFile(dir, 'route-stops', data => {
    let changed = false;
    for (const [routeId, route] of Object.entries(data.routes)) {
      const index = route.stops.findIndex(stop => stop.code === 'F21');
      if (index < 1) continue;
      const removedId = route.stops[index].id;
      updateFile(dir, 'route-paths', paths => {
        const saved = paths.routes[routeId];
        const pos = saved?.stopIds.indexOf(removedId) ?? -1;
        if (pos < 1) return false;
        mergeLegs(saved, pos);
        return true;
      });
      updateFile(dir, 'route-timings', timings => {
        const legs = timings.routes[routeId]?.legs;
        if (legs?.length !== route.stops.length - 1) return false;
        // Keep unrelated field measurements. Recalibrate the newly joined leg.
        legs.splice(index - 1, 2, null);
        return true;
      });
      updateFile(dir, 'leg-stats', stats => {
        const samples = stats.routes[routeId];
        if (!samples || samples.removedStopId === removedId) return false;
        for (const type of ['travel', 'dwell']) {
          const retained = {};
          for (const [key, entry] of Object.entries(samples[type] || {})) {
            const i = Number(key);
            if (i === index || (type === 'travel' && i === index - 1)) continue;
            retained[i > index ? i - 1 : i] = entry;
          }
          samples[type] = retained;
        }
        samples.removedStopId = removedId;
        return true;
      });
      route.stops.splice(index, 1);
      changed = true;
    }
    return changed;
  });
}

module.exports = { removeScienceStop };
