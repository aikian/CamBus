/**
 * CamBus two-page shell
 * - Page 0: CamBus map / routing
 * - Page 1: Picks vertical banner feed
 * - Picks 피드는 배너 20개(콘텐츠 16 + 광고 4)를 띄운다. 콘텐츠 4개마다 광고 1개.
 * - 콘텐츠 16칸 = 기획 배너(portal-feed.json 의 pinned) + 영대소식 조회수 상위 최대 12개.
 * - 기획 배너가 5개 이상이면 그만큼 영대소식이 조회수 낮은 쪽부터 밀려난다.
 * - Feed data: /api/portal-feed with ./data/portal-feed.json fallback.
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

  // 콘텐츠 4개마다 광고 슬롯 1개.
  // 슬롯은 ads.js가 Ezoic placement로 채우고, placement가 없으면 하우스 광고로 남는다.
  const CONTENTS_PER_AD = 4;
  // 광고를 포함한 피드 배너 총 개수. 20개면 콘텐츠 16 + 광고 4가 된다.
  const FEED_BANNER_LIMIT = 20;
  let currentPage = 0;
  let localAds = [];
  let touchStart = null;
  let swipeConsumed = false;

  function setPage(index, { focus = false } = {}) {
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
  edge?.addEventListener('click', () => setPage(1));
  window.addEventListener('hashchange', () => setPage(pageFromHash()));

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
    source.textContent = item.source ? `${item.source} · 눌러서 보기` : '눌러서 보기';

    body.append(meta, title, summary, source);

    const arrow = document.createElement('span');
    arrow.className = 'feed-card-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '›';

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
    return section;
  }


  function renderFeed(items) {
    if (!feedList || !empty) return;
    feedList.replaceChildren();
    const list = validItems(items);
    empty.hidden = list.length > 0;

    let adIndex = 0;
    let contentCount = 0;
    let banners = 0;
    for (const item of list) {
      if (banners >= FEED_BANNER_LIMIT) break;
      feedList.appendChild(makeFeedCard(item));
      contentCount += 1;
      banners += 1;
      if (banners >= FEED_BANNER_LIMIT) break;
      if (contentCount % CONTENTS_PER_AD === 0) {
        adIndex += 1;
        feedList.appendChild(makeInlineAd(adIndex));
        banners += 1;
      }
    }

    window.dispatchEvent(new CustomEvent('busyu:feed-rendered', {
      detail: { contentCount, adCount: adIndex, bannerCount: banners, available: list.length }
    }));
  }

  async function loadFeed() {
    if (refresh) refresh.disabled = true;
    try {
      await loadLocalAds();
      let response = await fetch('/api/portal-feed', { cache: 'no-store' });
      let data;
      if (response.ok) {
        data = await response.json();
        renderFeed(data.items || []);
      } else {
        response = await fetch('./data/portal-feed.json', { cache: 'no-store' });
        if (!response.ok) throw new Error(`feed ${response.status}`);
        data = await response.json();
        renderFeed(Array.isArray(data) ? data : (data.items || []));
      }
    } catch (err) {
      console.warn('Portal feed load failed', err);
      renderFeed([]);
      if (empty) {
        empty.hidden = false;
        empty.querySelector('strong').textContent = '생활 피드를 불러오지 못했습니다.';
        empty.querySelector('span').textContent = '네트워크 또는 data/portal-feed.json을 확인하세요.';
      }
    } finally {
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
    if (visitorNote) visitorNote.textContent = '익명 브라우저 기준 고유 사용자 수 · 기기/브라우저 변경 시 별도 집계';
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
      renderStats(await response.json());
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

  setPage(pageFromHash());
  setUpContactCopy();
  loadFeed();
  registerVisit();

  window.BUSYUPortal = { setPage, loadFeed, refreshStats };
})();
