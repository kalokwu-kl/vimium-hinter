# What's new

Plain language, newest first. Update by `git pull`, then reload the extension in
`chrome://extensions`.

## 1.3.0

- **Dot on the toolbar icon** — optional, off by default. Amber while the re-scan
  is still waiting, green once hints are applied, in the bottom-right corner of
  the icon. Replaces the old count badge, which could not be made small.
- **Grey icon where it isn't running** — including pages Chrome does not allow
  extensions on (settings pages, the Web Store), which used to keep the normal
  icon and looked active when they weren't.
- **Reset for the re-scan wait** — a link beside the slider puts the wait back
  to the 300 ms default, so an over-cautious value is one click from normal.
- **Popup replaces the options page** — the per-site switch, both lists and the
  re-scan wait in one panel. The switch is greyed out with a plain-language
  reason wherever per-site control is impossible.
- **Local files are no longer supported** — `file://` pages are out of scope,
  removing support instead of half-working depending on Chrome's file-access setting.
- **Under the hood** — site rules now live in one shared file used by both the
  popup and the page scanner, and the extension's settings table has a single
  home, so the popup and the scanner can never disagree about a rule.
