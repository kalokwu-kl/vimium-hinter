// Settings and site-rule policy, shared by the content script, the popup and the
// tests. Kept free of chrome.* calls so it stays a pure function library: the
// popup and the scanner must never disagree about whether a page is switched on.

// Stored settings plus what an unset key means. One table, because a second copy
// would drift and make the popup and the scanner disagree about defaults.
const HINTER_DEFAULT_SETTINGS = {
  mode: "whitelist",
  whitelist: "",
  blacklist: "",
  debounceDelay: 300,
  showScanDot: false
};

// One rule per line. Blank lines and surrounding whitespace are ignored, so a
// stray trailing space or a CRLF line ending cannot silently disable a rule.
function hinterRules(list) {
  return String(list || "")
    .split("\n")
    .map(function (rule) { return rule.trim(); })
    .filter(function (rule) { return rule.length > 0; });
}

// Rules are matched as a substring of the page address, not as globs or regexes.
function hinterMatchingRule(url, settings) {
  const list = settings.mode === "blacklist" ? settings.blacklist : settings.whitelist;
  const address = String(url || "");
  return hinterRules(list).find(function (rule) { return address.indexOf(rule) >= 0; }) || "";
}

// What to write to storage: exactly the default keys. One table, so a new
// setting is saved because it exists, not because someone remembered to list it
// in the popup as well.
function hinterSavedSettings(settings) {
  const saved = {};
  for (const key of Object.keys(HINTER_DEFAULT_SETTINGS)) saved[key] = settings[key];
  return saved;
}

// Whitelist mode: a matching rule turns hints on. Blacklist mode: it turns them off.
function hinterEnabledOn(url, settings) {
  const matched = hinterMatchingRule(url, settings) !== "";
  return settings.mode === "blacklist" ? !matched : matched;
}
