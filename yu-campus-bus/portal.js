/**
 * BUS@YU two-page shell
 * - Page 0: bus map
 * - Page 1: useful-site icon grid + visitor counts + separate ad slot
 * Useful-site data is read from /api/useful-sites (server JSON file) with a static JSON fallback.
 */
(function () {
  const viewport = document.getElementById('pageViewport');
  const track = document.getElementById('pageTrack');
  const buttons = [...document.querySelectorAll('.page-switch-btn')];
  const edge = document.getElementById('mainPageEdge');
  const siteGrid = document.getElementById('siteGrid');
  const empty = document.getElementById('linksEmpty');
  const refresh = document.getElementById('refreshLinksBtn');
  const todayUsers = document.getElementById('todayUsers');
  const monthUsers = document.getElementById('monthUsers');
  const visitorNote = document.getElementById('visitorNote');

  let currentPage = 0;
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
    try { history.replaceState(null, '', currentPage === 1 ? '#links' : '#bus'); } catch {}
    if (currentPage === 0 && window.map?.invalidateSize) setTimeout(() => window.map.invalidateSize(), 260);
    if (focus) buttons[currentPage]?.focus({ preventScroll: true });
  }

  function pageFromHash() {
    return location.hash === '#links' ? 1 : 0;
  }

  buttons.forEach(btn => btn.addEventListener('click', () => setPage(Number(btn.dataset.pageIndex))));
  edge?.addEventListener('click', () => setPage(1));
  window.addEventListener('hashchange', () => setPage(pageFromHash()));

  function swipeBlocked(target) {
    if (!(target instanceof Element)) return false;
    // Keep Leaflet panning and form controls untouched. Main page still has the edge handle and top tab.
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

  function safeIconUrl(value) {
    const raw = String(value || '').trim();
    if (!/^(https?:\/\/|\/|\.\.?\/)/i.test(raw)) return null;
    try {
      const u = new URL(raw, location.href);
      return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : null;
    } catch { return null; }
  }

  function iconNode(site) {
    const wrap = document.createElement('span');
    wrap.className = 'site-icon';
    const icon = String(site.icon || '').trim();
    const iconUrl = safeIconUrl(icon);
    if (iconUrl) {
      const img = document.createElement('img');
      img.src = iconUrl;
      img.alt = '';
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      img.addEventListener('error', () => {
        img.remove();
        wrap.textContent = String(site.title || '?').trim().slice(0, 1).toUpperCase() || '?';
      }, { once: true });
      wrap.appendChild(img);
    } else if (icon) {
      wrap.textContent = icon.slice(0, 6);
    } else {
      wrap.textContent = String(site.title || '?').trim().slice(0, 1).toUpperCase() || '?';
    }
    return wrap;
  }

  function renderSites(sites) {
    if (!siteGrid || !empty) return;
    siteGrid.replaceChildren();
    const valid = Array.isArray(sites) ? sites.filter(site => site && safeExternalUrl(site.url) && site.title) : [];
    empty.hidden = valid.length > 0;
    valid.forEach(site => {
      const a = document.createElement('a');
      a.className = 'site-card';
      a.href = safeExternalUrl(site.url);
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.title = site.description ? `${site.title} · ${site.description}` : site.title;
      a.appendChild(iconNode(site));

      const name = document.createElement('span');
      name.className = 'site-name';
      name.textContent = site.title;
      a.appendChild(name);

      if (site.description) {
        const desc = document.createElement('small');
        desc.className = 'site-description';
        desc.textContent = site.description;
        a.appendChild(desc);
      }
      siteGrid.appendChild(a);
    });
  }

  async function loadSites() {
    if (refresh) refresh.disabled = true;
    try {
      let response = await fetch('/api/useful-sites', { cache: 'no-store' });
      let data;
      if (response.ok) {
        data = await response.json();
        renderSites(data.sites || []);
      } else {
        response = await fetch('./data/useful-sites.json', { cache: 'no-store' });
        if (!response.ok) throw new Error(`sites ${response.status}`);
        data = await response.json();
        const list = Array.isArray(data) ? data : (data.sites || []);
        const sorted = list
          .filter(x => x && x.enabled !== false)
          .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
        renderSites(sorted);
      }
    } catch (err) {
      console.warn('Useful sites load failed', err);
      renderSites([]);
      if (empty) {
        empty.hidden = false;
        empty.querySelector('strong').textContent = '사이트 목록을 불러오지 못했습니다.';
        empty.querySelector('span').textContent = '네트워크 또는 data/useful-sites.json을 확인하세요.';
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
        token = (window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`);
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

  refresh?.addEventListener('click', () => Promise.all([loadSites(), refreshStats()]));

  setPage(pageFromHash());
  loadSites();
  registerVisit();

  window.BUSYUPortal = { setPage, loadSites, refreshStats };
})();
