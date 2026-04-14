/**
 * [FB-QA] background.js — MV3 Service Worker  v2.0.0
 *
 * v2.0 additions:
 *  - Cookie Tracker: snapshots cookies at session start, monitors changes,
 *    logs diffs with before/after comparison
 *  - Multi-Tab Rotation: cycles through configurable FB URLs (groups, friends,
 *    feed) to simulate realistic multi-page browsing
 *  - Telegram Reporter: sends session reports, cookie change alerts, and
 *    error notifications to a Telegram bot
 *  - Continuous Running: removed auto-stop on hidden tab, added auto-restart
 *    logic, more aggressive keep-alive
 *
 * v1.1 features retained:
 *  - antiDiscard alarm, CONTENT_READY handler, browse-mode support
 */

'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_ERRORS          = 10;   // bumped: more tolerant before auto-stop
const MIN_INTERVAL_MS     = 5000;
const HEARTBEAT_PERIOD    = 1;    // minutes
const ANTI_DISCARD_PERIOD = 4;    // minutes
const COOKIE_CHECK_PERIOD = 5;    // minutes — check cookies every 5 min
const TAB_ROTATE_PERIOD   = 5;    // minutes — rotate tabs every 5 min
const LOG_MAX_ENTRIES     = 50;   // more log entries

const UNSAFE_URL_PATTERNS = [
  '/checkpoint/', '/login/', '/two_factor',
  '/recover', '/disabled', '/security',
];

/** Default settings */
const DEFAULT_SETTINGS = {
  // ── Scroll timing ──
  intervalMin:  15,
  intervalMax:  90,
  scrollMin:    100,
  scrollMax:    350,
  jitter:       true,
  // ── Safety ──
  safeMode:     true,
  debugMode:    false,
  tabThreshold: 9999, // effectively disabled — continuous running
  // ── Browse mode ──
  browseMode:    false,
  browseFreq:    0.15,
  browseStory:   true,
  browseHover:   true,
  browseProfile: true,
  browsePost:    true,
  // ── Multi-tab rotation (v2.0) ──
  tabRotation:   true,
  tabRotateUrls: [
    'https://www.facebook.com/',
    'https://www.facebook.com/friends/',
    'https://www.facebook.com/reel/',
    'https://www.facebook.com/groups/feed/',
    'https://www.facebook.com/groups/openclawvietnam/',
    'https://www.facebook.com/groups/1385451906420187/',
    'https://www.facebook.com/groups/1911582973054256/',
  ],
  tabRotateDwell: 90, // seconds to stay on each rotated tab
  // ── Cookie tracking (v2.0) ──
  cookieTracking: true,
  // ── Telegram (v2.0) ──
  telegramEnabled: true,
  telegramBotToken: '',
  telegramMode:         'group',   // 'group' or 'private'
  telegramGroupChatId:  '',
  telegramTopicId:      '',
  telegramPrivateChatId: '',
};

// ─── In-memory session state ──────────────────────────────────────────────────

let state = {
  status:         'STOPPED',
  targetTabId:    null,
  startTime:      null,
  errorCount:     0,
  lastActionTime: null,
  hiddenSince:    null,
  activityLog:    [],
  // Cookie tracker state
  cookieBaseline: null,     // Map<name, {value,domain,path,expirationDate,httpOnly,secure}>
  cookieChanges:  [],       // [{time, type, name, domain, before, after}]
  // Tab rotation state
  rotationIndex:  0,
  rotatedTabIds:  [],       // tab IDs opened by rotation
  isRotating:     false,
  // Telegram log buffer
  telegramLogBuffer: [],
  telegramFlushTimer: null,
};

// ─── Utilities ────────────────────────────────────────────────────────────────

