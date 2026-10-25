// Drives content.js through a fake player: preroll ad with a stale mute flag,
// Skip appears, trusted-click requests + seek fallback, ad ends, unmute.
// Run: node test/content.test.js
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
const store = {};
const storage = {
  getItem: (k) => store[k] ?? null,
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
const classes = new Set();
const video = { duration: NaN, currentTime: 0, muted: false };
let muted = false;
let skipVisible = false;
const skipBtn = { getClientRects: () => (skipVisible ? [1] : []), getAttribute: () => 'Skip', textContent: 'Skip' };
const player = {
  classList: { contains: (c) => classes.has(c) },
  querySelector: (s) => (s === 'video' ? video : null),
  querySelectorAll: () => [skipBtn],
  isMuted: () => muted,
  mute: () => { muted = true; },
  unMute: () => { muted = false; },
};
const timers = [];
const posts = [];
let clock = 1_000_000;
const ctx = {
  console: { debug: (...a) => console.log('   log:', ...a.map((x) => (typeof x === 'object' ? JSON.stringify(x) : x))) },
  sessionStorage: storage,
  localStorage: storage,
  document: {
    getElementById: () => player,
    querySelector: (s) => (s.includes('skip') ? skipBtn : null),
    querySelectorAll: () => [],
  },
  MutationObserver: class { observe() {} disconnect() {} },
  setInterval: (fn, ms) => timers.push({ fn, ms }),
  setTimeout: () => {},
  window: {},
  Number,
  Date: Object.assign(function () {}, { now: () => clock }),
  location: { origin: 'https://www.youtube.com' },
  postMessage: (msg, origin) => posts.push({ msg, origin }),
};
ctx.window = ctx;

storage.setItem('ytAdMute:weMuted', '1'); // stale flag left by a mid-ad reload
classes.add('ad-showing'); // preroll already showing when the script loads
new Function(...Object.keys(ctx), src)(...Object.values(ctx));

const tick = () => timers.find((t) => t.ms === 250).fn();
const jumped = () => video.currentTime === video.duration;
let failures = 0;
const check = (label, ok) => {
  if (!ok) failures++;
  console.log(ok ? 'PASS' : 'FAIL', label);
};

check('mutes preroll despite stale flag', muted === true);
tick();
check('no jump while Skip hidden', video.currentTime === 0);

skipVisible = true;
tick();
check('exactly one skip request when Skip appears',
  posts.length === 1 && posts[0].msg.source === 'yt-ad-mute' && posts[0].msg.type === 'skip' &&
  posts[0].origin === 'https://www.youtube.com');
check('no jump while duration is NaN', video.currentTime === 0);

video.duration = 15;
video.currentTime = 6;
clock += 1900; tick();
check('no jump before 2s after request', video.currentTime === 6);
check('no second request within 3s', posts.length === 1);
clock += 200; tick();
check('jump after 2s (finite duration)', jumped());
clock += 1000; tick();
check('second request after 3s while still in ad', posts.length === 2);

video.duration = NaN;
video.currentTime = 0;
clock += 5000; tick();
check('NaN duration still never jumps', video.currentTime === 0);
check('re-request after 3s while still in ad', posts.length === 3);

classes.delete('ad-showing');
skipVisible = false;
tick();
check('still muted inside grace period', muted === true);
clock += 1000; tick();
check('unmutes after grace', muted === false && !store['ytAdMute:weMuted']);

if (failures) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
