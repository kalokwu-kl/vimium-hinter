// Whether the extension can run on a page, and the site it belongs to. Shared by
// the scanner and the popup, so a page the popup calls restricted is the same
// page the scanner refuses. No chrome.* calls: this is testable on its own.

// Chrome runs no content scripts on the Web Store, so per-site control there is
// impossible. Keep this in step with the toolbar icon, which is grey wherever
// the extension cannot run.
const HINTER_WEB_STORE_HOSTS = ["chromewebstore.google.com"];

function hinterParseUrl(url) {
  try {
    return new URL(url);
  } catch (_) {
    return null;
  }
}

// Why the extension cannot run on this page, or "" when it can. The sentence is
// the popup's reason line: name the actual cause, not a generic refusal.
function hinterRestriction(url) {
  const parsed = hinterParseUrl(url);
  if (!parsed) return "Chrome doesn't allow extensions on this page.";
  if (parsed.protocol === "file:") return "Local files aren't supported.";
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "Chrome doesn't allow extensions on " + parsed.protocol + " pages.";
  }
  const onStore = HINTER_WEB_STORE_HOSTS.indexOf(parsed.hostname) >= 0 ||
    (parsed.hostname === "chrome.google.com" && parsed.pathname.indexOf("/webstore") === 0);
  return onStore ? "The Web Store doesn't allow extensions to run here." : "";
}

// The scanner's gate, which is a different question from the popup's: can the
// extension run here at all? Only the tab's own address can refuse — Chrome
// injects into an about:blank or srcdoc frame when the parent page is allowed,
// so refusing those by address would drop hints from frames that work today.
// Local files are refused in frames too, since file access is granted once, for
// the extension as a whole.
function hinterRunsHere(url, isTopFrame) {
  if (isTopFrame) return hinterRestriction(url) === "";
  const parsed = hinterParseUrl(url);
  return Boolean(parsed) && parsed.protocol !== "file:";
}

// The site the popup adds to a rule list, and the restriction on the page as a
// whole: one parse, one answer for both callers.
function hinterSite(url) {
  const parsed = hinterParseUrl(url);
  // chrome://, edge:// and file:// parse to a fake or empty hostname; never offer
  // to add those, the extension cannot run there. A restricted web page such as
  // the Web Store still has a real site worth naming, so keep it for display.
  const onWeb = parsed && (parsed.protocol === "http:" || parsed.protocol === "https:");
  return { host: onWeb ? parsed.hostname : "", restriction: hinterRestriction(url) };
}