/** Format Date → DD/MM/YYYY - HH:MM:SS (UTC+7) */
function formatTime(d = new Date()) {
  const vn = new Date(d.getTime() + 7 * 3600000); // UTC+7
  const dd = String(vn.getUTCDate()).padStart(2, '0');
  const mm = String(vn.getUTCMonth() + 1).padStart(2, '0');
  const yy = vn.getUTCFullYear();
  const hh = String(vn.getUTCHours()).padStart(2, '0');
  const mi = String(vn.getUTCMinutes()).padStart(2, '0');
  const ss = String(vn.getUTCSeconds()).padStart(2, '0');
  return `${dd}/${mm}/${yy} - ${hh}:${mi}:${ss}`;
}

function log(msg, isDebug = false) {
  if (isDebug) return;
  console.log(`[FB-QA] ${new Date().toISOString()} ${msg}`);
}

function pushLog(msg) {
  state.activityLog.unshift({ time: new Date().toISOString(), msg });
  if (state.activityLog.length > LOG_MAX_ENTRIES) {
    state.activityLog = state.activityLog.slice(0, LOG_MAX_ENTRIES);
  }
}

/** Queue an action log for batched Telegram delivery */
function queueTelegramLog(msg) {
  state.telegramLogBuffer.push({ time: formatTime(), msg });
  // Start flush timer if not already running (30s batch window)
  if (!state.telegramFlushTimer) {
    state.telegramFlushTimer = setTimeout(flushTelegramLogs, 30000);
  }
  // Force flush if buffer gets large
  if (state.telegramLogBuffer.length >= 20) {
    flushTelegramLogs();
  }
}

/** Send all buffered logs as one Telegram message */
async function flushTelegramLogs() {
  if (state.telegramFlushTimer) {
    clearTimeout(state.telegramFlushTimer);
    state.telegramFlushTimer = null;
  }
  if (state.telegramLogBuffer.length === 0) return;

  const entries = state.telegramLogBuffer.splice(0);
  const lines = entries.map(e => `[${e.time}] ${e.msg}`);
  const text = `📋 Action Log (${entries.length} entries)\n\n${lines.join('\n')}`;
  await sendTelegram(text);
}

function getSettings() {
  return new Promise(resolve => chrome.storage.local.get(DEFAULT_SETTINGS, resolve));
}

async function persistEphemeralState() {
  await chrome.storage.local.set({
    _sw_status:    state.status,
    _sw_startTime: state.startTime,
  });
}

function getPublicState() {
  return {
    status:         state.status,
    startTime:      state.startTime,
    errorCount:     state.errorCount,
    activityLog:    [...state.activityLog],
    targetTabId:    state.targetTabId,
    lastActionTime: state.lastActionTime,
    cookieChanges:  state.cookieChanges.slice(0, 20),
  };
}

// ─── Telegram Reporter (v2.0) ─────────────────────────────────────────────────

async function sendTelegram(text) {
  const settings = await getSettings();
  if (!settings.telegramEnabled || !settings.telegramBotToken) return;

  // Determine chat_id based on mode
  const mode = settings.telegramMode || 'group';
  let chatId;
  if (mode === 'group') {
    chatId = settings.telegramGroupChatId;
  } else {
    chatId = settings.telegramPrivateChatId;
  }

  if (!chatId) {
    log(`Telegram skip: no chat_id for mode="${mode}"`);
    return;
  }

  const apiUrl = `https://api.telegram.org/bot${settings.telegramBotToken}/sendMessage`;
  try {
    // Escape HTML entities to prevent parse errors
    const safeText = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const body = {
      chat_id: chatId,
      text: `🔵 [FB-QA] ${safeText}`,
      parse_mode: 'HTML',
    };

    // Add topic thread_id only for group mode
    if (mode === 'group' && settings.telegramTopicId) {
      body.message_thread_id = parseInt(settings.telegramTopicId, 10);
    }

    const resp = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await resp.json();
    if (!data.ok) {
      log(`Telegram API error: ${data.description || JSON.stringify(data)}`);
      pushLog(`⚠️ Telegram error: ${data.description || 'unknown'}`);
    }
  } catch (err) {
    log(`Telegram send failed: ${err.message}`);
    pushLog(`⚠️ Telegram failed: ${err.message}`);
  }
}

