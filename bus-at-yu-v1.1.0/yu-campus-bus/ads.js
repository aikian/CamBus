/**
 * CamBus ad adapter.
 * Default = demo/house-ad placeholders only.
 * No network request is made until provider is changed to "ezoic" and publisher scripts/placement IDs are configured.
 */
(function () {
  const DEFAULTS = {
    provider: 'demo', // demo | ezoic | none
    launchPlacementId: null,
    linksPlacementId: null,
    feedPlacementIds: [],
    launchSessionKey: 'busyu-launch-ad-v1',
    showLaunchOncePerSession: true,
    useEzoicAnchor: true,
    bannerHeight: 58,
    networkScriptsReady: false
  };
  const cfg = Object.assign({}, DEFAULTS, window.YU_ADS_CONFIG || {});
  let ezoicBaseInitialized = false;

  async function loadRemoteConfig() {
    try {
      const response = await fetch('/api/ad-config', { cache: 'no-store' });
      if (!response.ok) throw new Error(`ad config ${response.status}`);
      const remote = await response.json();
      if (remote && typeof remote === 'object') Object.assign(cfg, remote);
    } catch (error) {
      console.info('CamBus ad config API unavailable; using bundled demo settings.', error);
    }
    window.dispatchEvent(new CustomEvent('cambus:ad-config-ready', { detail: { ...cfg } }));
    return cfg;
  }

  function validPlacement(value) {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
  }

  function setBannerHeight(px) {
    document.documentElement.style.setProperty('--ad-banner-height', `${Math.max(0, Number(px) || 0)}px`);
  }

  function launchSeen() {
    if (!cfg.showLaunchOncePerSession) return false;
    try { return sessionStorage.getItem(cfg.launchSessionKey) === '1'; } catch { return false; }
  }
  function markLaunchSeen() {
    if (!cfg.showLaunchOncePerSession) return;
    try { sessionStorage.setItem(cfg.launchSessionKey, '1'); } catch {}
  }

  function dismissLaunchAd() {
    const el = document.getElementById('launchAd');
    if (!el || el.hidden) return;
    el.hidden = true;
    markLaunchSeen();
    window.dispatchEvent(new CustomEvent('yu:launch-ad-closed'));
  }

  function showDemoSlots() {
    document.getElementById('bottomAd')?.classList.add('ad-demo');
    document.getElementById('launchAd')?.classList.add('ad-demo');
    document.getElementById('linksAd')?.classList.add('ad-demo');
  }

  function ezoicCommand(fn) {
    window.ezstandalone = window.ezstandalone || {};
    window.ezstandalone.cmd = window.ezstandalone.cmd || [];
    window.ezstandalone.cmd.push(fn);
  }

  function initEzoicBase() {
    if (ezoicBaseInitialized) return;
    ezoicBaseInitialized = true;

    document.getElementById('bottomAd')?.classList.add('ad-network');
    document.getElementById('launchAd')?.classList.add('ad-network');
    document.getElementById('linksAd')?.classList.add('ad-network');

    ezoicCommand(function () {
      try {
        if (typeof window.ezstandalone.config === 'function') {
          window.ezstandalone.config({
            anchorAdPosition: 'bottom',
            anchorAdExpansion: false,
            disableInterstitial: true
          });
        }
        if (cfg.useEzoicAnchor && typeof window.ezstandalone.setEzoicAnchorAd === 'function') {
          window.ezstandalone.setEzoicAnchorAd(true);
        }

        const ids = [];
        const launchId = validPlacement(cfg.launchPlacementId);
        const linksId = validPlacement(cfg.linksPlacementId);
        const launchSlot = document.getElementById('launchAdSlot');
        const linksSlot = document.getElementById('linksAdSlot');

        if (launchId && launchSlot) {
          launchSlot.innerHTML = `<div id="ezoic-pub-ad-placeholder-${launchId}"></div>`;
          ids.push(launchId);
        }
        if (linksId && linksSlot) {
          linksSlot.innerHTML = `<div id="ezoic-pub-ad-placeholder-${linksId}"></div>`;
          ids.push(linksId);
        }

        if (typeof window.ezstandalone.showAds === 'function') {
          if (ids.length) window.ezstandalone.showAds(...ids);
          else window.ezstandalone.showAds();
        }
      } catch (e) {
        console.warn('Ezoic init failed; CamBus continues without network ads.', e);
      }
    });
  }

  function attachFeedAds() {
    if (cfg.provider !== 'ezoic' || !cfg.networkScriptsReady) return;
    const placementIds = Array.isArray(cfg.feedPlacementIds) ? cfg.feedPlacementIds.map(validPlacement) : [];
    const slots = [...document.querySelectorAll('.feed-inline-ad-slot')];
    if (!slots.length) return;

    const ids = [];
    slots.forEach((slot, index) => {
      const id = placementIds[index] || null;
      if (!id) return; // keep the house/demo fallback when no placement is configured
      const wrapper = slot.closest('.feed-inline-ad');
      wrapper?.classList.add('ad-network');
      slot.innerHTML = `<div id="ezoic-pub-ad-placeholder-${id}"></div>`;
      ids.push(id);
    });

    if (!ids.length) return;
    ezoicCommand(function () {
      try {
        if (typeof window.ezstandalone.showAds === 'function') window.ezstandalone.showAds(...ids);
      } catch (e) {
        console.warn('Ezoic feed placement failed.', e);
      }
    });
  }

  /** 관리자 화면에서 끈 위치는 아예 감춘다. */
  function applySlotVisibility() {
    const slots = cfg.layout?.slots || {};
    const map = {
      mainBottom: document.getElementById('bottomAd'),
      launch: document.getElementById('launchAd'),
      picksFooter: document.getElementById('linksAd')
    };
    for (const [name, el] of Object.entries(map)) {
      if (el && slots[name] && slots[name].enabled === false) el.hidden = true;
    }
    if (slots.mainBottom && slots.mainBottom.enabled === false) setBannerHeight(0);
  }

  // ---- 노출/클릭 집계 ----
  // 화면에 절반 이상이 1초 넘게 보였을 때만 노출 1회로 센다.
  // 스크롤로 스쳐 지나간 것까지 세면 광고주에게 줄 숫자가 부풀려진다.
  const VIEWABLE_RATIO = 0.5;
  const VIEWABLE_MS = 1000;
  const counted = new WeakSet();
  const pending = new WeakMap();

  function sendAdEvent(adId, slot, type) {
    const body = JSON.stringify({ adId, slot, type });
    try {
      if (type === 'click' && navigator.sendBeacon) {
        navigator.sendBeacon('/api/ad-event', new Blob([body], { type: 'application/json' }));
        return;
      }
    } catch { /* 아래 fetch 로 넘어간다 */ }
    fetch('/api/ad-event', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true
    }).catch(() => {});
  }

  let observer = null;
  function viewObserver() {
    if (observer || typeof IntersectionObserver !== 'function') return observer;
    observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const el = entry.target;
        if (entry.isIntersecting && entry.intersectionRatio >= VIEWABLE_RATIO) {
          if (counted.has(el) || pending.has(el)) continue;
          pending.set(el, setTimeout(() => {
            pending.delete(el);
            if (counted.has(el)) return;
            counted.add(el);
            observer.unobserve(el);
            sendAdEvent(el.dataset.adId || 'unknown', el.dataset.adSlot || 'unknown', 'impression');
          }, VIEWABLE_MS));
        } else if (pending.has(el)) {
          clearTimeout(pending.get(el));
          pending.delete(el);
        }
      }
    }, { threshold: [VIEWABLE_RATIO] });
    return observer;
  }

  /** 광고를 담은 요소를 집계 대상으로 등록한다. */
  function trackAd(el, adId, slot) {
    if (!el) return;
    el.dataset.adId = adId || 'unknown';
    el.dataset.adSlot = slot || 'unknown';
    viewObserver()?.observe(el);
  }

  document.addEventListener('click', event => {
    const el = event.target.closest?.('[data-ad-id]');
    if (!el) return;
    sendAdEvent(el.dataset.adId, el.dataset.adSlot || 'unknown', 'click');
  }, true);

  function trackStaticSlots() {
    const slots = cfg.layout?.slots || {};
    if (slots.mainBottom?.enabled !== false) trackAd(document.getElementById('bottomAd'), 'slot:mainBottom', 'mainBottom');
    if (slots.launch?.enabled !== false) trackAd(document.getElementById('launchAd'), 'slot:launch', 'launch');
    if (slots.picksFooter?.enabled !== false) trackAd(document.getElementById('linksAd'), 'slot:picksFooter', 'picksFooter');
  }

  function init() {
    setBannerHeight(cfg.provider === 'none' ? 0 : cfg.bannerHeight);
    applySlotVisibility();
    trackStaticSlots();

    const launch = document.getElementById('launchAd');
    const close = document.getElementById('closeLaunchAd');
    if (close) close.addEventListener('click', dismissLaunchAd);

    if (cfg.provider === 'none') {
      if (launch) launch.hidden = true;
      const bottom = document.getElementById('bottomAd');
      const links = document.getElementById('linksAd');
      if (bottom) bottom.hidden = true;
      if (links) links.hidden = true;
      document.querySelectorAll('.feed-inline-ad').forEach(el => { el.hidden = true; });
      return;
    }

    if (launch) {
      if (launchSeen()) launch.hidden = true;
      else {
        launch.hidden = false;
        markLaunchSeen();
      }
    }

    if (cfg.provider === 'ezoic' && cfg.networkScriptsReady) {
      initEzoicBase();
      attachFeedAds();
    } else if (cfg.provider === 'ezoic') {
      console.warn('Ezoic was selected but the approved header scripts are not marked ready; keeping visible house ads.');
      showDemoSlots();
    } else {
      showDemoSlots();
    }
  }

  window.addEventListener('busyu:feed-rendered', attachFeedAds);

  window.addEventListener('busyu:page-change', event => {
    if (cfg.provider !== 'ezoic' || !cfg.networkScriptsReady || !cfg.useEzoicAnchor) return;
    const showMainAnchor = Number(event.detail?.index || 0) === 0;
    ezoicCommand(function () {
      try {
        if (typeof window.ezstandalone.setEzoicAnchorAd === 'function') {
          window.ezstandalone.setEzoicAnchorAd(showMainAnchor);
        }
      } catch (e) {
        console.warn('Ezoic anchor page switch failed.', e);
      }
    });
  });

  async function bootstrap() {
    await loadRemoteConfig();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
      init();
    }
  }

  window.YUAds = { config: cfg, init, dismissLaunchAd, attachFeedAds, loadRemoteConfig, trackAd };
  bootstrap();
})();
