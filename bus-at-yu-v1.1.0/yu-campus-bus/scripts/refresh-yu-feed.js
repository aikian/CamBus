#!/usr/bin/env node
/**
 * CamBus Picks public-source refresher.
 * No external npm packages are required (Node 18+ fetch).
 *
 * 영남대 게시판(영대소식 등) 목록에서 1~N 페이지를 읽어 각 글의 조회수를 뽑고,
 * 조회수 상위 항목만 data/portal-auto.json 에 씁니다.
 * data/portal-feed.json(수동 지정 항목)은 건드리지 않고, Picks에서 수동 항목이 먼저 옵니다.
 * 사이트 마크업은 바뀔 수 있으므로, 한 건도 못 모으면 기존 auto 파일을 그대로 둡니다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
// 서버와 같은 데이터 디렉터리를 봐야 배포 환경(마운트한 볼륨)에서도 결과가 반영된다.
const DATA_DIR = process.env.CAMBUS_DATA_DIR ? path.resolve(process.env.CAMBUS_DATA_DIR) : path.join(ROOT, 'data');
const SOURCES = path.join(DATA_DIR, 'feed-sources.json');
const OUTPUT = path.join(DATA_DIR, 'portal-auto.json');
const UA = 'CamBus/1.1 feed refresher (+https://bus.yu.local)';

function stripHtml(s = '') {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDate(raw = '') {
  const m = raw.match(/(20\d{2})[.\/-](\d{1,2})[.\/-](\d{1,2})/);
  if (!m) return '';
  return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
}

/** 목록 페이지 URL. 영남대 게시판은 article.offset 으로 페이지를 넘긴다. */
function listPageUrl(source, pageIndex) {
  const pageSize = Math.max(1, Number(source.pageSize) || 10);
  const url = new URL(source.url);
  if (pageIndex > 0 || !url.search) {
    url.searchParams.set('mode', 'list');
    url.searchParams.set('articleLimit', String(pageSize));
    url.searchParams.set('article.offset', String(pageIndex * pageSize));
  }
  return url.href;
}

/** 글 URL은 목록 페이지 기준으로 풀고, 페이징 파라미터는 버려 페이지 간 중복을 없앤다. */
function articleUrl(href, pageUrl) {
  try {
    const url = new URL(href.replaceAll('&amp;', '&'), pageUrl);
    url.searchParams.delete('article.offset');
    url.searchParams.delete('articleLimit');
    return url.href;
  } catch { return null; }
}

function articleId(url) {
  try {
    const u = new URL(url);
    return u.searchParams.get('articleNo') || Buffer.from(url).toString('base64url').slice(0, 22);
  } catch { return Buffer.from(url).toString('base64url').slice(0, 22); }
}

/**
 * 목록 <tbody>의 각 <tr>에서 제목/링크/작성일/조회수를 뽑는다.
 * 조회수는 행마다 <span class="hit">조회수 267</span> 로 들어 있고,
 * 없으면 조회 <td>의 숫자를 쓴다.
 */
function extractRows(html, pageUrl, source) {
  const start = html.indexOf('<tbody>');
  const end = html.indexOf('</tbody>', start + 1);
  if (start < 0 || end < 0) return [];
  const rows = html.slice(start + 7, end).split(/<tr[\s>]/i).slice(1);
  const out = [];

  for (const row of rows) {
    const link = row.match(/<a\b[^>]*href=["']([^"']*mode=view[^"']*articleNo=\d+[^"']*)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const url = articleUrl(link[1], pageUrl);
    const title = stripHtml(link[2]) || stripHtml((row.match(/title=["']([^"']+?)\s*자세히 보기["']/i) || [])[1] || '');
    if (!url || title.length < 5) continue;

    const hitSpan = row.match(/class=["']hit["'][^>]*>\s*(?:조회수)?\s*([\d,]+)/i);
    const hitCell = row.match(/<td[^>]*>\s*([\d,]{1,12})\s*<\/td>\s*<td[^>]*class=["']b-no-right/i);
    const hits = Number(String((hitSpan || hitCell || [])[1] || '0').replace(/,/g, '')) || 0;

    const dateText = (row.match(/class=["']b-date["'][^>]*>([\s\S]*?)<\/span>/i) || [])[1] || row;
    out.push({
      id: `auto-${source.id}-${articleId(url)}`,
      type: source.type || 'news',
      badge: source.badge || '영대소식',
      icon: source.icon || '📢',
      title: title.slice(0, 90),
      summary: '',
      url,
      source: source.source || '영남대학교',
      publishedAt: normalizeDate(stripHtml(dateText)),
      hits,
      enabled: true,
      auto: true
    });
  }
  return out;
}

async function collectSource(source) {
  const pages = Math.max(1, Number(source.pages) || 2);
  const items = [];
  for (let page = 0; page < pages; page += 1) {
    const pageUrl = listPageUrl(source, page);
    const res = await fetch(pageUrl, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status} (page ${page + 1})`);
    const rows = extractRows(await res.text(), pageUrl, source);
    console.log(`  ${source.id} page ${page + 1}: ${rows.length} rows`);
    items.push(...rows);
  }
  return items;
}

async function main() {
  const sources = JSON.parse(fs.readFileSync(SOURCES, 'utf8')).filter(x => x && x.enabled !== false && x.url);
  const all = [];
  for (const source of sources) {
    try {
      all.push(...await collectSource(source));
    } catch (err) {
      console.warn(`${source.id}: ${err.message}`);
    }
  }

  // 조회수 내림차순 → 같으면 최신순. order 는 그 순위를 그대로 담아
  // server.js 의 loadPortalFeed 가 수동 항목 뒤에 인기순으로 붙이도록 한다.
  const ranked = [...new Map(all.map(x => [x.url, x])).values()]
    .sort((a, b) => b.hits - a.hits
      || String(b.publishedAt).localeCompare(String(a.publishedAt))
      || a.title.localeCompare(b.title, 'ko'));

  // 영대소식 1~2페이지에서 조회수 상위 limit(기본 12)개만 남긴다.
  const limit = Math.min(...sources.map(s => Number(s.limit) || 12));
  const top = ranked.slice(0, limit).map((item, index) => ({
    ...item,
    summary: item.hits ? `조회수 ${item.hits.toLocaleString('ko-KR')}회` : '',
    order: 5000 + index
  }));

  if (!top.length) {
    console.error('No items collected; portal-auto.json left unchanged.');
    process.exitCode = 2;
    return;
  }
  fs.writeFileSync(OUTPUT + '.tmp', JSON.stringify(top, null, 2) + '\n');
  fs.renameSync(OUTPUT + '.tmp', OUTPUT);
  console.log(`Wrote ${top.length} items (top of ${ranked.length} by hits) -> ${OUTPUT}`);
  console.log(top.slice(0, 5).map((x, i) => `  #${i + 1} ${x.hits}회 · ${x.title}`).join('\n'));
}

main().catch(err => { console.error(err); process.exit(1); });
