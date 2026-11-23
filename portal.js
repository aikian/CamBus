/**
 * CamBus two-page shell
 * - Page 0: CamBus map / routing
 * - Page 1: Picks vertical banner feed
 * - Picks 피드는 배너 20개(콘텐츠 16 + 광고 4)를 띄운다. 콘텐츠 4개마다 광고 1개.
 * - 공개 학교 공지, 운영자가 고정한 카드, 최신 영대소식 순서로 보여준다.
 */
(function () {
  const viewport = document.getElementById('pageViewport');
  const track = document.getElementById('pageTrack');
  const buttons = [...document.querySelectorAll('.page-switch-btn')];
  const edge = document.getElementById('mainPageEdge');
  const feedList = document.getElementById('feedList');
  const empty = document.getElementById('linksEmpty');
  const refresh = document.getElementById('refreshLinksBtn');
  const todayUsers = document.getElementById('todayUsers');
  const monthUsers = document.getElementById('monthUsers');
  const visitorNote = document.getElementById('visitorNote');

  // 배치는 관리자 화면에서 정한다(/api/ad-config 의 layout). 아래는 설정을 못 읽었을 때의 기본값.
  const DEFAULT_CONTENTS_PER_AD = 4;
  const DEFAULT_FEED_BANNER_LIMIT = 20;
  function adLayout() {
    const layout = window.YUAds?.config?.layout || {};
    return {
      contentsPerAd: Math.max(1, Number(layout.contentsPerAd) || DEFAULT_CONTENTS_PER_AD),
      bannerLimit: Math.max(1, Number(layout.feedBannerLimit) || DEFAULT_FEED_BANNER_LIMIT),
      feedEnabled: window.YUAds?.config?.audienceReached === true && window.YUAds.config.provider !== 'none' && layout.slots?.picksFeed?.enabled !== false
    };
  }
  const status = document.getElementById('feedStatus');
  let loading = false;
  let lastRender = '';
  let selected = 'all';
  let currentItems = [];
  let sources = [];
  const filterButtons = [...document.querySelectorAll('[data-source]')];
  function selectSource(value) {
    selected = value;
    filterButtons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.source === value)));
    renderFeed(currentItems);
    renderSourceNote();
  }
  filterButtons.forEach(b => b.addEventListener('click', () => selectSource(b.dataset.source)));
  let currentPage = 0;
  let localAds = [];
  let touchStart = null;
  let swipeConsumed = false;

  function setPage(index, { focus = false } = {}) {
    const previousPage = currentPage;
    currentPage = Math.max(0, Math.min(1, Number(index) || 0));
    if (track) track.style.transform = `translate3d(-${currentPage * 50}%,0,0)`;
    buttons.forEach((btn, i) => {
      const active = i === currentPage;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
      btn.tabIndex = active ? 0 : -1;
    });
    document.body.dataset.page = String(currentPage);
    window.dispatchEvent(new CustomEvent('busyu:page-change', { detail: { index: currentPage } }));
    try { history.replaceState(null, '', currentPage === 1 ? '#pick' : '#bus'); } catch {}
    if (currentPage === 0 && window.map?.invalidateSize) setTimeout(() => window.map.invalidateSize(), 260);
    document.getElementById('mainPage').inert = currentPage !== 0;
    document.getElementById('linksPage').inert = currentPage !== 1;
    if (currentPage === 1 && previousPage !== 1) trackPortalEvent('news_open');
    if (currentPage === 1) loadFeed();
    if (focus) buttons[currentPage]?.focus({ preventScroll: true });
  }

  function pageFromHash() {
    return (location.hash === '#pick' || location.hash === '#links') ? 1 : 0;
  }

  buttons.forEach(btn => btn.addEventListener('click', () => setPage(Number(btn.dataset.pageIndex))));
  document.querySelector('.page-switch')?.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home') return setPage(0, { focus: true });
    if (event.key === 'End') return setPage(1, { focus: true });
    setPage(event.key === 'ArrowLeft' ? currentPage - 1 : currentPage + 1, { focus: true });
  });
  edge?.addEventListener('click', () => {
    setPage(1, { focus: true });
    selectSource('news');
    document.getElementById('linksScroll').scrollTop = 0;
  });
  window.addEventListener('hashchange', () => setPage(pageFromHash()));
  // 광고 배치 설정은 비동기로 온다. 먼저 그려졌다면 설정 도착 후 한 번 다시 그린다.
  window.addEventListener('cambus:ad-config-ready', () => { if (feedList?.children.length) loadFeed(); }, { once: true });

  function swipeBlocked(target) {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest('#map, .side-panel, button, input, select, textarea, a, dialog, .guidance-bar'));
  }

  viewport?.addEventListener('touchstart', event => {
    if (event.touches.length !== 1) { touchStart = null; return; }
    const t = event.touches[0];
    const target = event.target instanceof Element ? event.target : null;
    const edgeSwipeOnMap = currentPage === 0 && Boolean(target?.closest('#map')) && t.clientX >= window.innerWidth - 42;
    if (swipeBlocked(event.target) && !edgeSwipeOnMap) {
      touchStart = null;
      return;
    }
    touchStart = { x: t.clientX, y: t.clientY, time: Date.now() };
    swipeConsumed = false;
  }, { passive: true });

  viewport?.addEventListener('touchend', event => {
    if (!touchStart || !event.changedTouches.length) return;
    const t = event.changedTouches[0];
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    const dt = Date.now() - touchStart.time;
    touchStart = null;
    if (dt > 900 || Math.abs(dx) < 54 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
    swipeConsumed = true;
    if (dx < 0 && currentPage === 0) setPage(1);
    else if (dx > 0 && currentPage === 1) setPage(0);
  }, { passive: true });

  viewport?.addEventListener('click', event => {
    if (!swipeConsumed) return;
    event.preventDefault();
    event.stopPropagation();
    swipeConsumed = false;
  }, true);

  function safeExternalUrl(value) {
    const raw = String(value || '').trim();
    if (!/^https?:\/\//i.test(raw)) return null;
    try {
      const u = new URL(raw);
      return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : null;
    } catch { return null; }
  }

  function trackPortalEvent(type, payload = {}) {
    fetch('/api/event', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, payload }), keepalive: true
    }).catch(() => {});
  }

  async function loadLocalAds() {
    try {
      let response = await fetch('/api/local-ads', { cache: 'no-store' });
      if (!response.ok) response = await fetch('./data/local-ads.json', { cache: 'no-store' });
      if (!response.ok) throw new Error(`ads ${response.status}`);
      const data = await response.json();
      localAds = Array.isArray(data) ? data : (data.ads || []);
    } catch (err) {
      console.warn('Local ads unavailable', err);
      localAds = [];
    }
  }

  function validItems(items) {
    const now = new Date();
    return (Array.isArray(items) ? items : [])
      .filter(item => {
        if (!item || item.enabled === false || !item.title || !safeExternalUrl(item.url)) return false;
        const startsAt = item.startsAt ? new Date(item.startsAt) : null;
        const endsAt = item.endsAt ? new Date(item.endsAt) : null;
        if (startsAt && !Number.isNaN(startsAt.valueOf()) && now < startsAt) return false;
        if (endsAt && !Number.isNaN(endsAt.valueOf()) && now > endsAt) return false;
        return true;
      })
      // order 0 도 유효한 순위이므로 falsy 로 처리하지 않는다(서버가 0부터 순위를 매긴다).
      .sort((a, b) => feedOrder(a) - feedOrder(b));
  }

  function feedOrder(item) {
    const order = Number(item.order);
    return Number.isFinite(order) ? order : 9999;
  }

  function makeFeedCard(item) {
    const a = document.createElement('a');
    a.className = `feed-card feed-${String(item.type || 'utility').replace(/[^a-z0-9_-]/gi, '')}`;
    a.href = safeExternalUrl(item.url);
    if (item.type === 'notice') a.classList.add('school-notice');
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.addEventListener('click', () => trackPortalEvent('feed_click', { itemId: String(item.id || '').slice(0,80) }));

    const icon = document.createElement('div');
    icon.className = 'feed-card-icon';
    icon.textContent = String(item.icon || '↗').slice(0, 8);

    const body = document.createElement('div');
    body.className = 'feed-card-body';

    const meta = document.createElement('div');
    meta.className = 'feed-card-meta';
    const badge = document.createElement('span');
    badge.className = 'feed-badge';
    badge.textContent = String(item.badge || '정보').slice(0, 20);
    meta.appendChild(badge);
    if (item.publishedAt) {
      const date = document.createElement('time');
      date.dateTime = String(item.publishedAt);
      date.textContent = String(item.publishedAt).replaceAll('-', '.');
      meta.appendChild(date);
    }

    const title = document.createElement('strong');
    title.className = 'feed-card-title';
    title.textContent = item.title;

    const summary = document.createElement('p');
    summary.className = 'feed-card-summary';
    summary.textContent = String(item.summary || '');

    const source = document.createElement('span');
    source.className = 'feed-card-source';
    source.textContent = item.source || '원문 보기';

    body.append(meta, title, summary, source);

    const arrow = document.createElement('span');
    arrow.className = 'feed-card-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '↗';

    a.append(icon, body, arrow);
    return a;
  }

  function makeInlineAd(adIndex) {
    const section = document.createElement('section');
    section.className = 'feed-inline-ad';
    section.dataset.adIndex = String(adIndex);
    section.setAttribute('aria-label', '광고');

    const label = document.createElement('span');
    label.className = 'ad-label';
    label.textContent = '광고';

    const slot = document.createElement('div');
    slot.className = 'feed-inline-ad-slot';
    slot.id = `feedInlineAdSlot${adIndex}`;
    slot.dataset.adIndex = String(adIndex);

    const ad = localAds.length ? localAds[(adIndex - 1) % localAds.length] : null;
    if (ad) {
      const link = document.createElement('a');
      link.className = 'feed-house-ad';
      link.href = String(ad.url || 'mailto:ad@uxo.kr');
      if (/^https?:/i.test(link.href)) { link.target = '_blank'; link.rel = 'noopener noreferrer sponsored'; }
      const copy = document.createElement('span');
      const b = document.createElement('b'); b.textContent = String(ad.title || '지역 광고');
      const small = document.createElement('small'); small.textContent = String(ad.subtitle || 'CamBus 지역 광고');
      copy.append(b, small);
      const cta = document.createElement('strong'); cta.textContent = String(ad.cta || '자세히');
      link.append(copy, cta);
      slot.appendChild(link);
    } else {
      const link = document.createElement('a');
      link.className = 'feed-house-ad';
      link.href = 'mailto:ad@uxo.kr?subject=CamBus%20%EC%A7%80%EC%97%AD%20%EA%B4%91%EA%B3%A0%20%EB%AC%B8%EC%9D%98';
      const copy = document.createElement('span');
      copy.innerHTML = '<b>영남대 · 경산 지역 광고 모집중</b><small>맛집 · 카페 · 행사 · 동아리 · 지역 서비스</small>';
      const mail = document.createElement('strong'); mail.textContent = 'ad@uxo.kr';
      link.append(copy, mail); slot.appendChild(link);
    }

    section.append(label, slot);
    window.YUAds?.trackAd?.(section, ad ? `local:${ad.id || adIndex}` : 'house:recruit', 'picksFeed');
    return section;
  }


  function renderFeed(items) {
    if (!feedList || !empty) return;
    feedList.replaceChildren();
    const list = validItems(items).filter(item => selected === 'all' || item.type === selected ||
      (selected === 'news' && item.type === 'notice'));
    empty.hidden = list.length > 0;

    const { contentsPerAd, bannerLimit, feedEnabled } = adLayout();
    let adIndex = 0;
    let contentCount = 0;
    let banners = 0;
    for (const item of list) {
      if (banners >= bannerLimit) break;
      feedList.appendChild(makeFeedCard(item));
      contentCount += 1;
      banners += 1;
      if (banners >= bannerLimit) break;
      if (feedEnabled && contentCount % contentsPerAd === 0) {
        adIndex += 1;
        feedList.appendChild(makeInlineAd(adIndex));
        banners += 1;
      }
    }

    window.dispatchEvent(new CustomEvent('busyu:feed-rendered', {
      detail: { contentCount, adCount: adIndex, bannerCount: banners, available: list.length }
    }));
  }

  async function readFeedJson(url) {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`feed ${response.status}`);
    return response.json();
  }

  async function bundledFeed() {
    const [notices, manual, auto] = await Promise.all(
      ['campus-notices', 'portal-feed', 'portal-auto'].map(name => readFeedJson(`./data/${name}.json`))
    );
    const list = validItems(manual);
    const ordered = [...validItems(notices), ...list.filter(x => x.pinned),
      ...validItems(auto.items || auto), ...list.filter(x => !x.pinned)];
    const seen = new Set();
    const items = ordered.filter(item => {
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    }).map((item, order) => ({ ...item, order }));
    return { items, collectedAt: auto.collectedAt, sources: auto.sources || [] };
  }

  function formatKst(value) {
    if (!value || !Number.isFinite(Date.parse(value))) return '';
    return new Date(value).toLocaleString('ko-KR', {
      timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }

  function renderSourceNote() {
    const sourceId = { career: 'yu-career', program: 'yu-yutopia', news: 'yu-news' }[selected];
    const note = document.getElementById('sourceNote');
    const info = sources.find(s => s.id === sourceId);
    const lines = [];
    if (info?.state === 'alternative') lines.push('어울림 게시판 연결 지연 · 진로취업지원팀이 영대소식에 게시한 공지를 표시합니다.');
    if (info?.state === 'stale') lines.push('원본 게시판 갱신 지연');
    if (info && info.state !== 'ok' && info.collectedAt) lines.push(`마지막 수집 ${formatKst(info.collectedAt)}`);
    if (info?.state === 'stale' && info.checkedAt) lines.push(`확인 시도 ${formatKst(info.checkedAt)}`);
    note.textContent = lines.join(' · ');
    note.hidden = !lines.length;
  }

  let hasLiveFeed = false;
  async function loadFeed() {
    if (loading) return;
    loading = true;
    if (refresh) refresh.disabled = true;
    try {
      let data;
      let snapshot = false;
      try {
        data = await readFeedJson('/api/portal-feed');
        if (!Array.isArray(data.items)) throw new Error('invalid feed');
        hasLiveFeed = true;
      } catch (err) {
        if (hasLiveFeed) throw err;
        data = await bundledFeed();
        snapshot = true;
      }
      if (adLayout().feedEnabled) await loadLocalAds();
      const items = validItems(data.items);
      currentItems = items;
      sources = data.sources || [];
      renderSourceNote();
      const signature = JSON.stringify([items, localAds, adLayout()]);
      if (signature !== lastRender) {
        renderFeed(items);
        const lead = items.find(item => item.type === 'notice') || items.find(item => item.type === 'news' && !item.pinned);
        if (lead) {
          document.getElementById('mapHeadline').textContent = lead.title;
          edge.querySelector('.headline-label').textContent = lead.type === 'notice' ? '학교 공지' : '학교 소식';
        }
        edge.hidden = !lead;
        lastRender = signature;
      }
      const stamp = formatKst(data.collectedAt);
      const stale = !stamp || Date.now() - Date.parse(data.collectedAt) > 15 * 60000;
      status.textContent = [snapshot || stale ? '저장된 소식' : '5분마다 갱신', stamp].filter(Boolean).join(' · ');
    } catch {
      status.textContent = lastRender ? '연결 지연 · 이전에 불러온 소식을 표시합니다.' : '소식을 불러오지 못했습니다. 다시 시도해 주세요.';
    } finally {
      loading = false;
      if (refresh) refresh.disabled = false;
    }
  }

  function getVisitorToken() {
    const key = 'busyu.visitor.v1';
    try {
      let token = localStorage.getItem(key);
      if (!token) {
        token = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
        localStorage.setItem(key, token);
      }
      return token;
    } catch {
      return `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
  }

  function renderStats(data) {
    if (todayUsers) todayUsers.textContent = Number.isFinite(Number(data?.today)) ? Number(data.today).toLocaleString('ko-KR') : '—';
    if (monthUsers) monthUsers.textContent = Number.isFinite(Number(data?.month)) ? Number(data.month).toLocaleString('ko-KR') : '—';
    if (visitorNote) visitorNote.textContent = '방문 브라우저 수 · 기기나 브라우저를 바꾸면 따로 집계됩니다';
  }

  // 광고 문의 메일 주소 복사. navigator.clipboard는 HTTPS/localhost에서만 동작하므로,
  // 안 되는 환경에서는 주소 전체를 선택 상태로 만들어 사용자가 바로 복사할 수 있게 합니다.
  function setUpContactCopy() {
    const button = document.getElementById('copyContactEmail');
    const email = document.getElementById('contactEmail');
    if (!button || !email) return;
    button.addEventListener('click', async () => {
      const text = email.textContent.trim();
      let copied = false;
      try {
        await navigator.clipboard.writeText(text);
        copied = true;
      } catch {
        const range = document.createRange();
        range.selectNodeContents(email);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }
      button.textContent = copied ? '복사됨' : '선택됨';
      button.classList.toggle('copied', copied);
      clearTimeout(button.__resetTimer);
      button.__resetTimer = setTimeout(() => {
        button.textContent = '복사';
        button.classList.remove('copied');
      }, 1600);
    });
  }

  async function registerVisit() {
    try {
      const response = await fetch('/api/visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitorToken: getVisitorToken() })
      });
      if (!response.ok) throw new Error(`visit ${response.status}`);
      const stats = await response.json();
      renderStats(stats);
      if (stats.audienceAvailable) window.dispatchEvent(new Event('cambus:audience-ready'));
    } catch (err) {
      console.warn('Visitor stats unavailable', err);
      if (visitorNote) visitorNote.textContent = '사용자 집계 서버 미연결';
    }
  }

  async function refreshStats() {
    try {
      const response = await fetch('/api/visitors', { cache: 'no-store' });
      if (!response.ok) throw new Error(`visitors ${response.status}`);
      renderStats(await response.json());
    } catch {}
  }

  refresh?.addEventListener('click', () => Promise.all([loadFeed(), refreshStats()]));

  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadFeed(); });
  setInterval(() => { if (!document.hidden) loadFeed(); }, 60000);
  setPage(pageFromHash());
  setUpContactCopy();
  loadFeed();
  registerVisit();

  window.BUSYUPortal = { setPage, loadFeed, refreshStats };
})();
