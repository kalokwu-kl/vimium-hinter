/* global chrome, hinterEnabledOn, hinterRunsHere, HINTER_DEFAULT_SETTINGS */

(function () {
  "use strict";

  const THROTTLE_LIMIT = 5000;

  // The candidate set never changes, so build the selector once instead of on
  // every scan.
  const TAGS = ["a", "link", "script", "iframe", "button", "textarea", "input", "select", "details"];
  // Anything already carrying a role is left alone: a role is the page saying
  // what the element is, and our job is to supply a missing signal, not to
  // replace one. Rewriting role="radio" or role="listitem" would cost the
  // page its own meaning and gain Vimium nothing it did not already have.
  const CANDIDATE_SELECTOR =
    ":not(" + TAGS.join("):not(") + "):not([role]):not([onclick]):not([jsaction])";

  let debounceTimerId = null;
  let throttleTimerId = null;
  let observer = null;
  let debounceDelay = 300;
  let showScanDot = false;
  let enabledNow = false;
  let waitingForBody = false;
  const tagged = new Set();

  function computedCursor(element) {
    if (element.computedStyleMap) {
      const cursor = element.computedStyleMap().get("cursor");
      return cursor ? cursor.value : "";
    }
    return getComputedStyle(element).cursor;
  }

  function looksClickable(element, parentCursor) {
    if (element.style.cursor === "pointer") return true;
    if (element.className === "" || element.parentElement === null) return false;
    return computedCursor(element) === "pointer" && parentCursor(element.parentElement) !== "pointer";
  }

  // Remove only the role this scanner wrote. If the page has since given the
  // element a role of its own, that one is not ours to delete.
  function untag(element) {
    try {
      if (element.getAttribute("role") === "button") element.removeAttribute("role");
    } catch (_) {}
  }

  function labelClickables() {
    if (document.body === null) return;

    // Detached elements cannot be clicked; let them go so a page that keeps
    // replacing nodes does not accumulate references to elements it has
    // discarded. Their role goes too: if the page re-inserts them later, the
    // next scan picks them up as fresh candidates.
    for (const element of tagged) {
      if (element.isConnected) continue;
      untag(element);
      tagged.delete(element);
    }

    // Parents are shared between siblings; resolve each one only once per scan.
    const parentCursorCache = new Map();
    function parentCursor(element) {
      if (!parentCursorCache.has(element)) {
        parentCursorCache.set(element, computedCursor(element));
      }
      return parentCursorCache.get(element);
    }

    for (const element of document.body.querySelectorAll(CANDIDATE_SELECTOR)) {
      try {
        if (looksClickable(element, parentCursor)) {
          element.setAttribute("role", "button");
          tagged.add(element);
        }
      } catch (_) {}
    }

    reportApplied();
  }

  function untagAll() {
    for (const element of tagged) untag(element);
    tagged.clear();
  }

  // Only the top frame speaks for the tab: it drives the toolbar icon.
  function report(message) {
    if (window !== window.top) return;
    try {
      chrome.runtime.sendMessage(message, () => void chrome.runtime.lastError);
    } catch (_) {}
  }

  function reportState(enabled) {
    report({ type: "state", enabled });
  }

  // The dot is opt-in: with it off the icon only changes when hinting starts or
  // stops, not once per scan.
  function reportWaiting() {
    if (showScanDot) report({ type: "waiting" });
  }

  function reportApplied() {
    if (showScanDot) report({ type: "applied" });
  }

  function onDebounceFire() {
    debounceTimerId = null;
    if (throttleTimerId !== null) {
      clearTimeout(throttleTimerId);
      throttleTimerId = null;
    }
    labelClickables();
  }

  function onThrottleFire() {
    throttleTimerId = null;
    if (debounceTimerId !== null) {
      clearTimeout(debounceTimerId);
      debounceTimerId = null;
    }
    labelClickables();
  }

  function scheduleScan() {
    // One message per settle cycle, not one per mutation batch.
    const wasIdle = debounceTimerId === null;
    if (debounceTimerId !== null) clearTimeout(debounceTimerId);
    debounceTimerId = setTimeout(onDebounceFire, debounceDelay);

    if (throttleTimerId === null) {
      throttleTimerId = setTimeout(onThrottleFire, THROTTLE_LIMIT);
    }

    if (wasIdle) reportWaiting();
  }

  function clearTimers() {
    if (debounceTimerId !== null) {
      clearTimeout(debounceTimerId);
      debounceTimerId = null;
    }
    if (throttleTimerId !== null) {
      clearTimeout(throttleTimerId);
      throttleTimerId = null;
    }
  }

  function startObserver() {
    if (document.body === null) return;
    if (observer !== null) observer.disconnect();
    observer = new MutationObserver(scheduleScan);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function stopObserver() {
    clearTimers();
    if (observer !== null) {
      observer.disconnect();
      observer = null;
    }
  }

  // Reads stored settings and applies the parts the scanner keeps in memory.
  // Resolves with the whole settings object so the caller can ask the policy
  // question without a second storage read.
  function loadSettings() {
    return new Promise(function (resolve) {
      chrome.storage.sync.get(HINTER_DEFAULT_SETTINGS, function (items) {
        debounceDelay = items.debounceDelay;
        showScanDot = Boolean(items.showScanDot);
        resolve(items);
      });
    });
  }

  function startHinting() {
    if (document.body === null) return false;
    labelClickables();
    startObserver();
    return true;
  }

  function applySettings() {
    loadSettings().then(function (items) {
      const enabled = hinterEnabledOn(document.URL, items);
      enabledNow = enabled;
      stopObserver();

      if (!enabled) {
        // Let go of anything we tagged, so hints disappear immediately.
        untagAll();
        reportState(false);
        return;
      }

      // Report before scanning: at document_start there is no body yet, and the
      // icon should turn colour as soon as we know hinting is on.
      reportState(true);
      if (startHinting() || waitingForBody) return;

      waitingForBody = true;
      document.addEventListener("DOMContentLoaded", function () {
        waitingForBody = false;
        if (enabledNow) startHinting();
      }, { once: true });
    }).catch(function () {
      // Settings could not be read (rare). Leave the page untouched instead of
      // guessing, and let the next storage change or navigation try again.
    });
  }

  // Restricted pages are refused before reading settings, so the icon stays grey
  // and nothing on the page is tagged. Same table the popup explains from, asked
  // as "can we run here" rather than "why not".
  if (!hinterRunsHere(location.href, window === window.top)) {
    report({ type: "state", enabled: false });
    return;
  }

  applySettings();

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== "sync") return;
    if (changes.debounceDelay) {
      debounceDelay = changes.debounceDelay.newValue;
    }
    if (changes.mode || changes.blacklist || changes.whitelist || changes.showScanDot) {
      applySettings();
    }
  });

  // Single-page navigations on Turbo (formerly Turbolinks) sites can move
  // between allowed and disallowed URLs without a reload, so re-check.
  document.addEventListener("turbo:load", applySettings);
})();
