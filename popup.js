/* global chrome, hinterRules, hinterMatchingRule, hinterEnabledOn, hinterSite, hinterSavedSettings, HINTER_DEFAULT_SETTINGS */

const SAVE_DELAY = 400;

const el = (id) => document.getElementById(id);

const settings = Object.assign({}, HINTER_DEFAULT_SETTINGS);
let tabUrl = "";
let saveTimerId = null;
let statusTimerId = null;

function listFor(mode, s) {
  return mode === "blacklist" ? s.blacklist : s.whitelist;
}

function setListFor(mode, s, value) {
  if (mode === "blacklist") s.blacklist = value;
  else s.whitelist = value;
}

// Restricted pages have no hostname to show, but the address still explains it.
function pageLabel(url) {
  const trimmed = String(url || "").replace(/[?#].*$/, "");
  if (trimmed === "") return "This page";
  return trimmed.length > 48 ? trimmed.slice(0, 47) + "…" : trimmed;
}

function siteState() {
  return {
    whitelist: settings.mode === "whitelist",
    rule: hinterMatchingRule(tabUrl, settings),
    enabled: hinterEnabledOn(tabUrl, settings)
  };
}

function withSite(list, host) {
  const rules = hinterRules(list);
  if (rules.indexOf(host) < 0) rules.push(host);
  return rules.join("\n");
}

function withoutRule(list, rule) {
  return hinterRules(list).filter((item) => item !== rule).join("\n");
}

// Say why the switch is where it is, in the words of the current mode, so the
// same state never reads two different ways.
function explain(state, host) {
  if (state.whitelist) {
    return state.rule
      ? 'On because "' + state.rule + '" is in your list.'
      : "Off because " + host + " is not in your list.";
  }
  return state.rule
    ? 'Off because "' + state.rule + '" is in your excluded list.'
    : "On because " + host + " is not in your excluded list.";
}

function renderSite() {
  const { host, restriction } = hinterSite(tabUrl);
  const state = siteState();
  const unavailable = restriction !== "";

  el("site").textContent = host || pageLabel(tabUrl);
  el("enabled").checked = !unavailable && state.enabled;
  el("enabled").disabled = unavailable;
  // A disabled checkbox on its own still looks like an unchecked one, so the
  // whole row is dimmed and stops advertising itself as clickable.
  el("enabledSwitch").classList.toggle("is-disabled", unavailable);
  el("reason").textContent = restriction || explain(state, host);
}

function renderHints() {
  const excluded = settings.mode === "blacklist";
  const count = hinterRules(listFor(settings.mode, settings)).length;

  el("patternsLabel").textContent = excluded ? "Sites where it stays off" : "Sites where it runs";

  const hint = el("emptyHint");
  hint.hidden = count > 0;
  hint.textContent = excluded
    ? "Nothing excluded yet, so it runs on every site."
    : "Nothing listed yet, so it does nothing. Add one rule per line.";
}

function renderSettings() {
  el("mode").value = settings.mode;
  el("patterns").value = listFor(settings.mode, settings);
  el("debounceDelay").value = settings.debounceDelay;
  el("delayValue").textContent = settings.debounceDelay;
  el("scanDot").checked = Boolean(settings.showScanDot);
  renderHints();
}

function save() {
  clearTimeout(saveTimerId);
  saveTimerId = null;

  chrome.storage.sync.set(hinterSavedSettings(settings), function () {
    el("status").textContent = "Saved.";
    clearTimeout(statusTimerId);
    statusTimerId = setTimeout(function () {
      el("status").textContent = "";
    }, 1500);
  });
}

function queueSave() {
  clearTimeout(saveTimerId);
  saveTimerId = setTimeout(save, SAVE_DELAY);
}

// The switch is the source of truth; the lists are just how it is stored.
function setEnabled(enable) {
  const host = hinterSite(tabUrl).host;
  if (!host) return;

  const state = siteState();
  if (enable === state.enabled) {
    renderSite();
    return;
  }

  const list = listFor(settings.mode, settings);
  const next = enable
    ? (state.whitelist ? withSite(list, host) : withoutRule(list, state.rule))
    : (state.whitelist ? withoutRule(list, state.rule) : withSite(list, host));
  setListFor(settings.mode, settings, next);

  renderSettings();
  renderSite();
  save();
}

el("enabled").addEventListener("change", function () {
  setEnabled(el("enabled").checked);
});

el("mode").addEventListener("change", function () {
  settings.mode = el("mode").value;
  // Each mode keeps its own list, so switching only swaps what's shown.
  el("patterns").value = listFor(settings.mode, settings);
  renderHints();
  renderSite();
  queueSave();
});

el("patterns").addEventListener("input", function () {
  setListFor(settings.mode, settings, el("patterns").value);
  renderHints();
  renderSite();
  queueSave();
});

el("debounceDelay").addEventListener("input", function () {
  settings.debounceDelay = Number(el("debounceDelay").value) || HINTER_DEFAULT_SETTINGS.debounceDelay;
  el("delayValue").textContent = settings.debounceDelay;
  queueSave();
});

// One click back to the shipped default; saving immediately rather than after
// the typing delay, since a button is a finished action.
el("resetDelay").addEventListener("click", function () {
  settings.debounceDelay = HINTER_DEFAULT_SETTINGS.debounceDelay;
  el("debounceDelay").value = settings.debounceDelay;
  el("delayValue").textContent = settings.debounceDelay;
  save();
});

el("scanDot").addEventListener("change", function () {
  settings.showScanDot = el("scanDot").checked;
  queueSave();
});

// Don't lose the last edit if the popup closes during the save delay.
document.addEventListener("visibilitychange", function () {
  if (document.hidden && saveTimerId !== null) save();
});
window.addEventListener("pagehide", function () {
  if (saveTimerId !== null) save();
});

chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
  tabUrl = (tabs && tabs[0] && tabs[0].url) || "";
  chrome.storage.sync.get(HINTER_DEFAULT_SETTINGS, function (items) {
    Object.assign(settings, HINTER_DEFAULT_SETTINGS, items);
    renderSite();
    renderSettings();
  });
});
