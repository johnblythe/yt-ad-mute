// Relays "skip" requests from content.js (MAIN world, no chrome.* access) to
// the background worker. Carries no data: the worker finds the button itself.
window.addEventListener('message', (e) => {
  if (e.source !== window || e.data?.source !== 'yt-ad-mute' || e.data.type !== 'skip') return;
  try {
    chrome.runtime.sendMessage({ type: 'skip' }).catch(() => {});
  } catch {} // extension was reloaded; this tab still has the old script
});
