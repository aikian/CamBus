#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const scripts = [
  'server.js', 'app.js', 'portal.js', 'ads.js', 'route-utils.js',
  'stop-editor.js', 'path-editor.js', 'sw.js',
  'scripts/refresh-route-paths.js', 'scripts/refresh-yu-feed.js', 'scripts/check-feed-links.js'
];
const jsonFiles = [
  'package.json', 'manifest.webmanifest', 'data/route-stops.json', 'data/route-paths.json',
  'data/route-timings.json', 'data/portal-feed.json', 'data/portal-auto.json',
  'data/local-ads.json', 'data/pm-zones.json', 'data/feed-sources.json'
];

let failed = false;
for (const file of scripts) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  if (result.status !== 0) {
    failed = true;
    process.stderr.write(`[syntax] ${file}\n${result.stderr || result.stdout}`);
  } else {
    console.log(`[syntax] ${file} OK`);
  }
}

for (const file of jsonFiles) {
  try {
    JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
    console.log(`[json] ${file} OK`);
  } catch (error) {
    failed = true;
    console.error(`[json] ${file}: ${error.message}`);
  }
}

if (failed) process.exitCode = 1;
else console.log('CamBus project checks passed.');
