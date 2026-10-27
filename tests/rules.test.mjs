// Pure-function tests for the shared rule policy (rules.js).
import fs from "node:fs";
import vm from "node:vm";
import { ROOT } from "./lib.mjs";

const ctx = vm.createContext({ URL });
vm.runInContext(fs.readFileSync(`${ROOT}/rules.js`, "utf8"), ctx);
vm.runInContext(fs.readFileSync(`${ROOT}/runnability.js`, "utf8"), ctx);
// Top-level const in a vm script is lexical, not a property of the global,
// so read the bindings from inside the context instead.
const { hinterRules, hinterMatchingRule, hinterEnabledOn, HINTER_DEFAULT_SETTINGS } =
  vm.runInContext("({ hinterRules, hinterMatchingRule, hinterEnabledOn, HINTER_DEFAULT_SETTINGS })", ctx);
const { hinterRestriction, hinterSite, hinterSavedSettings, hinterRunsHere } =
  vm.runInContext("({ hinterRestriction, hinterSite, hinterSavedSettings, hinterRunsHere })", ctx);

const results = [];
const check = (name, ok, detail) => results.push({ name, ok: Boolean(ok), detail: String(detail) });
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const whitelist = (whitelist) => ({ mode: "whitelist", whitelist, blacklist: "" });
const blacklist = (blacklist) => ({ mode: "blacklist", whitelist: "", blacklist });

check("empty list has no rules", eq(hinterRules(""), []), JSON.stringify(hinterRules("")));
check("blank lines and padding are dropped", eq(hinterRules("a\n\n   \n  b  \r\n"), ["a", "b"]), JSON.stringify(hinterRules("a\n\n   \n  b  \r\n")));
check("order is preserved", eq(hinterRules("b\na"), ["b", "a"]), JSON.stringify(hinterRules("b\na")));

check("whitelist matches a substring", hinterEnabledOn("https://github.com/x", whitelist("github")) === true, "github.com");
check("whitelist rejects a non-match", hinterEnabledOn("https://gitlab.com/x", whitelist("github")) === false, "gitlab.com");
check("a rule with trailing space still matches", hinterEnabledOn("https://github.com/x", whitelist("github ")) === true, "trailing space");
check("a URL with a trailing space still matches", hinterEnabledOn("https://github.com/x ", whitelist("github")) === true, "url space");
check("matching is substring, not hostname", hinterEnabledOn("https://github.com/x", whitelist("hub.com")) === true, "hub.com");
check("blank rules cannot switch a page on", hinterEnabledOn("https://a.test/", whitelist("\n  \n")) === false, "blank list");

check("blacklist turns a matching page off", hinterEnabledOn("https://news.test/", blacklist("news")) === false, "news");
check("blacklist leaves others on", hinterEnabledOn("https://other.test/", blacklist("news")) === true, "other");
check("empty blacklist means everywhere", hinterEnabledOn("https://other.test/", blacklist("")) === true, "empty");

check("the matching rule is reported for the popup copy", hinterMatchingRule("https://github.com/x", whitelist("nope\ngithub")) === "github", hinterMatchingRule("https://github.com/x", whitelist("nope\ngithub")));
check("no rule reported when nothing matches", hinterMatchingRule("https://gitlab.com/", whitelist("github")) === "", "none");
check("a missing URL is simply not matched", hinterEnabledOn(undefined, whitelist("github")) === false, "undefined");

check("defaults are exported for popup and scanner",
  JSON.stringify(HINTER_DEFAULT_SETTINGS) === JSON.stringify({ mode: "whitelist", whitelist: "", blacklist: "", debounceDelay: 300, showScanDot: false }),
  JSON.stringify(HINTER_DEFAULT_SETTINGS));
check("default settings keep a site off until a rule says otherwise",
  hinterEnabledOn("https://anything.test/", HINTER_DEFAULT_SETTINGS) === false, "whitelist default");

// A setting added to the defaults table must reach storage without anyone
// editing the save path; that drift is what the single table exists to prevent.
// Simulate the next setting by rerunning rules.js with one extra key in the
// table, rather than trusting that today's key list happens to be complete.
const grownSource = fs.readFileSync(`${ROOT}/rules.js`, "utf8")
  .replace("showScanDot: false", "showScanDot: false, showFutureThing: true");
