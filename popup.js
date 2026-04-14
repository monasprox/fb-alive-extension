/**
 * [FB-QA] popup.js  v2.1.0
 *
 * UI controller — tabbed layout, real cookie list + copy, tab rotation, telegram.
 */

(function () {
  'use strict';

  // ─── Element refs ──────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);

  const powerBtn      = $('powerBtn');
  const statusBadge   = $('statusBadge');
  const statusText    = $('statusText');
  const uptimeDisplay = $('uptimeDisplay');
  const domainPill    = $('domainPill');
  const domainText    = $('domainText');
  const footerHost    = $('footerHost');
  const statusCard    = $('statusCard');
  const warningCard   = $('warningCard');
  const actionHint    = $('actionHint');
  const logPanel      = $('logPanel');
  const clearLogBtn   = $('clearLogBtn');
  const logCount      = $('logCount');

  // Sliders
  const intervalMinInput = $('intervalMin');
  const intervalMaxInput = $('intervalMax');
  const scrollMinInput   = $('scrollMin');
  const scrollMaxInput   = $('scrollMax');
  const intervalMinVal   = $('intervalMinVal');
  const intervalMaxVal   = $('intervalMaxVal');
  const scrollMinVal     = $('scrollMinVal');
  const scrollMaxVal     = $('scrollMaxVal');

  // Base toggles
  const jitterToggle   = $('jitterToggle');
  const safeModeToggle = $('safeModeToggle');
  const debugToggle    = $('debugToggle');

  // Browse mode
  const browseModeToggle    = $('browseModeToggle');
  const browseFreqInput     = $('browseFreq');
  const browseFreqVal       = $('browseFreqVal');
  const browseSubs          = $('browseSubs');
  const browseFreqRow       = $('browseFreqRow');
  const browseStoryToggle   = $('browseStoryToggle');
  const browseHoverToggle   = $('browseHoverToggle');
  const browseProfileToggle = $('browseProfileToggle');
  const browsePostToggle    = $('browsePostToggle');

  // Cookie panel
  const cookieTrackingToggle = $('cookieTrackingToggle');
  const cookieList           = $('cookieList');
  const cookieCount          = $('cookieCount');
  const copyCookieStringBtn  = $('copyCookieStringBtn');
  const copyCookieJsonBtn    = $('copyCookieJsonBtn');
  const forceCookieCheckBtn  = $('forceCookieCheckBtn');
  const cookieChangesPanel   = $('cookieChangesPanel');

  // Tab rotation
  const tabRotationToggle    = $('tabRotationToggle');
  const rotationUrlsList     = $('rotationUrlsList');
  const tabRotateDwellInput  = $('tabRotateDwell');
  const tabRotateDwellVal    = $('tabRotateDwellVal');
  const forceRotateBtn       = $('forceRotateBtn');

  // Telegram
  const telegramToggle   = $('telegramToggle');
  const tgBotToken       = $('tgBotToken');
  const tgModeGroup      = $('tgModeGroup');
  const tgModePrivate    = $('tgModePrivate');
  const tgGroupFields    = $('tgGroupFields');
  const tgPrivateFields  = $('tgPrivateFields');
  const tgGroupChatId    = $('tgGroupChatId');
  const tgTopicId        = $('tgTopicId');
  const tgPrivateChatId  = $('tgPrivateChatId');
  const tgTestBtn        = $('tgTestBtn');
  const tgTestResult     = $('tgTestResult');
  const telegramFields   = $('telegramFields');

  // Tab bar
  const tabBar = $('tabBar');

  // ─── Runtime state ─────────────────────────────────────────────────────────
  let currentStatus  = 'STOPPED';
  let currentTabId   = null;
  let isFbTab        = false;
  let sessionStart   = null;
  let uptimeTick     = null;
  let pollHandle     = null;
  let saveDebounce   = null;
  let cachedCookies  = [];

  // ─── Tab switching ─────────────────────────────────────────────────────────
  tabBar.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-btn');
    if (!btn) return;
    const tabName = btn.dataset.tab;

    // Update active tab button
    tabBar.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // Show matching panel
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    const panel = $('panel-' + tabName);
    if (panel) panel.classList.add('active');

    // Load cookies when switching to cookie tab
    if (tabName === 'cookies') loadCookieList();
  });

  // ─── Initialisation ────────────────────────────────────────────────────────
  async function init() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      currentTabId = tab.id;
      let host = '';
      try { host = new URL(tab.url).hostname; } catch {}

      isFbTab = host.endsWith('facebook.com');
      domainText.textContent = host || '—';
      footerHost.textContent = host || '—';
      domainPill.className   = `domain-pill ${isFbTab ? 'valid' : 'invalid'}`;

      if (!isFbTab) {
        statusCard.style.opacity = '0.45';
        statusCard.style.pointerEvents = 'none';
        warningCard.style.display = 'flex';
      } else {
        powerBtn.disabled = false;
        powerBtn.setAttribute('aria-label', 'Start monitoring');
      }
    }

    try {
      const resp = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
      if (resp) {
        if (resp.settings) applySettings(resp.settings);
        if (resp.state)    applyState(resp.state);
      }
    } catch {}

    attachSettingsListeners();
    pollHandle = setInterval(pollBackground, 1500);
  }

  // ─── Cookie list — real values from chrome.cookies ─────────────────────────
  async function loadCookieList() {
    try {
      const cookies = await chrome.cookies.getAll({ domain: '.facebook.com' });
      cachedCookies = cookies;
      cookieCount.textContent = `${cookies.length} cookies`;

      if (cookies.length === 0) {
        cookieList.innerHTML = '<div class="log-empty">No Facebook cookies found</div>';
        return;
      }

      // Sort by name for readability
      cookies.sort((a, b) => a.name.localeCompare(b.name));

      cookieList.innerHTML = cookies.map(c => {
        const safeName = esc(c.name);
        const safeVal  = esc(c.value);
        return `<div class="cookie-item">` +
          `<span class="cookie-name" title="${safeName}">${safeName}</span>` +
          `<span class="cookie-eq">=</span>` +
          `<span class="cookie-val" title="${safeVal}">${safeVal}</span>` +
          `</div>`;
      }).join('');
    } catch (err) {
      cookieList.innerHTML = `<div class="log-empty">Error loading cookies</div>`;
    }
  }

  function esc(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;')
              .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ─── Copy cookies ──────────────────────────────────────────────────────────
  copyCookieStringBtn.addEventListener('click', async () => {
    if (cachedCookies.length === 0) await loadCookieList();
    const str = cachedCookies.map(c => `${c.name}=${c.value}`).join('; ');
    await copyToClipboard(str, copyCookieStringBtn);
  });

  copyCookieJsonBtn.addEventListener('click', async () => {
    if (cachedCookies.length === 0) await loadCookieList();
    const arr = cachedCookies.map(c => ({
      name: c.name, value: c.value, domain: c.domain,
      path: c.path, httpOnly: c.httpOnly, secure: c.secure
    }));
    await copyToClipboard(JSON.stringify(arr, null, 2), copyCookieJsonBtn);
  });

  async function copyToClipboard(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
      const orig = btn.textContent;
      btn.textContent = '✓ Copied!';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = orig;
        btn.classList.remove('copied');
      }, 1500);
    } catch {
      // fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
  }

  // ─── State → UI ────────────────────────────────────────────────────────────
  function applyState(state) {
    currentStatus = state.status;
    sessionStart  = state.startTime || null;

    statusBadge.className = `status-badge ${state.status.toLowerCase()}`;
    statusText.textContent = state.status;

    statusCard.classList.toggle('is-active', state.status === 'ACTIVE');
    statusCard.classList.toggle('is-paused', state.status === 'PAUSED');

    if (isFbTab) {
      const running = state.status === 'ACTIVE' || state.status === 'PAUSED';
      powerBtn.classList.toggle('running', running);
      powerBtn.setAttribute('aria-label', running ? 'Stop monitoring' : 'Start monitoring');

      if (state.status === 'ACTIVE') {
        actionHint.textContent = 'Monitoring active — scroll loop running';
      } else if (state.status === 'PAUSED') {
        actionHint.textContent = 'Paused — tab hidden';
      } else {
        actionHint.textContent = 'Press to start monitoring';
      }
    }

    if (state.status !== 'STOPPED' && sessionStart) {
      if (!uptimeTick) {
        uptimeTick = setInterval(tickUptime, 1000);
        tickUptime();
      }
    } else {
      stopUptimeTick();
      uptimeDisplay.textContent = '00:00:00';
    }

    if (state.activityLog && state.activityLog.length > 0) {
      renderLog(state.activityLog);
    }

    if (state.cookieChanges) {
      renderCookieChanges(state.cookieChanges);
    }
  }

  function tickUptime() {
    if (!sessionStart) return;
    const elapsed = Math.floor((Date.now() - sessionStart) / 1000);
    const h = String(Math.floor(elapsed / 3600)).padStart(2, '0');
    const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
    const s = String(elapsed % 60).padStart(2, '0');
    uptimeDisplay.textContent = `${h}:${m}:${s}`;
  }

  function stopUptimeTick() {
    if (uptimeTick) { clearInterval(uptimeTick); uptimeTick = null; }
  }

  // ─── Activity log ──────────────────────────────────────────────────────────
  function logClass(msg) {
    const m = msg.toLowerCase();
    if (m.includes('rest') || m.includes('nghỉ'))        return 'log-rest';
    if (m.startsWith('scroll'))                           return 'log-scroll';
    if (m.startsWith('🍪') || m.includes('cookie'))      return 'log-cookie';
    if (m.startsWith('🔄') || m.includes('rotat'))       return 'log-rotate';
    if (m.startsWith('stories') || m.startsWith('browse') ||
        m.startsWith('post') || m.startsWith('profile') ||
        m.startsWith('friend') || m.startsWith('reel'))  return 'log-browse';
    if (m.startsWith('pause'))                            return 'log-paused';
    if (m.startsWith('stopped') || m.startsWith('stop')) return 'log-stopped';
    return 'log-session';
  }

  function renderLog(entries) {
    if (!entries || entries.length === 0) {
      logPanel.innerHTML = '<div class="log-empty">No activity yet</div>';
      logCount.textContent = '0';
      return;
    }
    logCount.textContent = entries.length;
    logPanel.innerHTML = entries.map(entry => {
      const ts = new Date(entry.time).toTimeString().slice(0, 8);
      const safeMsg = esc(entry.msg);
      const cls = logClass(entry.msg);
      return `<div class="log-item ${cls}"><span class="log-ts">${ts}</span><span class="log-msg">${safeMsg}</span></div>`;
    }).join('');
    // Auto-scroll to top (newest first)
    logPanel.scrollTop = 0;
  }

  // ─── Cookie changes ───────────────────────────────────────────────────────
  function renderCookieChanges(changes) {
    if (!changes || changes.length === 0) {
      cookieChangesPanel.innerHTML = '<div class="log-empty">No cookie changes detected</div>';
      return;
    }
    cookieChangesPanel.innerHTML = changes.slice(0, 15).map(c => {
      const ts = new Date(c.time).toTimeString().slice(0, 8);
      const icon = c.type === 'removed' ? '❌' : c.type === 'added' ? '✅' : '🔄';
      const safeName = esc(c.name);
      return `<div class="log-item log-browse"><span class="log-ts">${ts}</span><span class="log-msg">${icon} ${c.type}: ${safeName}</span></div>`;
    }).join('');
  }

  // ─── Rotation URLs ─────────────────────────────────────────────────────────
  function renderRotationUrls(urls) {
    if (!urls || urls.length === 0) {
      rotationUrlsList.innerHTML = '<div class="log-empty">No rotation URLs</div>';
      return;
    }
    rotationUrlsList.innerHTML = urls.map(url => {
      let path;
      try { path = new URL(url).pathname; } catch { path = url; }
      return `<div class="rotation-url-item">${esc(path)}</div>`;
    }).join('');
  }

  // ─── Slider fill ───────────────────────────────────────────────────────────
  function updateSliderFill(el) {
    const pct = ((el.value - el.min) / (el.max - el.min) * 100).toFixed(1) + '%';
    el.style.setProperty('--val', pct);
  }

  function updateAllSliderFills() {
    [intervalMinInput, intervalMaxInput, scrollMinInput, scrollMaxInput,
     browseFreqInput, tabRotateDwellInput].forEach(updateSliderFill);
  }

  // ─── Browse panel visibility ───────────────────────────────────────────────
  function updateBrowsePanelVisibility() {
    const on = browseModeToggle.checked;
    browseSubs.style.display    = on ? 'block' : 'none';
    browseFreqRow.style.display = on ? 'block' : 'none';
    const browseCard = document.querySelector('.browse-card');
    if (browseCard) browseCard.classList.toggle('is-enabled', on);
  }

  function updateTelegramFieldsVisibility() {
    telegramFields.style.display = telegramToggle.checked ? 'flex' : 'none';
    // Show/hide group vs private fields
    const isGroup = tgModeGroup.checked;
    tgGroupFields.style.display   = isGroup ? 'flex' : 'none';
    tgPrivateFields.style.display = isGroup ? 'none' : 'flex';
  }

  // ─── Settings ──────────────────────────────────────────────────────────────
  function applySettings(s) {
    intervalMinInput.value = s.intervalMin;
    intervalMaxInput.value = s.intervalMax;
    scrollMinInput.value   = s.scrollMin;
    scrollMaxInput.value   = s.scrollMax;
    intervalMinVal.textContent = s.intervalMin;
    intervalMaxVal.textContent = s.intervalMax;
    scrollMinVal.textContent   = s.scrollMin;
    scrollMaxVal.textContent   = s.scrollMax;
    jitterToggle.checked   = !!s.jitter;
    safeModeToggle.checked = !!s.safeMode;
    debugToggle.checked    = !!s.debugMode;

    updateAllSliderFills();

    browseModeToggle.checked = !!s.browseMode;
    const freqPct = Math.round((s.browseFreq || 0.15) * 100);
    browseFreqInput.value     = freqPct;
    browseFreqVal.textContent = freqPct;
    browseStoryToggle.checked   = s.browseStory   !== false;
    browseHoverToggle.checked   = s.browseHover   !== false;
    browseProfileToggle.checked = s.browseProfile  !== false;
    browsePostToggle.checked    = s.browsePost     !== false;
    updateBrowsePanelVisibility();

    cookieTrackingToggle.checked = s.cookieTracking !== false;

    tabRotationToggle.checked = s.tabRotation !== false;
    tabRotateDwellInput.value = s.tabRotateDwell || 60;
    tabRotateDwellVal.textContent = s.tabRotateDwell || 60;
    renderRotationUrls(s.tabRotateUrls || []);

    telegramToggle.checked = s.telegramEnabled !== false;
    tgBotToken.value = s.telegramBotToken || '';
    // Mode: group (default) or private
    const mode = s.telegramMode || 'group';
    tgModeGroup.checked   = mode === 'group';
    tgModePrivate.checked = mode === 'private';
    tgGroupChatId.value   = s.telegramGroupChatId || s.telegramChatId || '';
    tgTopicId.value       = s.telegramTopicId || '';
    tgPrivateChatId.value = s.telegramPrivateChatId || '';
    updateTelegramFieldsVisibility();
  }

  function readSettings() {
    return {
      intervalMin:      parseInt(intervalMinInput.value, 10),
      intervalMax:      parseInt(intervalMaxInput.value, 10),
      scrollMin:        parseInt(scrollMinInput.value, 10),
      scrollMax:        parseInt(scrollMaxInput.value, 10),
      jitter:           jitterToggle.checked,
      safeMode:         safeModeToggle.checked,
      debugMode:        debugToggle.checked,
      browseMode:       browseModeToggle.checked,
      browseFreq:       parseInt(browseFreqInput.value, 10) / 100,
      browseStory:      browseStoryToggle.checked,
      browseHover:      browseHoverToggle.checked,
      browseProfile:    browseProfileToggle.checked,
      browsePost:       browsePostToggle.checked,
      cookieTracking:   cookieTrackingToggle.checked,
      tabRotation:      tabRotationToggle.checked,
      tabRotateDwell:   parseInt(tabRotateDwellInput.value, 10),
      telegramEnabled:      telegramToggle.checked,
      telegramBotToken:     tgBotToken.value.trim(),
      telegramMode:         tgModeGroup.checked ? 'group' : 'private',
      telegramGroupChatId:  tgGroupChatId.value.trim(),
      telegramTopicId:      tgTopicId.value.trim(),
      telegramPrivateChatId: tgPrivateChatId.value.trim(),
    };
  }

  function attachSettingsListeners() {
    function onRangeInput() {
      let iMin = parseInt(intervalMinInput.value, 10);
      let iMax = parseInt(intervalMaxInput.value, 10);
      let sMin = parseInt(scrollMinInput.value, 10);
      let sMax = parseInt(scrollMaxInput.value, 10);

      if (iMin >= iMax) { iMax = iMin + 5; intervalMaxInput.value = iMax; }
      if (sMin >= sMax) { sMax = sMin + 20; scrollMaxInput.value = sMax; }

      intervalMinVal.textContent = iMin;
      intervalMaxVal.textContent = iMax;
      scrollMinVal.textContent   = sMin;
      scrollMaxVal.textContent   = sMax;

      [intervalMinInput, intervalMaxInput, scrollMinInput, scrollMaxInput]
        .forEach(updateSliderFill);
      scheduleSave();
    }

    [intervalMinInput, intervalMaxInput, scrollMinInput, scrollMaxInput]
      .forEach(el => el.addEventListener('input', onRangeInput));

    browseFreqInput.addEventListener('input', () => {
      browseFreqVal.textContent = browseFreqInput.value;
      updateSliderFill(browseFreqInput);
      scheduleSave();
    });

    browseModeToggle.addEventListener('change', () => {
      updateBrowsePanelVisibility();
      scheduleSave();
    });

    [jitterToggle, safeModeToggle, debugToggle,
     browseStoryToggle, browseHoverToggle, browseProfileToggle, browsePostToggle,
     cookieTrackingToggle, tabRotationToggle, telegramToggle,
    ].forEach(el => el.addEventListener('change', scheduleSave));

    telegramToggle.addEventListener('change', () => {
      updateTelegramFieldsVisibility();
      scheduleSave();
    });

    // Telegram mode radio
    tgModeGroup.addEventListener('change', () => {
      updateTelegramFieldsVisibility();
      scheduleSave();
    });
    tgModePrivate.addEventListener('change', () => {
      updateTelegramFieldsVisibility();
      scheduleSave();
    });

    [tgBotToken, tgGroupChatId, tgTopicId, tgPrivateChatId].forEach(el => el.addEventListener('input', scheduleSave));

    // Telegram test button
    tgTestBtn.addEventListener('click', async () => {
      tgTestResult.textContent = 'Sending...';
      tgTestResult.className = 'tg-test-result mono';
      try {
        const resp = await chrome.runtime.sendMessage({ type: 'TELEGRAM_TEST' });
        if (resp && resp.ok) {
          tgTestResult.textContent = '✓ Sent successfully!';
          tgTestResult.className = 'tg-test-result mono success';
        } else {
          tgTestResult.textContent = '✗ ' + (resp?.error || 'Unknown error');
          tgTestResult.className = 'tg-test-result mono error';
        }
      } catch (err) {
        tgTestResult.textContent = '✗ ' + err.message;
        tgTestResult.className = 'tg-test-result mono error';
      }
      setTimeout(() => { tgTestResult.textContent = ''; tgTestResult.className = 'tg-test-result mono'; }, 5000);
    });

    tabRotateDwellInput.addEventListener('input', () => {
      tabRotateDwellVal.textContent = tabRotateDwellInput.value;
      updateSliderFill(tabRotateDwellInput);
      scheduleSave();
    });

    forceCookieCheckBtn.addEventListener('click', async () => {
      try { await chrome.runtime.sendMessage({ type: 'FORCE_COOKIE_CHECK' }); } catch {}
    });

    forceRotateBtn.addEventListener('click', async () => {
      try { await chrome.runtime.sendMessage({ type: 'FORCE_TAB_ROTATE' }); } catch {}
    });
  }

  function scheduleSave() {
    clearTimeout(saveDebounce);
    saveDebounce = setTimeout(async () => {
      try {
        await chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', settings: readSettings() });
      } catch {}
    }, 350);
  }

  // ─── Polling ───────────────────────────────────────────────────────────────
  async function pollBackground() {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
      if (resp && resp.state) applyState(resp.state);
    } catch {}
  }

  // ─── Power button ──────────────────────────────────────────────────────────
  powerBtn.addEventListener('click', async () => {
    if (!isFbTab || powerBtn.disabled) return;
    powerBtn.disabled = true;
    try {
      const isRunning = currentStatus === 'ACTIVE' || currentStatus === 'PAUSED';
      const payload   = isRunning
        ? { type: 'STOP' }
        : { type: 'START', tabId: currentTabId };
      const resp = await chrome.runtime.sendMessage(payload);
      if (resp && resp.state) applyState(resp.state);
    } catch (err) {
      console.error('[FB-QA] Power button error:', err);
    } finally {
      powerBtn.disabled = false;
    }
  });

  // ─── Clear log ─────────────────────────────────────────────────────────────
  clearLogBtn.addEventListener('click', () => {
    logPanel.innerHTML = '<div class="log-empty">No activity yet</div>';
  });

  // ─── Cleanup ───────────────────────────────────────────────────────────────
  window.addEventListener('unload', () => {
    stopUptimeTick();
    clearInterval(pollHandle);
    clearTimeout(saveDebounce);
  });

  // ─── Kick off ──────────────────────────────────────────────────────────────
  init().catch(err => console.error('[FB-QA] popup init error:', err));

})();
