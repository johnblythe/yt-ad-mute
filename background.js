// Sends one real (trusted) click on YouTube's Skip button. YouTube ignores
// scripted clicks, but input dispatched through the DevTools protocol counts.
const HOSTS = new Set(['www.youtube.com', 'm.youtube.com']);
const SETTLE_MS = 200; // attaching shows an infobar that can shift the layout
const busy = new Set();

// Mirrors the selectors in content.js. Runs in the page; returns the button's
// center or null.
const FIND_BUTTON = `(() => {
  const visible = (el) => !!el && el.getClientRects().length > 0;
  let btn = document.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button, .videoAdUiSkipButton');
  if (!visible(btn)) {
    btn = null;
    const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
    for (const el of player ? player.querySelectorAll('button, [role="button"]') : []) {
      const label = (el.getAttribute('aria-label') || el.textContent || '').trim();
      if (/^skip/i.test(label) && visible(el)) { btn = el; break; }
    }
  }
  if (!btn) return null;
  const r = btn.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function clickSkip(tabId) {
  const target = { tabId };
  await chrome.debugger.attach(target, '1.3');
  try {
    await sleep(SETTLE_MS);
    // Measure after attaching, since the infobar may have moved the page.
    const { result } = await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
      expression: FIND_BUTTON,
      returnByValue: true,
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
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== 'skip') return;
  if (sender.id !== chrome.runtime.id || sender.frameId !== 0) return;
  const tabId = sender.tab?.id;
  let host = '';
  try { host = new URL(sender.url).hostname; } catch {}
  if (tabId == null || !HOSTS.has(host) || busy.has(tabId)) return;

  busy.add(tabId);
  clickSkip(tabId)
    .catch((err) => console.warn('[YT Ad Mute] trusted click failed:', err?.message || err))
    .finally(() => busy.delete(tabId));
});
