/* 대구 도시철도 경로 탐색
 *
 * data/subway-daegu.json 의 노선·역 배열을 그래프로 보고 다익스트라로 최소 시간 경로를
 * 찾습니다. 상태는 (노선, 역 인덱스)이며 같은 이름의 역 사이 이동을 환승으로 봅니다.
 *
 * 역간 소요시간은 표정속도 기반 추정치입니다(데이터 파일 note 참고).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CamBusSubway = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function haversine(a, b) {
    const R = 6371000, rad = Math.PI / 180;
    const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }

  function build(doc) {
    const lines = doc.lines || [];
    const transferSeconds = Number(doc.transferSeconds) || 240;

    // 역 이름 -> [{lineIdx, stationIdx}]
    const index = new Map();
    lines.forEach((line, li) => {
      line.stations.forEach((station, si) => {
        if (!index.has(station.name)) index.set(station.name, []);
        index.get(station.name).push({ lineIdx: li, stationIdx: si });
      });
    });

    const key = (li, si) => `${li}:${si}`;
    const stationAt = (li, si) => lines[li].stations[si];

    /** 좌표에서 maxMeters 안에 있는 역을 가까운 순으로 돌려줍니다. */
    function nearestStations(coord, maxMeters = 1200, limit = 4) {
      const seen = new Map();
      lines.forEach((line, li) => line.stations.forEach((s, si) => {
        const d = haversine(coord, s.coord);
        if (d > maxMeters) return;
        const prev = seen.get(s.name);
        if (!prev || d < prev.distance) seen.set(s.name, { name: s.name, coord: s.coord, distance: d, lineIdx: li, stationIdx: si });
      }));
      return [...seen.values()].sort((a, b) => a.distance - b.distance).slice(0, limit);
    }

    /** 두 역 사이 최소 시간 경로. 결과는 노선별 구간 목록입니다. */
    function findRoute(fromName, toName) {
      const starts = index.get(fromName) || [];
      const goals = new Set((index.get(toName) || []).map(p => key(p.lineIdx, p.stationIdx)));
      if (!starts.length || !goals.size) return null;

      const dist = new Map();
      const prev = new Map();
      const queue = [];
      for (const s of starts) {
        const k = key(s.lineIdx, s.stationIdx);
        dist.set(k, 0);
        queue.push({ k, cost: 0, lineIdx: s.lineIdx, stationIdx: s.stationIdx });
      }

      let goalKey = null;
      while (queue.length) {
        queue.sort((a, b) => a.cost - b.cost);
        const cur = queue.shift();
        if (cur.cost > (dist.get(cur.k) ?? Infinity)) continue;
        if (goals.has(cur.k)) { goalKey = cur.k; break; }

        const line = lines[cur.lineIdx];
        const neighbours = [];
        // 같은 노선 앞뒤 역
        if (cur.stationIdx > 0) {
          neighbours.push({ lineIdx: cur.lineIdx, stationIdx: cur.stationIdx - 1, cost: line.hopSeconds[cur.stationIdx - 1], type: 'ride' });
        }
        if (cur.stationIdx < line.stations.length - 1) {
          neighbours.push({ lineIdx: cur.lineIdx, stationIdx: cur.stationIdx + 1, cost: line.hopSeconds[cur.stationIdx], type: 'ride' });
        }
        // 같은 이름의 다른 노선 = 환승
        for (const other of index.get(stationAt(cur.lineIdx, cur.stationIdx).name) || []) {
          if (other.lineIdx === cur.lineIdx) continue;
          neighbours.push({ lineIdx: other.lineIdx, stationIdx: other.stationIdx, cost: transferSeconds, type: 'transfer' });
        }

        for (const n of neighbours) {
          const nk = key(n.lineIdx, n.stationIdx);
          const next = cur.cost + n.cost;
          if (next < (dist.get(nk) ?? Infinity)) {
            dist.set(nk, next);
            prev.set(nk, { from: cur.k, type: n.type });
            queue.push({ k: nk, cost: next, lineIdx: n.lineIdx, stationIdx: n.stationIdx });
          }
        }
      }
      if (!goalKey) return null;

      // 경로 역추적
      const path = [];
      let cursor = goalKey;
      while (cursor) {
        const [li, si] = cursor.split(':').map(Number);
        const step = prev.get(cursor);
        path.push({ lineIdx: li, stationIdx: si, type: step?.type });
        cursor = step?.from;
      }
      path.reverse();

      // 노선별 구간으로 묶기
      const segments = [];
      for (const node of path) {
        const line = lines[node.lineIdx];
        const station = line.stations[node.stationIdx];
        const last = segments[segments.length - 1];
        if (last && last.lineIdx === node.lineIdx && node.type !== 'transfer') {
          // 이동한 두 역 사이 소요시간을 구간에 누적합니다(막대 비율에 씁니다).
          const prevIdx = last.stationIdx;
          const hop = line.hopSeconds[Math.min(prevIdx, node.stationIdx)] || 0;
          last.to = station.name;
          last.toCoord = station.coord;
          last.stationIdx = node.stationIdx;
          last.stops += 1;
          last.seconds += hop;
        } else {
          segments.push({
            lineIdx: node.lineIdx, ref: line.ref, lineName: line.name,
            from: station.name, fromCoord: station.coord,
            to: station.name, toCoord: station.coord,
            stationIdx: node.stationIdx, stops: 0, seconds: 0
          });
        }
      }
      const ride = segments.filter(s => s.stops > 0);
      return {
        seconds: dist.get(goalKey),
        transfers: Math.max(0, ride.length - 1),
        segments: ride
      };
    }

    function findStationCoord(name) {
      const hit = (index.get(name) || [])[0];
      return hit ? stationAt(hit.lineIdx, hit.stationIdx).coord : null;
    }

    return { nearestStations, findRoute, findStationCoord, lines, transferSeconds };
  }

  return { build, haversine };
});
