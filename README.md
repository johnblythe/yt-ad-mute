# YT Ad Mute

A tiny Chrome extension that takes the dead time out of YouTube ads:

- **Mutes** the moment an ad starts.
- **Skips** as soon as YouTube offers the Skip button.
- **Unmutes** when the ad is over (only if it was the one that muted; if you'd already muted, it leaves you muted).
- **Answers "Video paused. Continue watching?"** so long playlists keep playing.

Unskippable ads still play, just muted. No permissions, no tracking, no network requests: one content script on youtube.com.

## Install

1. Clone or download this repo.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this folder.
4. Refresh any open YouTube tabs.

After pulling an update, hit the reload icon on the extension's card **and refresh your YouTube tabs**. Already-open tabs keep running the old version until they're refreshed.

## How it works

- Watches the player for YouTube's `ad-showing` class and mutes through the player's own `mute()` API, so the volume button stays in sync.
- YouTube ignores scripted clicks on Skip (`isTrusted: false`), so once the Skip button is visible the extension seeks the ad to its end instead, which ends the ad exactly like a skip. Ads with no Skip button are left to play out.
- Waits ~0.7s before unmuting so back-to-back ads don't blip through.
- Refreshes YouTube's idle timer (`window._lact`) so the "Continue watching?" prompt rarely appears, and clicks **Yes** if it does. It never confirms a dialog that offers Cancel (like "Remove from playlist?").

## Debugging

Open DevTools on a YouTube tab (⌘⌥J / Ctrl+Shift+J), set the log level to include **Verbose**, and filter for `YT Ad Mute`. You should see `loaded`, `ad started`, `skip: jumping ad…`, and `ad over, unmuted`.

YouTube renames its player markup every so often. If skipping stops, the selectors are at the top of `content.js`; there's also a fallback that finds any visible player button labelled "Skip".

## Not covered

- YouTube Music (different player markup).
- Banner/overlay ads.

Not affiliated with YouTube or Google.

## License

[MIT](LICENSE)
