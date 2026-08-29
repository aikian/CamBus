const test = require('node:test');
const assert = require('node:assert/strict');
const { canonicalStopIndex, routeLegIndices, serviceStopEntries, buildTransferStations, transferWalkSeconds } = require('../route-utils');

test('duplicated loop terminal resolves to the first service stop', () => {
  assert.equal(canonicalStopIndex(11, 10), 0);
  assert.equal(canonicalStopIndex(11, 9), 9);
});

test('route legs wrap across the duplicated terminal', () => {
  assert.deepEqual(routeLegIndices(11, 8, 2), [8, 9, 0, 1]);
  assert.deepEqual(routeLegIndices(11, 10, 2), [0, 1]);
  assert.deepEqual(routeLegIndices(11, 3, 3), []);
});

test('service stop list excludes only the duplicated final terminal', () => {
  const stops = Array.from({ length: 11 }, (_, index) => ({ id: index }));
  assert.deepEqual(serviceStopEntries(stops).map(entry => entry.index), [0,1,2,3,4,5,6,7,8,9]);
});

test('transfer stations only form where a stop code is shared across different routes', () => {
  const routesMap = {
    r1: { stops: [
      { code: 'A02', name: '국제교류센터', coord: [0, 0] },
      { code: '서문', name: '서문', coord: [1, 1] },
      { code: 'B03', name: '인문관', coord: [2, 2] },
      { code: 'B03', name: '인문관(복귀)', coord: [2.0001, 2.0001] },
      { code: 'A02', name: '국제교류센터(종점)', coord: [0.0001, 0.0001] }
    ] },
    r2: { stops: [
      { code: '서문', name: '서문', coord: [1.0001, 1.0001] },
      { code: 'F21', name: '제1과학관', coord: [3, 3] }
    ] }
  };
  const stations = buildTransferStations(routesMap);
  assert.deepEqual(stations.map(s => s.code).sort(), ['서문']);
  const seomun = stations.find(s => s.code === '서문');
  assert.equal(seomun.members.length, 2);
  assert.deepEqual(seomun.members.map(m => m.routeId).sort(), ['r1', 'r2']);
});

test('transferWalkSeconds is ~0 for colocated stops and grows with distance', () => {
  const same = transferWalkSeconds([35.8313, 128.7504], [35.83131, 128.75041]);
  const far = transferWalkSeconds([35.8339, 128.7577], [35.8329, 128.7571]);
  assert.ok(same < 5);
  assert.ok(far > same);
});
