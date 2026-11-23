/**
 * CamBus 지도 화면 UI 보조 스크립트.
 * - 지도 위 상단 검색바 <-> 길찾기 패널의 도착지 입력 동기화
 * - 출발/도착 스왑
 * - 패널 닫기(Esc / 배경 복귀)
 * app.js 의 기존 요소와 핸들러는 그대로 두고, 그 위에 얹기만 한다.
 */
(function () {
  const panel = document.getElementById('sidePanel');
  const searchInput = document.getElementById('mapSearchInput');
  const clearBtn = document.getElementById('mapSearchClear');
  const startInput = document.getElementById('startInput');
  const destinationInput = document.getElementById('destinationInput');
  const swapBtn = document.getElementById('swapEndpointsBtn');
  const routeBtn = document.getElementById('routeBtn');
  if (!panel) return;

  /** app.js 가 듣고 있는 이벤트를 모두 흘려 보낸다. */
  function notify(input) {
    if (!input) return;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function openPanel() {
    panel.classList.add('open');
    (destinationInput?.value ? routeBtn : destinationInput)?.focus?.({ preventScroll: true });
  }

  function syncClearButton() {
    if (clearBtn) clearBtn.hidden = !searchInput?.value;
  }

  // 검색바에 입력한 장소는 곧바로 도착지가 된다.
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      syncClearButton();
      if (destinationInput) destinationInput.value = searchInput.value;
    });
    searchInput.addEventListener('change', () => {
      if (!destinationInput) return;
      destinationInput.value = searchInput.value;
      notify(destinationInput);
      if (searchInput.value.trim()) openPanel();
    });
    searchInput.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      if (destinationInput) {
        destinationInput.value = searchInput.value;
        notify(destinationInput);
      }
      openPanel();
      if (searchInput.value.trim()) routeBtn?.click();
    });
  }

  clearBtn?.addEventListener('click', () => {
    if (!searchInput) return;
    searchInput.value = '';
    syncClearButton();
    if (destinationInput) {
      destinationInput.value = '';
      notify(destinationInput);
    }
    searchInput.focus();
  });

  // 패널에서 도착지를 바꾸면 검색바에도 반영한다.
  destinationInput?.addEventListener('change', () => {
    if (!searchInput || searchInput.value === destinationInput.value) return;
    searchInput.value = destinationInput.value;
    syncClearButton();
  });

  swapBtn?.addEventListener('click', () => {
    if (!startInput || !destinationInput) return;
    const start = startInput.value;
    startInput.value = destinationInput.value;
    destinationInput.value = start;
    notify(startInput);
    notify(destinationInput);
    if (searchInput) {
      searchInput.value = destinationInput.value;
      syncClearButton();
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && panel.classList.contains('open')) panel.classList.remove('open');
  });

  // ---- 모바일 길찾기 시트: 기본은 절반, 손잡이를 끌거나 눌러 전체화면 ----
  const handle = document.getElementById('sheetHandle');
  const isSheet = () => window.matchMedia('(max-width: 720px)').matches;
  // CSS 의 --sheet-half 를 그대로 읽어 값이 어긋나지 않게 한다.
  const halfOffset = () => {
    const raw = getComputedStyle(panel).getPropertyValue('--sheet-half').trim();
    const value = parseFloat(raw);
    if (!Number.isFinite(value)) return window.innerHeight * 0.4;
    return raw.endsWith('vh') ? (window.innerHeight * value) / 100 : value;
  };
  const tallOffset = () => panel.offsetHeight;          // 완전히 내리면 화면 밖

  function setSnap(offset) {
    const tall = tallOffset();
    if (offset >= tall - 40) {           // 아래로 충분히 내리면 닫는다
      panel.style.removeProperty('--sheet-y');
      panel.classList.remove('open');
      panel.dataset.snap = 'half';
      return;
    }
    const full = offset <= halfOffset() / 2;
    panel.dataset.snap = full ? 'full' : 'half';
    if (full) panel.style.setProperty('--sheet-y', '0px');
    else panel.style.removeProperty('--sheet-y');
    document.body.classList.toggle('sheet-full', full);
  }

  if (handle) {
    let dragging = null;
    handle.addEventListener('pointerdown', event => {
      if (!isSheet() || !panel.classList.contains('open')) return;
      const current = panel.dataset.snap === 'full' ? 0 : halfOffset();
      dragging = { id: event.pointerId, y: event.clientY, start: current, moved: false };
      handle.setPointerCapture(event.pointerId);
      panel.classList.add('dragging');
    });
    handle.addEventListener('pointermove', event => {
      if (!dragging || event.pointerId !== dragging.id) return;
      const delta = event.clientY - dragging.y;
      if (Math.abs(delta) > 4) dragging.moved = true;
      const next = Math.max(0, Math.min(tallOffset(), dragging.start + delta));
      panel.style.setProperty('--sheet-y', `${next}px`);
    });
    const endDrag = event => {
      if (!dragging || event.pointerId !== dragging.id) return;
      const delta = event.clientY - dragging.y;
      panel.classList.remove('dragging');
      if (!dragging.moved) {
        // 끌지 않고 누르기만 하면 절반 <-> 전체화면 토글
        setSnap(panel.dataset.snap === 'full' ? halfOffset() : 0);
      } else {
        const landed = Math.max(0, Math.min(tallOffset(), dragging.start + delta));
        const snaps = [0, halfOffset(), tallOffset()];
        setSnap(snaps.reduce((best, v) => (Math.abs(v - landed) < Math.abs(best - landed) ? v : best)));
      }
      dragging = null;
    };
    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);
  }

  // 패널이 열린 동안에만 body 에 표시를 남겨, 겹치는 지도 위 컨트롤을 CSS 로 감춘다.
  const syncOpenState = () => {
    const open = panel.classList.contains('open');
    document.body.classList.toggle('route-open', open);
    if (!open) {
      panel.style.removeProperty('--sheet-y');
      panel.dataset.snap = 'half';
      document.body.classList.remove('sheet-full');
    }
  };
  new MutationObserver(syncOpenState).observe(panel, { attributes: true, attributeFilter: ['class'] });
  panel.dataset.snap = 'half';
  syncOpenState();

  syncClearButton();
})();
