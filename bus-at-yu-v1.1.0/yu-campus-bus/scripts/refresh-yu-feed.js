#!/usr/bin/env node
/**
 * CamBus Picks public-source refresher.
 * No external npm packages are required (Node 18+ fetch).
 *
 * 영남대 게시판(영대소식 등) 목록에서 1~N 페이지를 읽어 각 글의 조회수를 뽑고,
 * 최신 항목을 data/portal-auto.json 에 씁니다.
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
    url.searchParams.delete('srSearchKey');
    url.searchParams.delete('srSearchVal');
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
    const serviceNotice = source.id === 'yu-news' &&
      /(접속|로그인|서비스|개인정보|해킹|강의포털)/.test(title) &&
      /(제한|중단|정상화|복구|재개|유출|차단|인증)/.test(title);
    out.push({
      id: `auto-${source.id}-${articleId(url)}`,
      type: serviceNotice ? 'notice' : (source.type || 'news'),
      badge: serviceNotice ? '서비스 공지' : (source.badge || '영대소식'),
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

async function readPublicPage(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(8500), headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function programRows(html, source) {
  const items = [];
  for (const match of html.matchAll(/<a\s+href="(\/ko\/program\/all\/view\/(\d+))"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const body = match[3];
    const title = stripHtml(body.match(/<b class="title">([\s\S]*?)<\/b>/i)?.[1]);
    const application = body.match(/신청:\s*<\/span>([\s\S]*?)<\/small>/)?.[1] || '';
    const dates = [...application.matchAll(/datetime="([^"]+)"/g)].map(m => m[1]);
    if (!title || dates.length < 2 || !Number.isFinite(Date.parse(dates[1]))) continue;
    items.push({ id: `auto-${source.id}-${match[2]}`, type: source.type, badge: source.badge,
      title, url: new URL(match[1], source.url).href, source: source.source, publishedAt: '',
      summary: '신청 마감 ' + dates[1].slice(0, 16).replace('T', ' '), endsAt: dates[1] });
  }
  if (!items.length) throw new Error('유토피아 프로그램 목록 확인 지연');
  return items.filter(item => Date.parse(item.endsAt) > Date.now());
}

function careerRows(html, source) {
  const items = [];
  for (const [row] of html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)) {
    for (const link of row.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const title = stripHtml(link[2]);
      const url = new URL(link[1].replaceAll('&amp;', '&'), source.url);
      if (url.origin !== new URL(source.url).origin || title.length < 4 ||
          !/[?&](?:idx|no|num|seq|bno|wr_id|uid|act_no)=\d+/i.test(url.search)) continue;
      items.push({ id: 'auto-' + source.id + '-' + require('node:crypto').createHash('sha256').update(url.href).digest('hex').slice(0,16),
        type: source.type, badge: source.badge, source: source.source, url: url.href, title,
        publishedAt: normalizeDate(stripHtml(row)) });
    }
  }
  if (!items.length) throw new Error('어울림 공개 목록 확인 지연');
  return items;
}

async function collectBoard(source) {
  const pages = Math.max(1, Number(source.pages) || 2);
  const items = [];
  for (let page = 0; page < pages; page += 1) {
    const pageUrl = listPageUrl(source, page);
    const rows = extractRows(await readPublicPage(pageUrl), pageUrl, source);
    console.log(`  ${source.id} page ${page + 1}: ${rows.length} rows`);
    if (!rows.length && page === 0) throw new Error('게시판 목록을 읽지 못했습니다.');
    items.push(...rows);
  }
  return items;
}

async function main() {
  const sources = JSON.parse(fs.readFileSync(SOURCES, 'utf8')).filter(x => x && x.enabled !== false && x.url);
  const previous = fs.existsSync(OUTPUT) ? JSON.parse(fs.readFileSync(OUTPUT, 'utf8')) : {};
  const previousItems = Array.isArray(previous) ? previous : previous.items || [];
  const checkedAt = new Date().toISOString();
  const results = await Promise.all(sources.map(async source => {
    const status = { id: source.id, label: source.badge, checkedAt, collectedAt: checkedAt, state: 'ok' };
    try {
      let rows;
      if (source.type === 'program') {
        rows = programRows(await readPublicPage(source.url), source);
      } else if (source.type === 'career') {
        try {
          rows = careerRows(await readPublicPage(source.url), source);
        } catch {
          status.state = 'alternative';
          const fallback = new URL('https://www.yu.ac.kr/main/intro/yu-news.do');
          fallback.search = new URLSearchParams({ srSearchKey: 'writer_nm', srSearchVal: '진로취업지원팀' });
          rows = await collectBoard({ ...source, url: fallback.href, source: '영남대학교 진로취업지원팀 · 영대소식' });
        }
      } else {
        rows = await collectBoard(source);
      }
      const unique = [...new Map(rows.map(item => [item.url, item])).values()];
      unique.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
      return { status, items: unique.slice(0, Number(source.limit) || 12).map(item => ({ ...item, sourceId: source.id })) };
    } catch (error) {
      console.warn(`${source.id}: ${error.message}`);
      status.state = 'stale';
      status.collectedAt = previous.sources?.find(s => s.id === source.id)?.collectedAt || null;
      return { status, items: previousItems.filter(item => item.sourceId === source.id || item.id.startsWith(`auto-${source.id}-`)) };
    }
  }));
  const items = results.flatMap(r => r.items).sort((a,b) => b.publishedAt.localeCompare(a.publishedAt))
    .map((item, index) => ({ ...item, order: 5000 + index }));
  const snapshot = { collectedAt: results.some(r => r.status.state !== 'stale') ? checkedAt : previous.collectedAt || null,
    sources: results.map(r => r.status), items };
  fs.writeFileSync(OUTPUT + '.tmp', JSON.stringify(snapshot, null, 2) + '\n');
  fs.renameSync(OUTPUT + '.tmp', OUTPUT);
  console.log(results.map(r => `${r.status.label}: ${r.status.state} (${r.items.length})`).join('\n'));
  if (sources.length && results.every(r => r.status.state === 'stale')) process.exitCode = 2;
}

main().catch(err => { console.error(err); process.exit(1); });
