# Changelog

## [1.3.0] - 2026-10-25

### Added
- Real (trusted) click on Skip via `chrome.debugger`, sent from a background worker. Ads now end as cleanly as a manual skip, with no static frame afterwards.
- `bridge.js` relay so the MAIN-world content script can reach the background worker.

### Changed
- Seek-to-end is now a fallback, used only if the ad is still running 2s after the click request.
- Requires the `debugger` permission; Chrome briefly shows a "started debugging this browser" bar during each skip.

## [1.2.1] - 2026-10-25

### Added
- Initial release: mutes ads, seeks the ad to its end once Skip is offered, unmutes afterwards, and auto-answers "Video paused. Continue watching?".