async function sendTelegramCookieReport(changes) {
  if (!changes || changes.length === 0) return;
  const lines = changes.map(c => {
    const val = c.type === 'removed'
      ? `❌ REMOVED: ${c.name} (${c.domain})`
      : c.type === 'added'
        ? `✅ ADDED: ${c.name} (${c.domain})`
        : `🔄 CHANGED: ${c.name} (${c.domain})\n   before: ${truncVal(c.before)}\n   after:  ${truncVal(c.after)}`;
    return val;
  });
  const msg = `🍪 Cookie changes detected:\n\n${lines.join('\n\n')}\n\n⏰ ${formatTime()}`;
  await sendTelegram(msg);
}

function truncVal(v) {
  if (!v) return '(empty)';
  if (v.length <= 20) return v;
  return v.slice(0, 8) + '...' + v.slice(-8) + ` [${v.length}ch]`;
}

// ─── Cookie Tracker (v2.0) ────────────────────────────────────────────────────

async function getFbCookies() {
  try {
    const cookies = await chrome.cookies.getAll({ domain: '.facebook.com' });
    const map = new Map();
    for (const c of cookies) {
      const key = `${c.name}|${c.domain}|${c.path}`;
      map.set(key, {
        name:           c.name,
        value:          c.value,
        domain:         c.domain,
        path:           c.path,
        expirationDate: c.expirationDate || null,
        httpOnly:       c.httpOnly,
        secure:         c.secure,
        sameSite:       c.sameSite,
      });
    }
    return map;
  } catch (err) {
    log(`Cookie read error: ${err.message}`);
    return new Map();
  }
}

async function snapshotCookieBaseline() {
  state.cookieBaseline = await getFbCookies();
  state.cookieChanges = [];
  const count = state.cookieBaseline.size;
  log(`Cookie baseline captured: ${count} cookies`);
  pushLog(`🍪 Baseline: ${count} cookies`);
  await sendTelegram(`🍪 Cookie baseline captured: ${count} cookies for .facebook.com`);
}

async function checkCookieChanges() {
  if (!state.cookieBaseline || state.status === 'STOPPED') return;

  const settings = await getSettings();
  if (!settings.cookieTracking) return;

  const current = await getFbCookies();
  const changes = [];

  // Check for modified or removed cookies
  for (const [key, baseline] of state.cookieBaseline) {
    const now = current.get(key);
    if (!now) {
      changes.push({
        time: new Date().toISOString(),
        type: 'removed',
        name: baseline.name,
        domain: baseline.domain,
        before: baseline.value,
        after: null,
      });
    } else if (now.value !== baseline.value) {
      changes.push({
        time: new Date().toISOString(),
        type: 'changed',
        name: baseline.name,
        domain: baseline.domain,
        before: baseline.value,
        after: now.value,
      });
    }
  }

  // Check for new cookies
  for (const [key, now] of current) {
    if (!state.cookieBaseline.has(key)) {
      changes.push({
        time: new Date().toISOString(),
        type: 'added',
        name: now.name,
        domain: now.domain,
        before: null,
        after: now.value,
      });
    }
  }

  if (changes.length > 0) {
    state.cookieChanges.push(...changes);
    // Keep last 100 changes
    if (state.cookieChanges.length > 100) {
      state.cookieChanges = state.cookieChanges.slice(-100);
    }

    const summary = changes.map(c => `${c.type}:${c.name}`).join(', ');
    log(`Cookie diff: ${changes.length} changes — ${summary}`);
    pushLog(`🍪 ${changes.length} cookie change(s): ${summary.slice(0, 60)}`);

    // Send Telegram alert
    await sendTelegramCookieReport(changes);

    // Update baseline to current
    state.cookieBaseline = current;
  }
}

// ─── Content script messaging ─────────────────────────────────────────────────

