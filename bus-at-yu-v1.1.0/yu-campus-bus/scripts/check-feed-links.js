#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function readList(file) {
  const parsed = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  return Array.isArray(parsed) ? parsed : (Array.isArray(parsed.items) ? parsed.items : []);
}

async function request(url, method) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    return await fetch(url, {
      method,
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'CamBus-Link-Checker/1.2 (+operator quality check)' }
    });
  } finally {
    clearTimeout(timer);
  }
}

async function check(item) {
  let url;
  try { url = new URL(item.url); } catch { return { item, state: 'broken', detail: 'invalid URL' }; }
  if (!['http:', 'https:'].includes(url.protocol)) return { item, state: 'broken', detail: `unsupported ${url.protocol}` };
  try {
    let response = await request(url.href, 'HEAD');
    if ([403, 405, 429].includes(response.status)) response = await request(url.href, 'GET');
    if (response.status === 404 || response.status === 410) return { item, state: 'broken', detail: `HTTP ${response.status}` };
    if (response.ok) return { item, state: 'ok', detail: `HTTP ${response.status}` };
    return { item, state: 'review', detail: `HTTP ${response.status}` };
  } catch (error) {
    return { item, state: 'review', detail: error.name === 'AbortError' ? 'timeout' : error.message };
  }
}

async function main() {
  const items = [...readList('data/portal-feed.json'), ...readList('data/portal-auto.json')]
    .filter(item => item && item.enabled !== false && item.url);
  const unique = [...new Map(items.map(item => [item.url, item])).values()];
  const results = [];
  for (let i = 0; i < unique.length; i += 5) {
    results.push(...await Promise.all(unique.slice(i, i + 5).map(check)));
  }
  for (const result of results) {
    const mark = result.state === 'ok' ? 'OK' : result.state === 'broken' ? 'BROKEN' : 'REVIEW';
    console.log(`[${mark}] ${result.item.title} — ${result.detail} — ${result.item.url}`);
  }
  const broken = results.filter(result => result.state === 'broken').length;
  const review = results.filter(result => result.state === 'review').length;
  console.log(`Checked ${results.length}: broken ${broken}, review ${review}.`);
  if (broken) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
