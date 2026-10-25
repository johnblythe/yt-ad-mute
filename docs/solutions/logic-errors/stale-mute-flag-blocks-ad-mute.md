---
title: A persisted "we muted" flag stopped ads from being muted after a refresh
date: 2026-10-25
category: logic-errors
module: mute/unmute state (content.js)
problem_type: logic_error
component: tooling
symptoms:
  - "Refreshing a YouTube tab while an ad auto-starts leaves the ad playing with sound"
  - "Muting worked on normal ad starts, so the ad-detection path looked healthy"
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags: [youtube, chrome-extension, mute, localstorage, sessionstorage, stale-state, reload]
---

# A persisted "we muted" flag stopped ads from being muted after a refresh

## Problem
The extension remembers that it muted the player (`weMuted`), so it knows to unmute when the ad ends. In v1.2.0 that flag lived in `localStorage` and also guarded the mute itself. A refresh during an ad left the flag set, so the next ad on the reloaded page was never muted.

## Symptoms
- User-reported: "refreshing while it's auto starting on ads doesn't mute anymore." Ads that started without a refresh still muted fine.
- In that case the reloaded page came back unmuted even though the flag said the extension had muted. Whether YouTube restores a mute made during an ad was not verified; the fix does not depend on it.

## What Didn't Work
- **The v1.2.0 design:** persist `weMuted` in `localStorage` so a mid-ad reload or tab close could still be undone, on the assumption that YouTube persists mute across loads. The ad-start check was:
  ```js
  // v1.2.0: skip muting if the flag says we already did
  if (!weMuted && !isMuted()) {
    setMuted(true);
    save(true);
  }
  ```
  This used "do we owe an unmute?" as a stand-in for "is the audio muted right now?". After a mid-ad refresh those two disagree: the flag survives, the mute doesn't, and the guard skips muting.
- **`localStorage` scope:** it is shared by every YouTube tab, so one tab's mid-ad flag could also suppress muting in a different tab.

## Solution
Fixed in v1.2.1, the first published version (see `CHANGELOG.md`).

Decide whether to mute from the live player state only, and keep the flag purely as a record that an unmute is owed (`content.js:146`-`content.js:148`):

```js
// Already muted means either the user muted (leave it) or we did before a
// reload (weMuted is still set, so we'll unmute after).
if (!isMuted()) {
  setMuted(true);
  save(true);
}
```

Scope the flag to the tab with `sessionStorage`, which survives a reload of that tab but is not shared with other tabs (`content.js:47`, `content.js:53`-`content.js:54`):

```js
function load() {
  try { return sessionStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
}
```

## Why This Works
Muting now depends only on whether the audio is muted at the moment the ad starts, which is the thing that actually matters. The flag no longer gates muting. It only decides whether to unmute afterwards, so a stale flag can at worst cause one extra unmute after an ad the extension muted anyway. `sessionStorage` keeps the reload case working (a mid-ad refresh still unmutes when the ad ends) without one tab's state leaking into another.

## Prevention
- Don't let a persisted "I did X" flag stand in for live state. Check the real state (here `isMuted()`) before acting, and use the flag only to decide what to undo.
- Scope persisted state to the narrowest lifetime that covers the case: per-tab `sessionStorage` for "survive a reload", not origin-wide `localStorage`.
- `test/content.test.js` (PR #2) seeds the stale flag before the script loads and asserts that a preroll ad is still muted (`mutes preroll despite stale flag`), then that it unmutes and clears the flag after the ad.

## Related Issues
- [youtube-skip-ignores-untrusted-clicks.md](../integration-issues/youtube-skip-ignores-untrusted-clicks.md): same debugging session. That confounder (open tabs keep the old script after an extension reload) surfaced alongside this bug.
- PR #2: the simulation test that covers this case.