async function sendToContent(msg, tabId = null) {
  const id = tabId ?? state.targetTabId;
  if (!id) return;

  try {
    await chrome.tabs.sendMessage(id, msg);
    state.errorCount = 0;
  } catch (err) {
    state.errorCount++;
    log(`Content-script send error (${state.errorCount}/${MAX_ERRORS}): ${err.message}`);
    if (state.errorCount >= MAX_ERRORS) {
      // Don't stop — try to recover by re-injecting
      log('Max errors reached — attempting recovery instead of stopping');
      state.errorCount = 0;
      await tryReinjectContentScript();
    }
  }
}

async function tryReinjectContentScript() {
  if (!state.targetTabId) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: state.targetTabId },
      files: ['utils/random.js', 'content.js'],
    });
    log('Content script re-injected successfully');
    pushLog('📋 Content script re-injected');
  } catch (err) {
    log(`Re-injection failed: ${err.message}`);
  }
}

// ─── Anti-discard ping ────────────────────────────────────────────────────────

async function antiDiscardPing() {
  if (state.status === 'STOPPED') return;

  // Ping main tab
  if (state.targetTabId) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: state.targetTabId },
        func: () => {
          window.dispatchEvent(new Event('focus'));
          window.dispatchEvent(new Event('mousemove'));
          if (typeof performance !== 'undefined') {
            performance.mark('fbqa-keepalive-' + Date.now());
          }
        },
      });
    } catch { /* tab may be gone */ }
  }

  // Ping all rotated tabs too
  for (const tabId of state.rotatedTabIds) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          window.dispatchEvent(new Event('focus'));
          window.dispatchEvent(new Event('mousemove'));
        },
      });
    } catch { /* tab may be gone — will be cleaned up */ }
  }

  log('Anti-discard ping sent to all managed tabs');
}

// ─── Multi-Tab Rotation (v2.0) ───────────────────────────────────────────────

async function rotateTab() {
  if (state.status === 'STOPPED' || state.isRotating) return;

  const settings = await getSettings();
  if (!settings.tabRotation || !settings.tabRotateUrls || settings.tabRotateUrls.length === 0) return;

  state.isRotating = true;

  try {
    // Pick next URL in rotation
    const urls = settings.tabRotateUrls;
    const url = urls[state.rotationIndex % urls.length];
    state.rotationIndex = (state.rotationIndex + 1) % urls.length;

    log(`Tab rotation → ${url}`);
    pushLog(`🔄 Rotating to: ${new URL(url).pathname}`);

    // Pause main tab scrolling
    await sendToContent({ type: 'PAUSE_SCROLLING' });

    // Create or reuse a rotation tab
    let rotTabId = null;
    // Clean up dead tabs from rotatedTabIds
    const alive = [];
    for (const tid of state.rotatedTabIds) {
      try { await chrome.tabs.get(tid); alive.push(tid); } catch { /* gone */ }
    }
    state.rotatedTabIds = alive;

    if (state.rotatedTabIds.length > 0) {
      // Reuse first rotation tab
      rotTabId = state.rotatedTabIds[0];
      try {
        await chrome.tabs.update(rotTabId, { url, active: false });
      } catch {
        // Tab gone — create new
        const tab = await chrome.tabs.create({ url, active: false });
        rotTabId = tab.id;
        state.rotatedTabIds = [rotTabId];
      }
    } else {
      // Create a new background tab
      const tab = await chrome.tabs.create({ url, active: false });
      rotTabId = tab.id;
      state.rotatedTabIds.push(rotTabId);
    }

    // Wait for tab to load, then inject and scroll
    await new Promise(r => setTimeout(r, 5000));

    try {
      await chrome.scripting.executeScript({
        target: { tabId: rotTabId },
        files: ['utils/random.js', 'content.js'],
      });

      const rotSettings = { ...settings, browseMode: false };
      await chrome.tabs.sendMessage(rotTabId, {
        type: 'START_SCROLLING',
        settings: rotSettings,
      });
    } catch (err) {
      log(`Rotation inject/start failed: ${err.message}`);
    }

    // Dwell on rotated tab
    const dwellMs = (settings.tabRotateDwell || 60) * 1000;
    await new Promise(r => setTimeout(r, dwellMs));

    // Stop scrolling on rotated tab
    try {
      await chrome.tabs.sendMessage(rotTabId, { type: 'STOP_SCROLLING' });
    } catch { /* ignore */ }

    // Resume main tab
    if (state.status !== 'STOPPED' && state.targetTabId) {
      const freshSettings = await getSettings();
      await sendToContent({ type: 'RESUME_SCROLLING', settings: freshSettings });
    }

    await sendTelegram(`🔄 Tab rotation complete: ${new URL(url).pathname}`);

  } catch (err) {
    log(`Tab rotation error: ${err.message}`);
  } finally {
    state.isRotating = false;
  }
}

