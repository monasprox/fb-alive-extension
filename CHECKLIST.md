# FB QA Keep-Alive — Test Checklist

Version: 1.0.0  
Last updated: 2026-04-14

---

## How to use this checklist

Load the extension in Developer Mode, open DevTools (F12), and filter console by `[FB-QA]`. Run each test case and mark Pass / Fail / N/A.

---

## 1. Install & load

| # | Test | Expected | Result |
|---|------|----------|--------|
| 1.1 | Load unpacked from `chrome://extensions` | Extension appears in toolbar, no manifest errors | |
| 1.2 | Check permissions in extension details | Only: activeTab, scripting, storage, tabs, alarms, *.facebook.com | |
| 1.3 | Open popup on a non-Facebook tab | Warning card visible; power button disabled/faded | |
| 1.4 | Open popup on `www.facebook.com` tab | Status card fully visible; power button enabled; domain pill shows green dot | |

---

## 2. Start / Stop

| # | Test | Expected | Result |
|---|------|----------|--------|
| 2.1 | Press power button on facebook.com tab | Badge → `ACTIVE`; button glows; uptime counter starts | |
| 2.2 | Wait 5–50s after start | Scroll action fires; activity log updates; console shows `[FB-QA]` scroll entry | |
| 2.3 | Press power button again (running) | Badge → `STOPPED`; button glow off; uptime resets to 00:00:00 | |
| 2.4 | Reopen popup after stop | Settings preserved; state shows STOPPED | |
| 2.5 | Close and reopen popup while ACTIVE | Badge still shows ACTIVE; uptime continues counting | |

---

## 3. Auto-stop triggers

| # | Test | Expected | Result |
|---|------|----------|--------|
| 3.1 | Manually navigate Facebook tab to `google.com` | Auto-stop triggers; badge → STOPPED; log entry `navigated_away` | |
| 3.2 | Close the target Facebook tab | Auto-stop triggers; log entry `tab_closed` | |
| 3.3 | Navigate Facebook tab to `/login/` (or any login URL) with Safe Mode ON | Auto-stop; badge → STOPPED; log `safe_mode:unsafe_url` | |
| 3.4 | Same as 3.3 with Safe Mode OFF | No auto-stop; continues scrolling | |
| 3.5 | Hide tab > 5 minutes (switch to another tab; wait) | Auto-stop after threshold; log `tab_hidden_too_long` | |
| 3.6 | Hide tab < 5 minutes; show again | State → PAUSED while hidden; → ACTIVE on return; no stop | |

---

## 4. Pause / Resume

| # | Test | Expected | Result |
|---|------|----------|--------|
| 4.1 | Switch away from the target tab | Badge → `PAUSED`; scroll actions stop | |
| 4.2 | Return to the target tab within threshold | Badge → `ACTIVE`; scroll resumes; log `Resumed` | |
| 4.3 | Close popup while PAUSED; reopen | Badge still shows PAUSED correctly | |

---

## 5. Safe mode

| # | Test | Expected | Result |
|---|------|----------|--------|
| 5.1 | Enable Safe Mode; manually type `/checkpoint/` in URL | Auto-stop fires on next health check | |
| 5.2 | Disable Safe Mode; repeat 5.1 | Extension continues running | |
| 5.3 | Test all unsafe patterns: `/two_factor`, `/recover`, `/disabled`, `/security` | All trigger auto-stop when Safe Mode ON | |

---

## 6. Domain restriction

| # | Test | Expected | Result |
|---|------|----------|--------|
| 6.1 | Open popup on `messenger.com` | Warning card shown; power button disabled | |
| 6.2 | Open popup on `m.facebook.com` | Popup works normally (subdomain allowed) | |
| 6.3 | Open popup on `fakefacebook.com` | Warning card shown | |
| 6.4 | Content script should NOT be injected into non-facebook.com tabs | Check DevTools → Sources → Content Scripts on a non-FB tab | |

---

## 7. Storage persistence

| # | Test | Expected | Result |
|---|------|----------|--------|
| 7.1 | Change interval slider to 20s min, 60s max; close popup | Reopen popup: sliders still at 20/60 | |
| 7.2 | Toggle off Safe Mode; close popup | Reopen popup: Safe Mode still unchecked | |
| 7.3 | Open `chrome://extensions` DevTools for extension → Storage | Only settings keys present (intervalMin, intervalMax, etc.); no cookie/token data | |
| 7.4 | Remove extension and reinstall | Settings reset to defaults | |

---

## 8. Scroll behaviour

| # | Test | Expected | Result |
|---|------|----------|--------|
| 8.1 | Enable Debug Mode; watch console | Each scroll logs: direction, delta px, current scroll position, next interval | |
| 8.2 | Set interval min=5, max=8; observe | Actions fire every 5–8s (with jitter) | |
| 8.3 | Set interval min=5, max=5 (force minimum) | Extension enforces 5s floor; no faster than 5s | |
| 8.4 | Set scroll max to 600; observe | Scroll never exceeds 600px per action | |
| 8.5 | Observe over 30+ actions | ~20% of actions scroll up (micro-scroll), ~80% scroll down | |
| 8.6 | Disable Jitter; observe 10 actions | Intervals are closer to exact mid-point values with no noise | |

---

## 9. Debug mode

| # | Test | Expected | Result |
|---|------|----------|--------|
| 9.1 | Enable Debug Mode; start session | Console verbose: scroll delta, next interval ms, scroll pos | |
| 9.2 | Disable Debug Mode | Console output stops (only explicit log entries remain) | |

---

## 10. Activity log (popup)

| # | Test | Expected | Result |
|---|------|----------|--------|
| 10.1 | Start session; wait for 5+ actions | Log panel shows last 5 entries, newest at top | |
| 10.2 | Press CLEAR button | Log panel shows "No activity yet"; background log unaffected | |
| 10.3 | Continue session after CLEAR | New entries appear after clear | |

---

## 11. Scroll safety (no element interaction)

| # | Test | Expected | Result |
|---|------|----------|--------|
| 11.1 | Monitor DOM events via DevTools while session runs | No click / mousedown / keydown / form submit events dispatched | |
| 11.2 | Monitor Network tab | No unexpected XHR/fetch requests originating from extension | |
| 11.3 | Check extension does not read document.cookie | Review content.js source: no cookie access | |

---

## Notes

Record any failures below with tab URL, Chrome version, and console output:

```
[Test #]  [Failure details]
```
