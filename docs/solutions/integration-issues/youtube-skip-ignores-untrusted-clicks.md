---
title: YouTube's ad Skip button ignores scripted clicks; send a trusted click via chrome.debugger
date: 2026-10-25
category: integration-issues
module: ad skipping (content.js, background.js, bridge.js)
problem_type: integration_issue
component: tooling
symptoms:
  - "Skip button is visible and matched by the selector, yet the ad keeps playing while the extension clicks it every 250ms"
  - "A capture-phase click listener shows every extension click arriving with isTrusted=false"
  - "Seeking the ad to its end does end it, but YouTube then holds a static frame for ~5s before the video starts"
root_cause: wrong_api
resolution_type: code_fix
severity: medium
tags: [youtube, chrome-extension, istrusted, chrome-debugger, ad-skip, manifest-v3, synthetic-events]
---

# YouTube's ad Skip button ignores scripted clicks; send a trusted click via chrome.debugger

## Problem
The extension detected ads and muted them correctly, but its auto-skip never worked: `element.click()` on YouTube's Skip button does nothing. The first workaround (seeking the ad to its end) skipped, but left ~5s of dead time on a static frame, which defeated the purpose.

## Symptoms
- Skip button `button.ytp-skip-ad-button` (id `skip-button:N`, changes per ad) inside `#movie_player` is visible (`getClientRects().length === 1`) and matched, but the ad plays on.
- A capture listener logged 68 extension clicks in ~17s on one ad, all `isTrusted: false`, all targeting the Skip button; the ad never ended.
- With `video.currentTime = video.duration`, the ad ends, then the player sits on a still frame for ~5s (user-reported: a 20s ad still cost ~10s).

## What Didn't Work
- **`element.click()`** on the matched button: ignored. Per the [reverse-engineering notes in sevenjetbrains/youtube-ad-skip](https://github.com/sevenjetbrains/youtube-ad-skip/blob/HEAD/docs/verification-selecteurs.md) (an external repo), the player routes clicks with `isTrusted === false` to `onAbnormalityDetected` instead of `onAdSkip`, so scripted clicks are not just ignored but flagged.
- **Full synthetic event sequence** (`pointerdown`, `mousedown`, `pointerup`, `mouseup`, `click`, bubbling/composed, centered coordinates): still `isTrusted: false`, still ignored. No page or content script can mint a trusted event.
- **Finding the button by its "Skip" label** instead of class names: harmless robustness, but selection was never the problem; the class selector already matched.
- **Seeking the ad to its end:** ends the ad but triggers the ~5s static hold. The same notes say the player also logs seeks during ads as untrusted. It also has a trap: right after one ad hands off to the next in a pod, `video.duration` is `NaN` for ~3s while Skip is already visible, and `video.currentTime = NaN` throws `TypeError: ... non-finite`.
- **Confounder while testing:** after reloading an unpacked extension, already-open YouTube tabs keep running the old MAIN-world script until refreshed, so the first test of the seek version actually ran the old click-only code.

## Solution
Send a real input event through the DevTools protocol from a background service worker, and keep seek-to-end only as a fallback (PR #1).

MAIN-world code can't call `chrome.*`, so the request hops through an ISOLATED-world relay:

```js
// content.js (MAIN world): ask for a click as soon as Skip is visible
window.postMessage({ source: 'yt-ad-mute', type: 'skip' }, location.origin);

// bridge.js (ISOLATED world): relay only; carries no coordinates
window.addEventListener('message', (e) => {
  if (e.source !== window || e.data?.source !== 'yt-ad-mute' || e.data.type !== 'skip') return;
  try { chrome.runtime.sendMessage({ type: 'skip' }).catch(() => {}); } catch {}
});
```

The background worker attaches the debugger, measures the button itself (never trusting page-supplied coordinates), clicks, and always detaches:

```js
// background.js
await chrome.debugger.attach(target, '1.3');
try {
  await sleep(SETTLE_MS); // the "started debugging" infobar can shift layout
  const { result } = await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
    expression: FIND_BUTTON, returnByValue: true,
  });
  const point = result?.value;
  if (!point) return;
  for (const type of ['mousePressed', 'mouseReleased']) {
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type, x: point.x, y: point.y, button: 'left', clickCount: 1,
    });
  }
} finally {
  await chrome.debugger.detach(target).catch(() => {});
}
```

Key details in the current tree:
- `manifest.json` adds the `debugger` permission and a service worker; `content.js` runs with `"world": "MAIN"` (`manifest.json:18`) so it can use the player's `mute()`/`unMute()`.
- `background.js:51` and `background.js:55` accept only this extension's top-frame requests from `www`/`m.youtube.com`, one attach per tab at a time.
- `background.js:4` waits 200ms after attaching before measuring.
- `content.js:156` re-requests the click every `SKIP_REQUEST_RETRY_MS` (3000, `content.js:27`) while Skip stays visible; `content.js:158` seeks to the end only after `JUMP_FALLBACK_MS` (2000, `content.js:29`).
- The seek keeps its guard: `content.js:101` returns unless `Number.isFinite(v.duration)`.

## Why This Works
`Input.dispatchMouseEvent` injects the event through the browser's input pipeline, so the page receives it with `isTrusted: true`, exactly like a user's click, and the player takes its normal `onAdSkip` path. Measured live before the change: after five untrusted clicks had failed on a 40s ad, one trusted click ended it within 0.8s and the real video started at 0:00. After PR #1, the user confirmed ads now skip with no static frame.

Cost of the approach: the `debugger` permission, and Chrome briefly shows its yellow "started debugging this browser" bar during each skip. Embedded players (`frameId !== 0`) are rejected by the worker and fall back to the seek.

## Prevention
- When a scripted click on a third-party UI "does nothing", check `isTrusted` first with a capture listener before rewriting selectors:
  ```js
  document.addEventListener('click', (e) => console.log(e.isTrusted, e.target), true);
  ```
  A real mouse click as a control experiment separates "wrong element" from "untrusted event".
- Never assign a media `currentTime` from `duration` without `Number.isFinite(duration)`; durations go `NaN` during source swaps.
- After reloading an unpacked extension, refresh the target tabs; log a version string on load (`content.js` logs `loaded v1.3.0`) so a stale script is obvious in the console.
- `test/content.test.js` (PR #2) covers the request/fallback timing: one request when Skip appears, retry after 3s, no seek before 2s, no seek while `duration` is `NaN`. Run `node test/content.test.js`.

## Related Issues
- PR #1: trusted-click skip via `chrome.debugger`, seek-to-end fallback.
- PR #2: simulation test for `content.js`.
- Reference implementations using the same technique: [sevenjetbrains/youtube-ad-skip](https://github.com/sevenjetbrains/youtube-ad-skip), [it-dkt/youtube-ad-skipper](https://github.com/it-dkt/youtube-ad-skipper).