// ─── State machine ────────────────────────────────────────────────────────────

async function startSession(tabId) {
  if (state.status !== 'STOPPED') {
    log(`startSession ignored — already ${state.status}`);
    return;
  }

  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    log('startSession: tab not found');
    return;
  }
  if (!tab.url || !new URL(tab.url).hostname.endsWith('facebook.com')) {
    log('startSession: tab is not facebook.com — blocked');
    return;
  }

  const settings = await getSettings();

  state.status      = 'ACTIVE';
  state.targetTabId = tabId;
  state.startTime   = Date.now();
  state.errorCount  = 0;
  state.activityLog = [];
  state.hiddenSince = null;
  state.rotationIndex = 0;
  state.cookieChanges = [];

  log(`Session STARTED on tab ${tabId} (${tab.url})`);
  pushLog('Session started');

  await sendToContent({ type: 'START_SCROLLING', settings });

  // Alarms
  await chrome.alarms.create('heartbeat',    { periodInMinutes: HEARTBEAT_PERIOD });
  await chrome.alarms.create('antiDiscard',   { periodInMinutes: ANTI_DISCARD_PERIOD });
  await chrome.alarms.create('cookieCheck',   { periodInMinutes: COOKIE_CHECK_PERIOD });
  await chrome.alarms.create('tabRotate',     { periodInMinutes: TAB_ROTATE_PERIOD });

  // Cookie baseline
  if (settings.cookieTracking) {
    await snapshotCookieBaseline();
  }

  // Telegram notification
  await sendTelegram(`▶️ Session STARTED\nTab: ${tab.url}\nTime: ${formatTime()}`);

  await persistEphemeralState();
}

async function stopSession(reason = 'user') {
  if (state.status === 'STOPPED') return;

  log(`Session STOPPED — reason: ${reason}`);
  pushLog(`Stopped (${reason})`);

  const prevTabId = state.targetTabId;

  state.status      = 'STOPPED';
  state.targetTabId = null;
  state.startTime   = null;
  state.hiddenSince = null;

  // Clear all alarms
  await chrome.alarms.clear('heartbeat');
  await chrome.alarms.clear('antiDiscard');
  await chrome.alarms.clear('cookieCheck');
  await chrome.alarms.clear('tabRotate');

  if (prevTabId) {
    try {
      await chrome.tabs.sendMessage(prevTabId, { type: 'STOP_SCROLLING' });
    } catch { /* tab may be gone */ }
  }

  // Close rotated tabs
  for (const tabId of state.rotatedTabIds) {
    try { await chrome.tabs.remove(tabId); } catch { /* ignore */ }
  }
  state.rotatedTabIds = [];

  // Telegram notification
  await sendTelegram(`⏹ Session STOPPED\nReason: ${reason}\nTime: ${formatTime()}`);

  await persistEphemeralState();
}

async function pauseSession(reason = 'tab_hidden') {
  if (state.status !== 'ACTIVE') return;

  state.status      = 'PAUSED';
  state.hiddenSince = Date.now();

  log(`Session PAUSED — reason: ${reason}`);
  pushLog(`Paused (${reason})`);

  await sendToContent({ type: 'PAUSE_SCROLLING' });
  await persistEphemeralState();
}

