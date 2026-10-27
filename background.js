/* global chrome, importScripts, createImageBitmap, hinterRenderIcon, HINTER_ICON_SIZES */

importScripts("icon-art.js");

// 32 is scaled from the 48px artwork: no separate 32px file to keep in sync.
const ARTWORK = { 16: "images/logo-16.png", 32: "images/logo-48.png", 48: "images/logo-48.png" };

const rendered = new Map();
const artwork = new Map();
// "global" or a tab id -> last painted state, so repeat reports are free.
const painted = new Map();
// One queue per target: icons must land in the order the states happened.
const queues = new Map();

async function artworkFor(size) {
  if (!artwork.has(size)) {
    const response = await fetch(chrome.runtime.getURL(ARTWORK[size]));
    artwork.set(size, await createImageBitmap(await response.blob()));
  }
  return artwork.get(size);
}

async function iconsFor(state) {
  const icons = {};
  for (const size of HINTER_ICON_SIZES) {
    const key = state + ":" + size;
    if (!rendered.has(key)) {
      rendered.set(key, hinterRenderIcon(await artworkFor(size), size, state));
    }
    icons[size] = rendered.get(key);
  }
  return icons;
}

async function applyPaint(key, tabId, state) {
  if (painted.get(key) === state) return;
  painted.set(key, state);
  try {
    const imageData = await iconsFor(state);
    await chrome.action.setIcon(tabId === null ? { imageData } : { tabId, imageData });
  } catch (_) {
    // Tab gone, or the artwork failed to decode: let the next event retry.
    painted.delete(key);
  }
}

const keyFor = (tabId) => (tabId === null ? "global" : String(tabId));

// null paints the global icon, which is what every tab without an override
// falls back to.
function paint(tabId, state) {
  const key = keyFor(tabId);
  const previous = queues.get(key) || Promise.resolve();
  const next = previous.then(() => applyPaint(key, tabId, state));
  queues.set(key, next.catch(() => {}));
  return next;
}

// Grey is the default for every tab. Only the content script can say "hinting
// here", so pages that never run it -- chrome://, the Web Store, the PDF
// viewer, file:// without file access -- stay grey without the background ever
// needing to know their URL (which would cost the "tabs" permission).
void paint(null, "off");

// Chrome only starts the worker at browser launch if something listens here, and
// the grey default above has to be painted then: per-tab icons do not survive a
// restart, so without this a restricted page would show the manifest icon.
chrome.runtime.onStartup.addListener(() => void paint(null, "off"));

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!sender.tab || sender.tab.id === undefined) return;
  const tabId = sender.tab.id;

  if (msg.type === "state") paint(tabId, msg.enabled ? "on" : "off");
  else if (msg.type === "waiting") paint(tabId, "waiting");
  else if (msg.type === "applied") paint(tabId, "applied");
});

chrome.tabs.onRemoved.addListener((tabId) => {
  painted.delete(keyFor(tabId));
  queues.delete(keyFor(tabId));
});

// Reloading the unpacked extension leaves the previous build's per-tab icon (and
// any leftover badge) behind, and the old content scripts can no longer report,
// so reset every open tab to the grey default.
chrome.runtime.onInstalled.addListener(async () => {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id === undefined) continue;
    painted.delete(keyFor(tab.id));
    await chrome.action.setBadgeText({ tabId: tab.id, text: "" }).catch(() => {});
    await paint(tab.id, "off");
  }
});
