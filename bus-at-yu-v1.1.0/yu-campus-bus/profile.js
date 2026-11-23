// Both entry points use the same clock, including a direct campus or PWA launch.
(() => {
  const firstVisitKey = 'cambus.firstVisitAt';
  const profileKey = 'cambus.profile.v1';
  const delay = 72 * 60 * 60 * 1000;
  function firstVisitAt() {
    const now = Date.now();
    const stored = Number(localStorage.getItem(firstVisitKey));
    if (Number.isSafeInteger(stored) && stored > 0 && stored <= now) return stored;
    localStorage.setItem(firstVisitKey, String(now));
    return now;
  }

  try {
    firstVisitAt();
    if (document.body?.dataset.campus) localStorage.setItem('cambus.campus', document.body.dataset.campus);
  } catch { return; }
  const dialog = document.getElementById('profileDialog');
  if (!dialog) return;

  const form = dialog.querySelector('form');
  const { age, gender, occupation, participate } = form.elements;
  const settings = document.getElementById('profileSettings');
  const choice = document.getElementById('audienceChoice');
  const receiptKey = 'cambus.audience.month';
  let serverReady = false;
  let editing = false;
  let sending = false;

  function savedProfile() {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(profileKey)); } catch { return null; }
    const valid = Number.isInteger(saved?.age) && saved.age >= Number(age.min) && saved.age <= Number(age.max)
      && [...gender.options].some(o => o.value && o.value === saved.gender)
      && [...occupation.options].some(o => o.value && o.value === saved.occupation);
    return valid ? saved : null;
  }

  function updateChoice() {
    const eligible = age.validity.valid && age.valueAsNumber >= 14;
    choice.hidden = !eligible || !(serverReady || savedProfile()?.participate === true);
    if (!eligible) participate.checked = false;
  }

  async function submitMonth() {
    const profile = savedProfile();
    if (!serverReady || profile?.participate !== true || profile.age < 14) return;
    const month = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 7);
    let receipt = JSON.parse(localStorage.getItem(receiptKey));
    if (receipt?.month !== month || !receipt.id) {
      receipt = { month, id: crypto.randomUUID() };
      localStorage.setItem(receiptKey, JSON.stringify(receipt));
    }
    if (receipt.sent) return;
    const ageBand = profile.age < 20 ? '14~19세' : profile.age >= 60 ? '60세 이상' : Math.floor(profile.age / 10) * 10 + '대';
    const response = await fetch('/api/audience', {
      method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ month, receipt: receipt.id, ageBand, gender: profile.gender, occupation: profile.occupation }),
      signal: AbortSignal.timeout(10000)
    });
    if (response.ok && (await response.json()).ok && JSON.parse(localStorage.getItem(receiptKey))?.id === receipt.id) {
      localStorage.setItem(receiptKey, JSON.stringify({ ...receipt, sent: true }));
    }
  }

  async function syncAudience() {
    if (sending || !serverReady || document.hidden) return;
    sending = true;
    try {
      if (navigator.locks) await navigator.locks.request(receiptKey, submitMonth);
      else await submitMonth();
    } catch { /* Retry with the same receipt on the next visit or reconnect. */ }
    finally { sending = false; }
  }

  function checkOnVisit() {
    if (document.hidden) return;
    try {
      const saved = savedProfile();
      settings.hidden = !saved;
      const due = Date.now() - firstVisitAt() >= delay && !saved;
      if (due && !dialog.open) { editing = false; dialog.showModal(); }
      if (!due && !editing && dialog.open) dialog.close();
      syncAudience();
    } catch { /* Browser storage may be disabled during a visit. */ }
  }

  settings.addEventListener('click', () => {
    const saved = savedProfile();
    if (!saved) return;
    age.value = saved.age;
    gender.value = saved.gender;
    occupation.value = saved.occupation;
    participate.checked = saved.participate === true;
    updateChoice();
    editing = true;
    dialog.showModal();
  });
  age.addEventListener('input', updateChoice);
  dialog.addEventListener('cancel', event => { if (!editing) event.preventDefault(); });
  dialog.addEventListener('close', () => { editing = false; });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    try {
      localStorage.setItem(profileKey, JSON.stringify({
        age: age.valueAsNumber, gender: gender.value, occupation: occupation.value,
        participate: !choice.hidden && age.valueAsNumber >= 14 && participate.checked
      }));
      editing = false;
      dialog.close();
      checkOnVisit();
    } catch {
      form.querySelector('[role="alert"]').textContent = '저장할 수 없습니다. 브라우저의 사이트 데이터 저장 설정을 확인해 주세요.';
    }
  });
  window.addEventListener('cambus:audience-ready', () => {
    serverReady = true;
    updateChoice();
    syncAudience();
  });
  window.addEventListener('online', syncAudience);
  window.addEventListener('pageshow', checkOnVisit);
  document.addEventListener('visibilitychange', checkOnVisit);
  window.addEventListener('storage', event => {
    if (event.key === profileKey || event.key === null) {
      editing = false;
      participate.checked = false;
      checkOnVisit();
    }
  });
  checkOnVisit();
})();