const grownCtx = vm.createContext({ URL });
vm.runInContext(grownSource, grownCtx);
const grownSaved = vm.runInContext("hinterSavedSettings({ showFutureThing: 7 })", grownCtx);
check("a setting added to the table is saved without touching save()",
  grownSaved.showFutureThing === 7, JSON.stringify(grownSaved));
check("saving writes every setting in the table",
  Object.keys(hinterSavedSettings({})).sort().join() === Object.keys(HINTER_DEFAULT_SETTINGS).sort().join(),
  Object.keys(hinterSavedSettings({})).join());
check("saving keeps the values it is given",
  hinterSavedSettings({ debounceDelay: 900, mode: "blacklist" }).debounceDelay === 900 &&
  hinterSavedSettings({ debounceDelay: 900, mode: "blacklist" }).mode === "blacklist",
  JSON.stringify(hinterSavedSettings({ debounceDelay: 900, mode: "blacklist" })));

// Restricted pages: one table, so the scanner and the popup agree by
// construction. Every message here is the popup's reason line.
check("https is allowed", hinterRestriction("https://example.com/x") === "", hinterRestriction("https://example.com/x"));
check("http is allowed", hinterRestriction("http://example.com/x") === "", hinterRestriction("http://example.com/x"));
check("local files say why", hinterRestriction("file:///home/u/notes.html") === "Local files aren't supported.", hinterRestriction("file:///home/u/notes.html"));
check("chrome pages name the scheme",
  hinterRestriction("chrome://extensions") === "Chrome doesn't allow extensions on chrome: pages.",
  hinterRestriction("chrome://extensions"));
check("the web store is restricted",
  hinterRestriction("https://chromewebstore.google.com/detail/abc") === "The Web Store doesn't allow extensions to run here.",
  hinterRestriction("https://chromewebstore.google.com/detail/abc"));
check("old web store path is restricted",
  hinterRestriction("https://chrome.google.com/webstore/category/extensions") === "The Web Store doesn't allow extensions to run here.",
  hinterRestriction("https://chrome.google.com/webstore/category/extensions"));
check("the rest of chrome.google.com is allowed",
  hinterRestriction("https://chrome.google.com/something") === "", hinterRestriction("https://chrome.google.com/something"));
check("an unparseable address is restricted",
  hinterRestriction("") === "Chrome doesn't allow extensions on this page.", hinterRestriction(""));

check("a normal page yields its site", hinterSite("https://example.com/x").host === "example.com", hinterSite("https://example.com/x").host);
check("a normal page has no restriction", hinterSite("https://example.com/x").restriction === "", hinterSite("https://example.com/x").restriction);
check("a restricted page yields no site to add",
  hinterSite("chrome://settings").host === "" && hinterSite("file:///tmp/a.html").host === "",
  JSON.stringify([hinterSite("chrome://settings").host, hinterSite("file:///tmp/a.html").host]));
check("a restricted page still explains itself",
  hinterSite("chrome://settings").restriction === "Chrome doesn't allow extensions on chrome: pages.",
  hinterSite("chrome://settings").restriction);
// Restriction and naming are separate questions: the Web Store has a real site
// worth showing even though hints cannot run there.
check("a restricted web page keeps its site for display",
  hinterSite("https://chromewebstore.google.com/detail/abc").host === "chromewebstore.google.com",
  hinterSite("https://chromewebstore.google.com/detail/abc").host);

// The scanner's gate: the tab's address decides, except that frames inherit
// permission from their parent, so an injected about:blank frame still runs.
check("the scanner runs on an allowed page", hinterRunsHere("https://example.com/", true) === true, "https top");
check("the scanner refuses a restricted top page", hinterRunsHere("chrome://extensions", true) === false, "chrome top");
check("the scanner refuses a local file", hinterRunsHere("file:///tmp/a.html", true) === false, "file top");
check("an about:blank frame keeps running", hinterRunsHere("about:blank", false) === true, "blank frame");
check("an srcdoc frame keeps running", hinterRunsHere("about:srcdoc", false) === true, "srcdoc frame");
check("a local file is refused in a frame too", hinterRunsHere("file:///tmp/a.html", false) === false, "file frame");

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : "  -> " + r.detail}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
