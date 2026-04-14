/**
 * [FB-QA] content.js — Action Engine v2.0.0
 *
 * v2.0 major changes:
 *  - Visited-post tracking: never revisit the same post/profile URL twice
 *  - /friends/ page: click random friend profiles to view them
 *  - /reel/ page: click next-reel button to scroll through reels
 *  - Rest periods: random 5–20 min idle breaks between browse sessions
 *  - Much larger post pool: aggressive scroll-to-discover before picking
 *  - Randomized post order: Fisher-Yates shuffle on candidates
 *  - Page-aware actions: different behavior per FB section
 */

(function () {
  'use strict';

  // ─── Guard: prevent double-injection ────────────────────────────────────
  if (window.__FBQA_INJECTED__) {
    console.log('[FB-QA] content.js already active on this page');
    return;
  }
  window.__FBQA_INJECTED__ = true;

  // ─── Module state ────────────────────────────────────────────────────────
  let settings    = null;
  let active      = false;
  let paused      = false;
  let actionTimer = null;
  let actionCount = 0;

  // v2.0: visited tracking & rest periods (persisted via sessionStorage)
  const visitedUrls = new Set(
    JSON.parse(sessionStorage.getItem('__fbqa_visited__') || '[]')
  );
  let restUntil = parseInt(sessionStorage.getItem('__fbqa_restUntil__') || '0', 10);
  let actionsUntilRest = parseInt(sessionStorage.getItem('__fbqa_actionsLeft__') || '0', 10);

  function persistState() {
    try {
      sessionStorage.setItem('__fbqa_visited__', JSON.stringify([...visitedUrls]));
      sessionStorage.setItem('__fbqa_restUntil__', String(restUntil));
      sessionStorage.setItem('__fbqa_actionsLeft__', String(actionsUntilRest));
    } catch { /* quota exceeded — ignore */ }
  }

  function resetRestCounter() {
    // Random 15–50 actions before next rest
    actionsUntilRest = FBQARandom.randomInt(15, 50);
    persistState();
  }

  // ─── Constants ───────────────────────────────────────────────────────────
  const MIN_INTERVAL_MS = 5000;

  const UNSAFE_PATTERNS = [
    '/checkpoint/', '/login/', '/two_factor',
    '/recover', '/disabled', '/security',
  ];

  // ─── Logging ─────────────────────────────────────────────────────────────

  function log(msg, isDebug = false) {
    if (isDebug && !(settings && settings.debugMode)) return;
    console.log(`[FB-QA] ${new Date().toISOString()} ${msg}`);
  }

  function sendLog(msg) {
    const path = window.location.pathname;
    let pageType = '?';
    try { pageType = BrowseActions.getPageType(); } catch {}
    const full = `[${pageType}] ${path} — ${msg}`;
    try { chrome.runtime.sendMessage({ type: 'LOG_ACTION', msg: full }); }
    catch { /* extension context invalidated */ }
  }

  /** Extract post/reel ID from a URL */
  function extractId(url) {
    try {
      const u = new URL(url);
      const m = u.pathname.match(/\/posts\/(\d+)/) ||
                u.pathname.match(/\/reel\/(\d+)/) ||
                u.pathname.match(/\/videos\/(\d+)/) ||
                u.pathname.match(/\/permalink\/(\d+)/) ||
                u.pathname.match(/\/photo[^/]*\/.*?(\d{10,})/);
      if (m) return m[1];
      const fbid = u.searchParams.get('story_fbid') || u.searchParams.get('fbid');
      if (fbid) return fbid;
    } catch {}
    return null;
  }

  // ─── Utility: shuffle array (Fisher-Yates) ──────────────────────────────
  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = FBQARandom.randomInt(0, i);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ─── DOM finder helpers (v2.0 — robust multi-strategy) ────────────────────

  /**
   * Find feed posts in the DOM using multiple fallback strategies.
   * Facebook obfuscates class names frequently, so we try several approaches.
   */
  function findFeedPosts() {
    // Strategy 1: role="feed" → find individual post-level divs
    const feed = document.querySelector('div[role="feed"]');
    if (feed) {
      // Direct children of feed may be wrappers; dig into them
      // Look for substantial blocks at depth 1-3 that are post-sized
      let posts = [];
      // First try direct children that look like individual posts
      const directKids = Array.from(feed.children).filter(el => {
        const h = el.offsetHeight;
        return h > 150 && h < 3000;
      });
      if (directKids.length > 1) {
        posts = directKids;
      } else {
        // Feed has 1 wrapper child — go one level deeper
        for (const wrapper of feed.children) {
          const deeper = Array.from(wrapper.children).filter(el => {
            const h = el.offsetHeight;
            return h > 150 && h < 3000;
          });
          if (deeper.length > 0) { posts = deeper; break; }
        }
        // Still nothing? Try 2 levels deep
        if (posts.length === 0) {
          for (const w1 of feed.children) {
            for (const w2 of w1.children) {
              const deeper = Array.from(w2.children).filter(el => {
                const h = el.offsetHeight;
                return h > 150 && h < 3000;
              });
              if (deeper.length > 1) { posts = deeper; break; }
            }
            if (posts.length > 0) break;
          }
        }
      }
      if (posts.length > 0) return posts;
    }

    // Strategy 2: legacy selectors (still work on some layouts)
    const legacy = document.querySelectorAll(
      '[data-pagelet^="FeedUnit"], article[role="article"]'
    );
    if (legacy.length > 0) return Array.from(legacy);

    // Strategy 3: main content area → find large blocks that look like posts
    const main = document.querySelector('div[role="main"]');
    if (main) {
      const candidates = Array.from(main.querySelectorAll('div')).filter(el => {
        const r = el.getBoundingClientRect();
        // Post-sized blocks: tall enough, wide enough, not the entire page
        return r.height > 200 && r.height < 2000 && r.width > 400
            && r.top < window.innerHeight * 3 && r.bottom > -500;
      });
      // Deduplicate: remove elements that are ancestors of other candidates
      const filtered = candidates.filter(el =>
        !candidates.some(other => other !== el && el.contains(other))
      );
      if (filtered.length > 0) return filtered;
    }

    // Strategy 4: find divs containing post-like links (timestamps, permalinks)
    const postAnchors = document.querySelectorAll(
      'a[href*="/posts/"], a[href*="story_fbid="], a[href*="/permalink/"], a[href*="/reel/"], a[href*="/watch"]'
    );
    if (postAnchors.length > 0) {
      const posts = new Set();
      postAnchors.forEach(a => {
        let el = a;
        for (let i = 0; i < 12 && el.parentElement; i++) {
          el = el.parentElement;
          const h = el.offsetHeight;
          if (h > 200 && h < 2000 && el.offsetWidth > 400) { posts.add(el); break; }
        }
      });
      if (posts.size > 0) return Array.from(posts);
    }

    return [];
  }

  /**
   * Find the stories/reels carousel container.
   */
  function findStoriesContainer() {
    // Strategy 1: aria-label / data-pagelet based
    let c = document.querySelector('[aria-label="Stories"]')
         || document.querySelector('[data-pagelet="Stories"]')
         || document.querySelector('[data-pagelet*="story" i]');
    if (c) return c;

    // Strategy 2: find a horizontally scrollable container near the top of the page
    const main = document.querySelector('div[role="main"]');
    const searchRoot = main || document.body;
    const allDivs = searchRoot.querySelectorAll('div');
    for (const el of allDivs) {
      if (el.scrollWidth > el.clientWidth + 100) {
        const r = el.getBoundingClientRect();
        // Stories carousel is typically near the top and not too tall
        if (r.top >= -50 && r.top < 500 && r.height > 80 && r.height < 400 && r.width > 300) {
          return el;
        }
      }
    }

    // Strategy 3: generic horizontally-scrollable list
    const lists = Array.from(document.querySelectorAll('[role="list"]'))
      .find(el => el.scrollWidth > el.clientWidth + 50);
    if (lists) return lists;

    return null;
  }

  /**
   * Find clickable post permalink links in the viewport.
   */
  function findPostLinks() {
    const selectors = [
      'a[href*="/posts/"]',
      'a[href*="story_fbid="]',
      'a[href*="/permalink/"]',
      'a[href*="?story_fbid="]',
      'a[href*="/reel/"]',
      'a[href*="/videos/"]',
      'a[href*="/photo"]',
    ].join(', ');

    const vh = window.innerHeight;
    return Array.from(document.querySelectorAll(selectors)).filter(el => {
      const r = el.getBoundingClientRect();
      // Link just needs to be partially visible in viewport
      return r.bottom > 60 && r.top < (vh - 40) && r.width > 3 && el.href;
    });
  }

  // ─── Enhanced debug snapshot ─────────────────────────────────────────────
  /**
   * Emits a rich debug line to console showing current page state.
   * Only fires when debugMode is ON.
   */
  function debugSnapshot(actionType, nextMs) {
    if (!(settings && settings.debugMode)) return;

    const scrollPct = document.documentElement.scrollHeight > window.innerHeight
      ? Math.round((window.scrollY / (document.documentElement.scrollHeight - window.innerHeight)) * 100)
      : 0;

    const visiblePosts = findFeedPosts().length;

    console.log(
      `[FB-QA] ── debug snapshot ──────────────────────\n` +
      `  action     : ${actionType}\n` +
      `  scrollY    : ${Math.round(window.scrollY)}px  (depth ${scrollPct}%)\n` +
      `  viewport   : ${window.innerWidth}×${window.innerHeight}px\n` +
      `  page ready : ${document.readyState}\n` +
      `  url        : ${window.location.pathname}\n` +
      `  feed posts : ${visiblePosts} in DOM\n` +
      `  action #   : ${actionCount}\n` +
      `  next in    : ${(nextMs / 1000).toFixed(1)}s\n` +
      `────────────────────────────────────────────────`
    );
  }

  // ─── Page health ─────────────────────────────────────────────────────────

  function checkPageHealth() {
    if (document.readyState === 'loading') {
      log('Page loading — deferring', true);
      return false;
    }

    const url = window.location.href;
    const unsafe = UNSAFE_PATTERNS.some(p => url.includes(p));
    if (unsafe) {
      log(`Unsafe URL: ${url}`);
      try {
        chrome.runtime.sendMessage({ type: 'HEALTH_REPORT', healthy: false, reason: 'unsafe_url', url });
      } catch { /* ignore */ }
      return false;
    }
    return true;
  }

  // ─── Browse Actions module (v2.0) ─────────────────────────────────────────

  const BrowseActions = (() => {

    /**
     * Detect current page type for context-aware actions
     */
    function getPageType() {
      const path = window.location.pathname;
      if (path.startsWith('/reel'))    return 'reel';
      if (path.startsWith('/friends')) return 'friends';
      if (path.startsWith('/watch'))   return 'watch';
      if (path.startsWith('/groups/')) return 'group';
      if (path.startsWith('/me') || path.startsWith('/profile.php')) return 'profile';
      return 'feed'; // default: news feed
    }

    /**
     * STORY_SCROLL
     */
    function storyScroll() {
      const container = findStoriesContainer();

      if (!container) {
        log('BrowseAction[story]: no stories container — skipping', true);
        return false;
      }

      const dir = FBQARandom.chance(0.65) ? 1 : -1;
      const px  = FBQARandom.randomInt(120, 300) * dir;
      container.scrollBy({ left: px, behavior: 'smooth' });

      window.dispatchEvent(new Event('focus'));
      sendLog(`Stories ${px > 0 ? '→' : '←'}${Math.abs(px)}px | scrollY=${Math.round(window.scrollY)}`);
      log(`BrowseAction[story]: scrolled ${px > 0 ? 'right' : 'left'} ${Math.abs(px)}px`, true);
      return true;
    }

    /**
     * POST_HOVER — mouse-move simulation over a random visible post
     */
    function postHover() {
      const vh = window.innerHeight;
      const visible = findFeedPosts().filter(el => {
        const r = el.getBoundingClientRect();
        const overlapTop = Math.max(r.top, 60);
        const overlapBot = Math.min(r.bottom, vh - 40);
        const overlap = overlapBot - overlapTop;
        return overlap > 80 && r.height > 80;
      });

      if (visible.length === 0) {
        log('BrowseAction[hover]: no posts in viewport — skipping', true);
        return false;
      }

      // Shuffle and pick — don't always hover the same post
      const post = FBQARandom.pick(shuffle(visible));
      const rect = post.getBoundingClientRect();

      const baseX = rect.left + FBQARandom.randomFloat(0.2, 0.75) * rect.width;
      const baseY = rect.top  + FBQARandom.randomFloat(0.2, 0.6)  * rect.height;

      const STEPS = 5;
      for (let i = 0; i < STEPS; i++) {
        const delay = i * FBQARandom.randomInt(100, 280);
        setTimeout(() => {
          const jx = baseX + FBQARandom.randomFloat(-10, 10);
          const jy = baseY + FBQARandom.randomFloat(-6, 6);
          post.dispatchEvent(new MouseEvent(i === 0 ? 'mouseenter' : 'mousemove', {
            bubbles: true, cancelable: true,
            clientX: Math.round(jx),
            clientY: Math.round(jy),
          }));
        }, delay);
      }

      window.dispatchEvent(new Event('focus'));
      const hoverLinks = findPostLinks().filter(a => {
        const r = a.getBoundingClientRect();
        return Math.abs(r.top - rect.top) < 300;
      });
      const hoverId = hoverLinks.length > 0 ? extractId(hoverLinks[0].href) : null;
      sendLog(`Post hover${hoverId ? ' id:' + hoverId : ''} — ${visible.length} post(s) in view`);
      return true;
    }

    /**
     * PROFILE_VISIT — navigate to /me, auto-return after dwell
     */
    function profileVisit() {
      if (
        window.location.pathname.startsWith('/me') ||
        window.location.pathname.startsWith('/profile.php') ||
        sessionStorage.getItem('__fbqa_return__')
      ) {
        log('BrowseAction[profile]: already on profile or in return flow — skipping', true);
        return false;
      }

      const returnTo = window.location.href;
      sessionStorage.setItem('__fbqa_return__', returnTo);
      sessionStorage.setItem('__fbqa_dwell__',  String(FBQARandom.randomInt(5000, 12000)));

      sendLog(`Browse → /me (profile visit) | return=${returnTo.replace('https://www.facebook.com','')}`);
      window.location.href = '/me';
      return true;
    }

    /**
     * POST_CLICK (v2.0 — improved)
     * - Shuffles candidates so selection isn't positional
     * - Tracks visitedUrls to avoid revisiting same posts
     * - If all visible posts visited, scrolls down to discover new ones
     */
    function postClick() {
      if (sessionStorage.getItem('__fbqa_return__')) {
        return false;
      }

      let candidateLinks = findPostLinks();

      // Filter out already-visited URLs
      candidateLinks = candidateLinks.filter(el => {
        try {
          const url = new URL(el.href);
          return !visitedUrls.has(url.pathname);
        } catch { return true; }
      });

      if (candidateLinks.length === 0) {
        log('BrowseAction[postClick]: all visible posts already visited — scrolling to discover', true);
        // Scroll down aggressively to find new content
        window.scrollBy({ top: FBQARandom.randomInt(600, 1200), behavior: 'smooth' });
        sendLog('Scroll ↓ to discover new posts');
        return false; // will retry next tick
      }

      // Shuffle to randomize selection
      const shuffled = shuffle(candidateLinks);
      const link = shuffled[0];

      // Guard: only facebook.com links
      try {
        const linkHost = new URL(link.href).hostname;
        if (!linkHost.endsWith('facebook.com')) return false;
      } catch { return false; }

      // Track as visited
      try { visitedUrls.add(new URL(link.href).pathname); persistState(); } catch {}

      const returnTo = window.location.href;
      sessionStorage.setItem('__fbqa_return__', returnTo);
      sessionStorage.setItem('__fbqa_dwell__',  String(FBQARandom.randomInt(6000, 15000)));

      const postId = extractId(link.href);
      const postPath = new URL(link.href).pathname;
      sendLog(`Browse → post ${postPath}${postId ? ' id:' + postId : ''} | ${candidateLinks.length} unvisited | visited total: ${visitedUrls.size}`);
      log(`BrowseAction[postClick]: navigating to ${postPath}, ${visitedUrls.size} total visited`, true);

      window.location.href = link.href;
      return true;
    }

    /**
     * FRIENDS_BROWSE (v2.0 — new)
     * On /friends/ page: click on random friend profile links to view them.
     * Does NOT click "Add Friend" or any action buttons.
     * Only clicks links that go to profiles (href containing facebook.com/profilename).
     */
    function friendsBrowse() {
      const pageType = getPageType();
      if (pageType !== 'friends') {
        log('BrowseAction[friends]: not on /friends/ — skipping', true);
        return false;
      }

      if (sessionStorage.getItem('__fbqa_return__')) return false;

      // Find profile links on the friends page
      // These are typically <a> tags inside friend cards linking to /username or /profile.php?id=
      const allLinks = Array.from(document.querySelectorAll('a[href]'));
      const profileLinks = allLinks.filter(a => {
        const href = a.href;
        if (!href) return false;
        try {
          const url = new URL(href);
          if (!url.hostname.endsWith('facebook.com')) return false;
          const path = url.pathname;
          // Skip non-profile paths
          if (path === '/' || path === '/friends' || path === '/friends/' ||
              path.startsWith('/friends/') ||
              path.startsWith('/groups/') ||
              path.startsWith('/pages/') ||
              path.startsWith('/settings/') ||
              path.startsWith('/notifications') ||
              path.startsWith('/messages') ||
              path.startsWith('/marketplace') ||
              path.startsWith('/watch') ||
              path.startsWith('/gaming') ||
              path.startsWith('/bookmarks') ||
              path.startsWith('/events') ||
              path.startsWith('/reel') ||
              path === '/me' || path === '/me/') return false;
          // Must be a short path (username) or profile.php
          if (path.startsWith('/profile.php')) return true;
          // Single-segment path like /username
          const segments = path.split('/').filter(Boolean);
          if (segments.length === 1 && segments[0].length > 1) return true;
          return false;
        } catch { return false; }
      });

      // Filter out visited
      const unvisited = profileLinks.filter(a => {
        try { return !visitedUrls.has(new URL(a.href).pathname); } catch { return true; }
      });

      if (unvisited.length === 0) {
        log('BrowseAction[friends]: no unvisited profiles — scrolling', true);
        window.scrollBy({ top: FBQARandom.randomInt(400, 800), behavior: 'smooth' });
        sendLog('Scroll ↓ on friends to discover more');
        return false;
      }

      // Pick a random one from visible area
      const vh = window.innerHeight;
      let visibleLinks = unvisited.filter(a => {
        const r = a.getBoundingClientRect();
        return r.top > 50 && r.bottom < vh - 30;
      });
      if (visibleLinks.length === 0) visibleLinks = unvisited;

      const link = FBQARandom.pick(shuffle(visibleLinks));
      try { visitedUrls.add(new URL(link.href).pathname); persistState(); } catch {}

      const returnTo = window.location.href;
      sessionStorage.setItem('__fbqa_return__', returnTo);
      sessionStorage.setItem('__fbqa_dwell__',  String(FBQARandom.randomInt(5000, 15000)));

      const profileName = new URL(link.href).pathname;
      sendLog(`Friends → profile ${profileName} | ${unvisited.length} unvisited | visited total: ${visitedUrls.size}`);
      log(`BrowseAction[friends]: visiting profile ${profileName}`, true);

      window.location.href = link.href;
      return true;
    }

    /**
     * REEL_SCROLL (v2.0 — new)
     * On /reel/ page: click the "next reel" button to scroll through reels.
     * Falls back to multiple selector strategies.
     */
    function reelScroll() {
      const pageType = getPageType();
      if (pageType !== 'reel' && pageType !== 'watch') {
        log('BrowseAction[reel]: not on /reel/ or /watch — skipping', true);
        return false;
      }

      // Strategy 1: user-provided selector for the next-reel SVG button
      let nextBtn = document.querySelector(
        '#mount_0_0_bV > div > div:nth-child(1) > div > div.x9f619.x1n2onr6.x1ja2u2z > div > div > div.x78zum5.xdt5ytf.x1t2pt76.x1n2onr6.x1ja2u2z.x10cihs4 > div.x1ey2m1c.x78zum5.xtijo5x.x1o0tod.x10l6tqk.x13vifvy > div > div > div > div > div > div > div > div > div.x78zum5.xdt5ytf.x9q68il.x10l6tqk.xwa60dl.x1cb1t30 > div:nth-child(2) > div > svg'
      );

      // Strategy 2: look for an SVG inside a clickable container after the reel content
      if (!nextBtn) {
        // Find arrow-down/next buttons near reels
        const svgs = Array.from(document.querySelectorAll('svg'));
        for (const svg of svgs) {
          const parent = svg.closest('div[role="button"], div[tabindex="0"]');
          if (parent) {
            const r = parent.getBoundingClientRect();
            // Next button is typically on the right side or bottom
            if (r.width > 20 && r.width < 80 && r.height > 20 && r.height < 80) {
              // Check if it's within the reel area
              if (r.right > window.innerWidth * 0.5 || r.bottom > window.innerHeight * 0.5) {
                nextBtn = parent;
                break;
              }
            }
          }
        }
      }

      // Strategy 3: keyboard arrow down to navigate reels
      if (!nextBtn) {
        log('BrowseAction[reel]: no next button found — using keyboard ArrowDown', true);
        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, bubbles: true
        }));
        sendLog(`Reel → ArrowDown | ${window.location.pathname}`);
        return true;
      }

      // Click the next reel button
      const clickTarget = nextBtn.closest('div[role="button"]') || nextBtn.parentElement || nextBtn;
      clickTarget.click();

      sendLog(`Reel → next | ${window.location.pathname}`);
      log('BrowseAction[reel]: clicked next reel button', true);
      return true;
    }

    return { storyScroll, postHover, profileVisit, postClick, friendsBrowse, reelScroll, getPageType };
  })();

  // ─── Auto-return from browse visit ───────────────────────────────────────
  /**
   * Called at the start of each action cycle.
   * If sessionStorage has a return URL, navigate back after a dwell.
   * Returns true if a return is scheduled (skip normal action this tick).
   */
  function handleAutoReturn() {
    const returnTo = sessionStorage.getItem('__fbqa_return__');
    if (!returnTo) return false;

    const dwellMs = parseInt(sessionStorage.getItem('__fbqa_dwell__') || '6000', 10);
    sessionStorage.removeItem('__fbqa_return__');
    sessionStorage.removeItem('__fbqa_dwell__');

    sendLog(`Browse dwell ${(dwellMs / 1000).toFixed(0)}s — returning to ${returnTo.replace('https://www.facebook.com','')}`);
    log(`Auto-return in ${(dwellMs / 1000).toFixed(1)}s`, true);

    actionTimer = setTimeout(() => {
      window.location.href = returnTo;
    }, dwellMs);

    return true; // signal: skip normal action
  }

  // ─── Scroll action ────────────────────────────────────────────────────────

  function executeScroll() {
    const goDown = FBQARandom.chance(0.8);
    let delta;

    if (goDown) {
      const rawDelta = FBQARandom.randomInt(
        settings.scrollMin,
        Math.min(settings.scrollMax, 600)
      );
      delta = settings.jitter
        ? Math.round(FBQARandom.jitter(rawDelta, 0.2))
        : rawDelta;
      delta = Math.max(1, delta);
    } else {
      delta = -FBQARandom.randomInt(30, 80);
    }

    window.scrollBy({ top: delta, behavior: 'smooth' });
    window.dispatchEvent(new Event('focus'));

    const dir = delta > 0 ? `↓${delta}px` : `↑${Math.abs(delta)}px`;
    const docH = document.documentElement.scrollHeight;
    const scrollPct = docH > window.innerHeight ? Math.round((window.scrollY / (docH - window.innerHeight)) * 100) : 0;
    sendLog(`Scroll ${dir} @ ${Math.round(window.scrollY)}px (${scrollPct}%)`);
    log(`scroll ${dir}  pos=${Math.round(window.scrollY)}px`, true);

    return 'scroll';
  }

  // ─── Main action dispatcher (v2.0) ───────────────────────────────────────
  /**
   * Called on each tick. Page-aware: different behavior for /friends/, /reel/, feed.
   * Includes rest period logic: after 15–50 actions, takes a 5–20 min break.
   */
  function executeAction() {
    if (!active || paused) return;

    if (document.readyState !== 'complete' && document.readyState !== 'interactive') {
      log('DOM not ready — retrying in 2s', true);
      actionTimer = setTimeout(executeAction, 2000);
      return;
    }

    if (!checkPageHealth()) return;

    // ── Rest period check ─────────────────────────────────────────────────
    if (Date.now() < restUntil) {
      const remainMin = ((restUntil - Date.now()) / 60000).toFixed(1);
      log(`Resting — ${remainMin} min remaining`, true);
      // Schedule next check in 30–60 seconds
      actionTimer = setTimeout(executeAction, FBQARandom.randomInt(30000, 60000));
      return;
    }
    // If we just finished resting, log it
    if (restUntil > 0) {
      sendLog(`⏰ Rest done — resuming actions | visited: ${visitedUrls.size} URLs`);
      restUntil = 0;
      persistState();
    }

    // Check if we're in a post-browse-visit return flow
    if (handleAutoReturn()) {
      scheduleNext('auto_return');
      return;
    }

    actionCount++;

    // ── Rest period trigger ─────────────────────────────────────────────
    if (actionsUntilRest <= 0) {
      const restMinutes = FBQARandom.randomInt(5, 20);
      restUntil = Date.now() + restMinutes * 60 * 1000;
      resetRestCounter();
      persistState();
      sendLog(`😴 Resting for ${restMinutes} min (${actionCount} actions done) | visited: ${visitedUrls.size} URLs`);
      log(`Rest period: ${restMinutes} min. Next batch after ${actionsUntilRest} actions.`);
      actionTimer = setTimeout(executeAction, FBQARandom.randomInt(30000, 60000));
      return;
    }
    actionsUntilRest--;

    let actionType = 'scroll';
    const pageType = BrowseActions.getPageType();

    // ── Page-specific browse actions ──────────────────────────────────────
    if (settings.browseMode) {

      // /friends/ page: primarily click profiles
      if (pageType === 'friends') {
        if (FBQARandom.chance(0.4)) {
          if (BrowseActions.friendsBrowse()) return; // navigates away
        }
        // Otherwise just scroll the friends page
        actionType = executeScroll();
        scheduleNext(actionType);
        return;
      }

      // /reel/ page: click next reel
      if (pageType === 'reel' || pageType === 'watch') {
        if (FBQARandom.chance(0.7)) {
          if (BrowseActions.reelScroll()) {
            scheduleNext('reel');
            return;
          }
        }
        actionType = executeScroll();
        scheduleNext(actionType);
        return;
      }

      // Feed / group pages: full browse action pool
      const browseFreq = settings.browseFreq || 0.15;
      if (FBQARandom.chance(browseFreq)) {
        const pool = [];
        if (settings.browseStory)   pool.push('story');
        if (settings.browseHover)   pool.push('hover');
        if (settings.browseProfile) pool.push('profile');
        if (settings.browsePost)    pool.push('postClick');

        if (pool.length > 0) {
          const chosen = FBQARandom.pick(shuffle(pool));
          let success = false;

          if (chosen === 'story')     success = BrowseActions.storyScroll();
          if (chosen === 'hover')     success = BrowseActions.postHover();
          if (chosen === 'profile')   success = BrowseActions.profileVisit();
          if (chosen === 'postClick') success = BrowseActions.postClick();

          if (success) {
            actionType = chosen;
            if (chosen === 'profile' || chosen === 'postClick') return;
            scheduleNext(actionType);
            return;
          }
        }
      }
    }

    // ── Default: scroll (with occasional big scroll to discover new content) ──
    if (FBQARandom.chance(0.15)) {
      // Big scroll to discover fresh content
      const bigDelta = FBQARandom.randomInt(500, 1000);
      window.scrollBy({ top: bigDelta, behavior: 'smooth' });
      sendLog(`Scroll ↓${bigDelta}px (discover) @ ${Math.round(window.scrollY)}px`);
      actionType = 'discover_scroll';
    } else {
      actionType = executeScroll();
    }
    scheduleNext(actionType);
  }

  // ─── Scheduler ───────────────────────────────────────────────────────────

  function scheduleNext(lastAction = 'scroll') {
    if (!active || paused) return;

    let intervalMs = FBQARandom.randomInt(
      settings.intervalMin * 1000,
      settings.intervalMax * 1000
    );
    if (settings.jitter) {
      intervalMs = Math.round(FBQARandom.jitter(intervalMs, 0.2));
    }
    intervalMs = Math.max(MIN_INTERVAL_MS, intervalMs);

    debugSnapshot(lastAction, intervalMs);

    actionTimer = setTimeout(executeAction, intervalMs);
  }

  function clearActionTimer() {
    if (actionTimer !== null) {
      clearTimeout(actionTimer);
      actionTimer = null;
    }
  }

  // ─── Page Visibility API ─────────────────────────────────────────────────

  document.addEventListener('visibilitychange', () => {
    log(`Visibility → hidden=${document.hidden}`, true);
    try {
      chrome.runtime.sendMessage({ type: 'VISIBILITY_CHANGED', hidden: document.hidden });
    } catch { /* ignore */ }
  });

  // ─── Page unload ─────────────────────────────────────────────────────────
  /**
   * beforeunload fires for both browse-mode navigations and real page unloads.
   * We still notify background (for logging) but background no longer stops
   * the session on PAGE_UNLOAD — it relies on tabs.onRemoved / onUpdated instead.
   */
  window.addEventListener('beforeunload', () => {
    active = false;
    paused = false;
    clearActionTimer();
    window.__FBQA_INJECTED__ = false;
    try { chrome.runtime.sendMessage({ type: 'PAGE_UNLOAD' }); }
    catch { /* already unloading */ }
  });

  // ─── Message handler ─────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg.type) {

      case 'START_SCROLLING':
        settings    = msg.settings;
        active      = true;
        paused      = false;
        actionCount = 0;
        // Only reset rest counter if not already in a rest period or mid-session
        if (actionsUntilRest <= 0) resetRestCounter();
        // Preserve restUntil from sessionStorage (don't reset to 0)
        clearActionTimer();
        log('Action loop STARTED');
        // Warm-up delay: 1.5–4s
        actionTimer = setTimeout(executeAction, FBQARandom.randomInt(1500, 4000));
        sendResponse({ ok: true });
        break;

      case 'STOP_SCROLLING':
        active  = false;
        paused  = false;
        clearActionTimer();
        window.__FBQA_INJECTED__ = false;
        log('Action loop STOPPED');
        sendResponse({ ok: true });
        break;

      case 'PAUSE_SCROLLING':
        paused = true;
        clearActionTimer();
        log('Action loop PAUSED');
        sendResponse({ ok: true });
        break;

      case 'RESUME_SCROLLING':
        if (msg.settings) settings = msg.settings;
        paused = false;
        if (active) {
          log('Action loop RESUMED');
          scheduleNext('resume');
        }
        sendResponse({ ok: true });
        break;

      case 'UPDATE_SETTINGS':
        settings = msg.settings;
        log('Settings updated', true);
        sendResponse({ ok: true });
        break;

      default:
        sendResponse({ ok: false, error: `Unknown type: ${msg.type}` });
    }

    return true;
  });

  // ─── Init: signal background that content is ready ───────────────────────
  /**
   * Sent on every injection (initial load + post-browse-navigation reload).
   * background.js CONTENT_READY handler will re-send START_SCROLLING if the
   * session is active — this is the key to seamless post-navigation resume.
   */
  try {
    chrome.runtime.sendMessage({ type: 'CONTENT_READY' });
  } catch { /* extension context not yet available */ }

  log(`Content script v2.0.0 initialised on ${window.location.hostname}${window.location.pathname}`);
})();