async function resumeSession() {
  if (state.status !== 'PAUSED') return;

  // v2.0: No hidden-tab threshold check — continuous running
  state.status      = 'ACTIVE';
  state.hiddenSince = null;

  log('Session RESUMED');
  pushLog('Resumed');

  const settings = await getSettings();
  await sendToContent({ type: 'RESUME_SCROLLING', settings });
  await persistEphemeralState();
}

// ─── Message handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    const settings = await getSettings();

    switch (msg.type) {

      // ── Popup → background ────────────────────────────────────────────
      case 'START':
        if (msg.tabId) await startSession(msg.tabId);
        sendResponse({ ok: true, state: getPublicState() });
        break;

      case 'STOP':
        await stopSession('user');
        sendResponse({ ok: true, state: getPublicState() });
        break;

      case 'GET_STATE':
        sendResponse({ state: getPublicState(), settings });
        break;

      case 'UPDATE_SETTINGS':
        await chrome.storage.local.set(msg.settings);
        if (state.status === 'ACTIVE') {
          const updated = await getSettings();
          await sendToContent({ type: 'UPDATE_SETTINGS', settings: updated });
        }
        sendResponse({ ok: true });
        break;

      // ── Content.js → background ───────────────────────────────────────

      case 'CONTENT_READY':
        if (
          state.status !== 'STOPPED' &&
          sender.tab &&
          sender.tab.id === state.targetTabId
        ) {
          setTimeout(async () => {
            const s = await getSettings();
            await sendToContent({ type: 'START_SCROLLING', settings: s });
            pushLog('Loop resumed after navigation');
            log(`CONTENT_READY: restarted scroll on tab ${state.targetTabId}`);
          }, 2000);
        }
        sendResponse({ ok: true });
        break;

      case 'LOG_ACTION':
        pushLog(msg.msg);
        queueTelegramLog(msg.msg);
        state.lastActionTime = Date.now();
        if (settings.debugMode) {
          console.log(`[FB-QA] ${new Date().toISOString()} [content] ${msg.msg}`);
        }
        sendResponse({ ok: true });
        break;

      case 'HEALTH_REPORT':
        if (!msg.healthy && settings.safeMode) {
          log(`Health check FAILED: ${msg.reason} — safe mode triggered`);
          await stopSession(`safe_mode:${msg.reason}`);
        }
        sendResponse({ ok: true });
        break;

      case 'KEEPALIVE':
        // Content.js is alive (e.g. resting) — update lastActionTime without logging
        state.lastActionTime = Date.now();
        sendResponse({ ok: true });
        break;

      case 'VISIBILITY_CHANGED':
        // v2.0: Log visibility but DON'T pause — continuous running
        if (msg.hidden) {
          log('Tab hidden — continuing (continuous mode)');
        } else {
          if (state.status === 'PAUSED') await resumeSession();
        }
        sendResponse({ ok: true });
        break;

      case 'PAGE_UNLOAD':
        log('PAGE_UNLOAD received — keeping session alive (internal navigation)');
        sendResponse({ ok: true });
        break;

      // ── Cookie/Telegram manual triggers ───────────────────────────────
      case 'FORCE_COOKIE_CHECK':
        await checkCookieChanges();
        sendResponse({ ok: true, state: getPublicState() });
        break;

      case 'FORCE_TAB_ROTATE':
        rotateTab(); // fire-and-forget
        sendResponse({ ok: true });
        break;

      case 'TELEGRAM_TEST': {
        const s = await getSettings();
        if (!s.telegramBotToken) {
          sendResponse({ ok: false, error: 'Bot token is empty' });
          break;
        }
        const mode = s.telegramMode || 'group';
        const chatId = mode === 'group' ? s.telegramGroupChatId : s.telegramPrivateChatId;
        if (!chatId) {
          sendResponse({ ok: false, error: `No chat_id for mode "${mode}"` });
          break;
        }
        try {
          const apiUrl = `https://api.telegram.org/bot${s.telegramBotToken}/sendMessage`;
          const body = {
            chat_id: chatId,
            text: `✅ [FB-QA] Test message — mode: ${mode}\n⏰ ${formatTime()}`,
          };
          if (mode === 'group' && s.telegramTopicId) {
            body.message_thread_id = parseInt(s.telegramTopicId, 10);
          }
          const resp = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          const data = await resp.json();
          if (data.ok) {
            pushLog(`📨 Telegram test OK (${mode})`);
            sendResponse({ ok: true });
          } else {
            pushLog(`⚠️ Telegram test FAIL: ${data.description}`);
            sendResponse({ ok: false, error: data.description || 'API error' });
          }
        } catch (err) {
          pushLog(`⚠️ Telegram test FAIL: ${err.message}`);
          sendResponse({ ok: false, error: err.message });
        }
        break;
      }

      default:
        sendResponse({ ok: false, error: `Unknown message type: ${msg.type}` });
    }
  })();

  return true;
});

