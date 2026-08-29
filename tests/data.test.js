const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));

test('saved route paths match stop order and contain every leg', () => {
  const stops = read('data/route-stops.json');
  const paths = read('data/route-paths.json');
  for (const routeId of ['r1', 'r2']) {
    const routeStops = stops.routes[routeId].stops;
    const routePath = paths.routes[routeId];
    assert.deepEqual(routePath.stopIds, routeStops.map(stop => stop.id));
    assert.equal(routePath.legs.length, routeStops.length - 1);
    assert.ok(routePath.geometry.length > routeStops.length);
    routePath.legs.forEach((leg, index) => {
      assert.equal(leg.fromId, routeStops[index].id);
      assert.equal(leg.toId, routeStops[index + 1].id);
      assert.ok(leg.geometry.length >= 2);
      assert.ok(leg.duration > 0);
      assert.ok(leg.distance >= 0);
    });
  }
});

test('timing overrides have one value per saved route leg', () => {
  const stops = read('data/route-stops.json');
  const timings = read('data/route-timings.json');
  for (const routeId of ['r1', 'r2']) {
    const expected = stops.routes[routeId].stops.length - 1;
    assert.equal(timings.routes[routeId].legs.length, expected);
    timings.routes[routeId].legs.forEach(value => assert.ok(value == null || (Number.isFinite(value) && value >= 10 && value <= 1800)));
  }
});

test('Picks feed URLs and optional scheduling dates are valid', () => {
  for (const file of ['data/portal-feed.json', 'data/portal-auto.json']) {
    const parsed = read(file);
    const items = Array.isArray(parsed) ? parsed : parsed.items;
    for (const item of items) {
      if (item.enabled === false) continue;
      assert.ok(item.title);
      const url = new URL(item.url);
      assert.ok(['http:', 'https:'].includes(url.protocol));
      for (const field of ['publishedAt', 'startsAt', 'endsAt', 'lastVerifiedAt']) {
        if (item[field]) assert.ok(!Number.isNaN(new Date(item[field]).valueOf()), `${file} ${item.id} ${field}`);
      }
    }
  }
});
