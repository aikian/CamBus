/* 홈 화면 추가(PWA 설치) 유도
 *
 * 안드로이드/데스크톱 Chromium: beforeinstallprompt 를 가로채 두었다가 사용자가 버튼을
 *   누르면 prompt() 를 호출합니다. 버튼 한 번으로 네이티브 설치 창이 뜹니다.
 * iOS Safari: 설치를 코드로 띄우는 API가 없습니다(애플 미지원). 공유 시트 경로만 안내합니다.
 *
 * 이미 설치해서 실행 중이거나 사용자가 닫은 경우에는 다시 띄우지 않습니다.
 */
(function () {
  'use strict';

  var DISMISS_KEY = 'cambus.install.dismissed.v1';
  var DISMISS_DAYS = 14;

  var bar = document.getElementById('installBar');
  var sub = document.getElementById('installSub');
  var goBtn = document.getElementById('installGo');
  var closeBtn = document.getElementById('installClose');
  var iosDialog = document.getElementById('iosInstallDialog');
  var closeIos = document.getElementById('closeIosInstall');
  if (!bar || !goBtn) return;

  var deferredPrompt = null;

  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      window.navigator.standalone === true;
  }

  function isIos() {
    var ua = navigator.userAgent || '';
    // iPadOS 13+ 는 Mac 으로 위장하므로 터치 지원 여부로 함께 판별합니다.
    return /iPad|iPhone|iPod/.test(ua) ||
      (/Macintosh/.test(ua) && typeof document.ontouchend !== 'undefined');
  }

  // iOS 에서 홈 화면 추가는 Safari 에서만 됩니다. 인앱 브라우저/크롬은 메뉴가 없습니다.
  function isIosSafari() {
    var ua = navigator.userAgent || '';
    return isIos() && !/CriOS|FxiOS|EdgiOS|OPiOS|Whale|NAVER|KAKAOTALK|Instagram|FBAN|FBAV|Line/i.test(ua);
  }

  function dismissed() {
    try {
      var until = Number(localStorage.getItem(DISMISS_KEY));
      return Number.isFinite(until) && until > Date.now();
    } catch (e) { return false; }
  }

  function remember() {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_DAYS * 864e5)); } catch (e) {}
  }

  function show(subtitle) {
    if (isStandalone() || dismissed()) return;
    if (subtitle && sub) sub.textContent = subtitle;
    bar.hidden = false;
    requestAnimationFrame(function () { bar.classList.add('show'); });
  }

  function hide() {
    bar.classList.remove('show');
    setTimeout(function () { bar.hidden = true; }, 220);
  }

  // ── 안드로이드 / 데스크톱 Chromium ───────────────────────────────────────
  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault();          // 브라우저 기본 미니 배너를 막고 우리 배너를 씁니다.
    deferredPrompt = event;
    show('한 번 누르면 바로 설치돼요');
  });

  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    remember();
    hide();
  });

  goBtn.addEventListener('click', async function () {
    if (deferredPrompt) {
      var prompt = deferredPrompt;
      deferredPrompt = null;
      hide();
      prompt.prompt();
      try { await prompt.userChoice; } catch (e) {}
      return;
    }
    if (isIos()) {
      if (iosDialog && typeof iosDialog.showModal === 'function') iosDialog.showModal();
      return;
    }
    // 설치 조건을 아직 못 갖췄거나 지원하지 않는 브라우저
    hide();
  });

  closeBtn?.addEventListener('click', function () { remember(); hide(); });
  closeIos?.addEventListener('click', function () { iosDialog.close(); });
  iosDialog?.addEventListener('click', function (e) { if (e.target === iosDialog) iosDialog.close(); });

  // ── iOS ────────────────────────────────────────────────────────────────
  // beforeinstallprompt 가 없으므로 직접 띄웁니다. 첫 진입에 바로 가리지 않도록 잠시 뒤에.
  if (isIos() && !isStandalone() && !dismissed()) {
    setTimeout(function () {
      if (!isIosSafari()) return;    // Safari 가 아니면 추가 자체가 불가능하므로 띄우지 않습니다.
      show('공유 → 홈 화면에 추가');
    }, 3500);
  }
})();