// ─── Alarm handler ────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async alarm => {

  if (alarm.name === 'antiDiscard') {
    await antiDiscardPing();
    return;
  }

  if (alarm.name === 'cookieCheck') {
    await checkCookieChanges();
    return;
  }

  if (alarm.name === 'tabRotate') {
    await rotateTab();
    return;
  }

  if (alarm.name !== 'heartbeat') return;

  if (state.status === 'STOPPED') {
    await chrome.alarms.clear('heartbeat');
    return;
  }

  // Verify target tab still exists
  if (state.targetTabId !== null) {
    try {
      await chrome.tabs.get(state.targetTabId);
    } catch {
      log('Heartbeat: target tab no longer exists');
      await stopSession('tab_closed');
      return;
    }
  }

  log(`Heartbeat — status:${state.status} errors:${state.errorCount} cookies:${state.cookieChanges.length}`);

  // ── Watchdog: detect stale content.js and re-kick ──────────────────
  // If session is ACTIVE and no action logged for 3+ minutes, content loop likely died
  if (state.status === 'ACTIVE' && state.targetTabId && state.lastActionTime) {
    const silentMs = Date.now() - state.lastActionTime;
    const MAX_SILENT_MS = 3 * 60 * 1000; // 3 minutes
    if (silentMs > MAX_SILENT_MS) {
      log(`Watchdog: content silent for ${(silentMs / 60000).toFixed(1)} min — pinging`);
      pushLog('🔧 Watchdog: re-kicking action loop');
      try {
        // Try sending PING first to check if content.js is alive
        await chrome.tabs.sendMessage(state.targetTabId, { type: 'PING' });
      } catch {
        // Content script not responding — re-inject
        log('Watchdog: content not responding — re-injecting');
        pushLog('🔧 Watchdog: re-injecting content script');
        await tryReinjectContentScript();
      }
    }
  }
});

// ─── Tab lifecycle listeners ──────────────────────────────────────────────────

chrome.tabs.onRemoved.addListener(async tabId => {
  if (tabId === state.targetTabId) {
    log(`Target tab ${tabId} closed`);
    await stopSession('tab_closed');
  }
  // Clean up from rotated tabs
  state.rotatedTabIds = state.rotatedTabIds.filter(id => id !== tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (tabId !== state.targetTabId) return;
  if (!changeInfo.url) return;

  let host = '';
  try { host = new URL(changeInfo.url).hostname; } catch { /* ignore */ }

  if (host && !host.endsWith('facebook.com')) {
    log(`Target tab navigated off facebook.com → ${changeInfo.url}`);
    await stopSession('navigated_away');
  }
});

// ─── SW init ─────────────────────────────────────────────────────────────────

log('Background service worker v2.0.0 initialized (MV3)');
