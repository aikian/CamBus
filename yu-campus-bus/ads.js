/**
 * Ad adapter for YU Campus Move.
 * Default = demo placeholders only. No ad-network request is made until provider is changed to "ezoic"
 * and the production Ezoic integration scripts / placement IDs are supplied by the publisher.
 */
(function () {
  const DEFAULTS = {
    provider: 'demo', // demo | ezoic | none
    launchPlacementId: null,
    linksPlacementId: null,
    launchSessionKey: 'yu-move-launch-ad-v1',
    showLaunchOncePerSession: true,
    useEzoicAnchor: true,
    bannerHeight: 58
  };
  const cfg = Object.assign({}, DEFAULTS, window.YU_ADS_CONFIG || {});

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
    const bottom = document.getElementById('bottomAd');
    const launch = document.getElementById('launchAd');
    const links = document.getElementById('linksAd');
    if (bottom) bottom.classList.add('ad-demo');
    if (launch) launch.classList.add('ad-demo');
    if (links) links.classList.add('ad-demo');
  }

  function initEzoic() {
    const launch = document.getElementById('launchAdSlot');
    const linksSlot = document.getElementById('linksAdSlot');
    const linksAd = document.getElementById('linksAd');
    const bottom = document.getElementById('bottomAd');
    if (bottom) bottom.classList.add('ad-network');
    if (linksAd) linksAd.classList.add('ad-network');

    window.ezstandalone = window.ezstandalone || {};
    window.ezstandalone.cmd = window.ezstandalone.cmd || [];
    window.ezstandalone.cmd.push(function () {
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
        if (cfg.launchPlacementId && launch) {
          const id = Number(cfg.launchPlacementId);
          if (Number.isInteger(id) && id > 0) {
            launch.innerHTML = `<div id="ezoic-pub-ad-placeholder-${id}"></div>`;
            ids.push(id);
          }
        }
        if (cfg.linksPlacementId && linksSlot) {
          const id = Number(cfg.linksPlacementId);
          if (Number.isInteger(id) && id > 0) {
            linksSlot.innerHTML = `<div id="ezoic-pub-ad-placeholder-${id}"></div>`;
            ids.push(id);
          }
        }
        if (typeof window.ezstandalone.showAds === 'function') {
          if (ids.length) window.ezstandalone.showAds(...ids);
          else window.ezstandalone.showAds();
        }
      } catch (e) {
        console.warn('Ezoic init failed; app continues without ads.', e);
      }
    });
  }

  function init() {
    setBannerHeight(cfg.provider === 'none' ? 0 : cfg.bannerHeight);

    const launch = document.getElementById('launchAd');
    const close = document.getElementById('closeLaunchAd');
    if (close) close.addEventListener('click', dismissLaunchAd);

    if (cfg.provider === 'none') {
      if (launch) launch.hidden = true;
      const bottom = document.getElementById('bottomAd');
      const links = document.getElementById('linksAd');
      if (bottom) bottom.hidden = true;
      if (links) links.hidden = true;
      return;
    }

    if (launch) {
      if (launchSeen()) launch.hidden = true;
      else {
        launch.hidden = false;
        // Mark on first render, not only close, so reload loops cannot create repeated "first" impressions.
        markLaunchSeen();
      }
    }

    if (cfg.provider === 'ezoic') initEzoic();
    else showDemoSlots();
  }

  window.addEventListener('busyu:page-change', event => {
    if (cfg.provider !== 'ezoic' || !cfg.useEzoicAnchor) return;
    const showMainAnchor = Number(event.detail?.index || 0) === 0;
    window.ezstandalone = window.ezstandalone || {};
    window.ezstandalone.cmd = window.ezstandalone.cmd || [];
    window.ezstandalone.cmd.push(function () {
      try {
        if (typeof window.ezstandalone.setEzoicAnchorAd === 'function') {
          window.ezstandalone.setEzoicAnchorAd(showMainAnchor);
        }
      } catch (e) {
        console.warn('Ezoic anchor page switch failed.', e);
      }
    });
  });

  window.YUAds = { config: cfg, init, dismissLaunchAd };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
