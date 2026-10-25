// YT Ad Mute: mutes while an ad plays, jumps to the end of the ad as soon as
// YouTube offers Skip, and unmutes once the ad is gone (only if we were the
// ones who muted). YouTube ignores scripted clicks on Skip (isTrusted=false),
// so seeking the ad to its end stands in for the click. Also
// keeps the "Video paused. Continue watching?" prompt from stopping playback.
//
// Runs in the page's MAIN world so it can use the player's own mute()/unMute()
// API, which keeps YouTube's volume button in sync.
(() => {
  const SKIP_SELECTOR = [
    '.ytp-skip-ad-button',
    '.ytp-ad-skip-button-modern',
    '.ytp-ad-skip-button',
    '.videoAdUiSkipButton',
  ].join(',');
  const TICK_MS = 250;
  // Ads often run back to back with a brief gap; wait before unmuting so the
  // second ad doesn't blip through.
  const UNMUTE_DELAY_MS = 700;
  // If a seek doesn't take, try again after this long.
  const JUMP_RETRY_MS = 1500;
  // Remember (per tab) that we muted, so a reload mid-ad still unmutes afterwards.
  const STORAGE_KEY = 'ytAdMute:weMuted';
  // YouTube decides you're idle from window._lact (last activity time).
  const KEEP_ALIVE_MS = 60_000;

  let player = null;
  let classObserver = null;
  let inAd = false;
  let adEndedAt = 0;
  let lastJumpAt = 0;
  let weMuted = load();

  // console.debug only shows with DevTools' "Verbose" level on.
  const log = (...args) => console.debug('[YT Ad Mute]', ...args);

  function load() {
    try { return sessionStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
  }

  function save(value) {
    weMuted = value;
    try {
      if (value) sessionStorage.setItem(STORAGE_KEY, '1');
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch {}
  }

  const findPlayer = () =>
    document.getElementById('movie_player') || document.querySelector('.html5-video-player');
  const adShowing = () =>
    player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting');
  const video = () => player.querySelector('video');
  // getClientRects works for position:fixed dialogs, where offsetParent is always null.
  const isVisible = (el) => !!el && el.getClientRects().length > 0;

  function isMuted() {
    if (typeof player.isMuted === 'function') return player.isMuted();
    return !!video()?.muted;
  }

  function setMuted(muted) {
    if (typeof player.mute === 'function') {
      if (muted) player.mute();
      else player.unMute();
      return;
    }
    const v = video();
    if (v) v.muted = muted;
  }

  function findSkipButton() {
    // The button sits in the DOM hidden during the countdown; only use it once visible.
    const bySelector = document.querySelector(SKIP_SELECTOR);
    if (isVisible(bySelector)) return bySelector;
    // Class names churn; fall back to any visible control in the player labelled "Skip".
    for (const el of player.querySelectorAll('button, [role="button"]')) {
      const label = (el.getAttribute('aria-label') || el.textContent || '').trim();
      if (/^skip/i.test(label) && isVisible(el)) return el;
    }
    return null;
  }

  function jumpToAdEnd() {
    const v = video();
    if (!v || !Number.isFinite(v.duration) || v.currentTime >= v.duration - 0.25) return;
    if (Date.now() - lastJumpAt < JUMP_RETRY_MS) return;
    lastJumpAt = Date.now();
    log(`skip: jumping ad from ${v.currentTime.toFixed(1)}s to ${v.duration.toFixed(1)}s`);
    v.currentTime = v.duration;
  }

  function dismissStillWatching() {
    for (const dialog of document.querySelectorAll('yt-confirm-dialog-renderer')) {
      if (!isVisible(dialog)) continue;
      // The "Continue watching?" prompt only has a Yes button. Never auto-confirm a
      // dialog that offers Cancel (e.g. "Remove from playlist?").
      if (isVisible(dialog.querySelector('#cancel-button'))) continue;
      const yes = dialog.querySelector('#confirm-button button') || dialog.querySelector('#confirm-button');
      if (!isVisible(yes)) continue;
      yes.click();
      setTimeout(() => {
        const v = document.querySelector('video');
        if (v?.paused) v.play().catch(() => {});
      }, 300);
    }
  }

  function keepAlive() {
    if ('_lact' in window) window._lact = Date.now();
  }

  function attach(p) {
    classObserver?.disconnect();
    player = p;
    if (!player) return;
    // React the instant the ad class appears instead of waiting for the next tick.
    classObserver = new MutationObserver(update);
    classObserver.observe(player, { attributes: true, attributeFilter: ['class'] });
  }

  function update() {
    const p = findPlayer();
    if (p !== player) attach(p);
    if (!player) return;

    if (adShowing()) {
      if (!inAd) {
        inAd = true;
        adEndedAt = 0;
        // Already muted means either the user muted (leave it) or we did before a
        // reload (weMuted is still set, so we'll unmute after).
        if (!isMuted()) {
          setMuted(true);
          save(true);
        }
        log('ad started', { muted: isMuted(), weMuted });
      }
      // Only once Skip is on screen, so unskippable ads play out (muted) as usual.
      if (findSkipButton()) jumpToAdEnd();
      return;
    }

    if (inAd) {
      inAd = false;
      adEndedAt = Date.now();
    }
    if (weMuted && Date.now() - adEndedAt >= UNMUTE_DELAY_MS) {
      // If the user unmuted mid-ad themselves, there's nothing to undo.
      if (isMuted()) setMuted(false);
      save(false);
      log('ad over, unmuted');
    }
  }

  setInterval(() => {
    update();
    dismissStillWatching();
  }, TICK_MS);
  setInterval(keepAlive, KEEP_ALIVE_MS);
  log('loaded v1.2.1');
  update();
})();
