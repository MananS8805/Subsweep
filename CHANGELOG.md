# Changelog

## 0.8.0 - 2026-10-19
### Added
- **Settings travel with your backup.** Base currency, exchange rates, reminder days, dismissed insights and the monthly-review snooze are saved in the backup file, so restoring after clearing site data brings your whole setup back. Settings are validated like everything else: a bad rate or an unknown currency code is shown as a warning and never applied, unknown keys are ignored, and a backup from an older version with no settings leaves yours exactly as they are.
- **Restore preview.** Choosing a backup now opens a preview that changes nothing until you confirm: how many subscriptions will be added or skipped (Merge) or deleted and loaded (Replace), and a table of every setting that differs, marked "Will change" or "Kept as it is". Merge keeps your existing settings unless you tick *Also overwrite my settings*; settings you have not set yet are still filled in. Replace restores the file's settings unless you untick the box, and never clears settings the file does not mention. Replace needs an explicit confirmation tick.
- **Keyboard shortcuts.** `N` quick-add, `/` filter by name, `?` cheat sheet, `R` monthly review, and `G` then `E`/`Y`/`D`/`L` to switch view. Shortcuts never fire while you type in a field, with Ctrl/Cmd/Alt held, or while a dialog is open, and the `G` sequence expires after one second. Everything also has a button (cheat sheet from Settings and the footer).
- **Quick add.** A small dialog with name, amount, cycle and next renewal. It uses the same validation as the full form, warns before adding something that looks like a subscription you already track, and has a "More details…" link to the full form.
- **Filter by name** above the list (Escape clears it; "Select all" only covers what is shown).
- **Notes** on every subscription (plain text, up to 500 characters, with a counter). Notes show on the card and in the detail view and are included in backups.
- **Monthly review.** A card offers a quick pass over subscriptions you have not reviewed in 30 days, most expensive first: *Keep*, *Cancel?* (ticks it for the savings simulator) or *Skip*. Each choice is saved immediately, an Undo toast puts everything back, and "Not now" hides the card for 7 days. A **Mark reviewed** link on each card does it one at a time, also with Undo.
- `scripts/verify-workflow.mjs`: end-to-end checks for all of the above on the production build.

### Changed
- The sample-data marker moved from the `notes` field to a batch id, so notes are always the user's own. Existing sample rows keep working through the saved list of ids.
- The restore dialog no longer uses a browser confirm; Replace is confirmed inside the preview.
- Backups only export settings SubSweep knows about.
- Saving a subscription from the full form now shows validation messages instead of silently doing nothing.

### Notes
- The backup format is still version 2 and every new field is optional, so v0.1 to v0.7 backups import exactly as before. No database changes.
- Verified on the production build: no axe violations on the new screens (restore preview in every state, quick add with its error and warning, cheat sheet, review dialog and summary, notes form) in light and dark at 1280px and 390px; everything also works offline.

## 0.7.0 - 2026-10-19
### Added
- **Bulk actions.** A **Select** button on the list turns on select mode: every card gets a checkbox and a sticky action bar offers *Set category*, *Mark used recently*, *Mute reminders*, *Mark Cancel?*, *Delete*, *Select all* and *Clear*. Every action shows an **Undo** toast for 15 seconds. Undo puts back the exact previous values (and removes a flag that did not exist before instead of setting it to false); deleting restores whole rows with their ids. If an item was edited or deleted by something else before you undo, it is skipped and the message says so ("1 item could not be restored"). Deleting more than 3 asks first, in an accessible dialog that starts on Cancel. Selection clears after each action, Escape leaves select mode, a "Jump to actions" link moves keyboard focus to the bar, and on phones the bar is one compact scrolling row so it never covers the cards.
- **Price-history chart.** A **Price history** button on any subscription with 2 or more prices opens a step chart drawn in plain SVG, with a one-sentence summary ("Rose from ₹499.00 to ₹649.00 (+30%) since Jan 2026"). It is an image to screen readers with that sentence as its label, and a real table of dates, prices and changes sits beside it. The vertical axis always starts at 0 so a small change is not exaggerated, and direction is shown by marker shape (circle, triangle up, triangle down) as well as colour. It fits at 320px and meets contrast in light and dark.
- **Next 30 days.** A new tab lists every charge due in the next 30 days, grouped by calendar week (Monday to Sunday), with the total, the busiest week and your free trials that end in the window (highlighted and kept out of the total). Weekly and every-2-weeks charges count every time they occur, month-end renewals keep their day, yearly and quarterly charges count only if they fall inside the window, muted and snoozed items are included and marked (they still cost money), and charges in a currency with no exchange rate are listed separately instead of being counted. **Copy summary** puts plain text on the clipboard (or opens it in a text box if the clipboard is blocked) and **Print** gives a clean one-page layout.
- `scripts/verify-bulk.mjs`: end-to-end checks for all of the above on the production build.

### Changed
- "All subscriptions" has its own heading row with the Select button; the floating add button hides while selecting.
- Tab navigation now covers four tabs (Explore, Yearly, Next 30 days, List).

### Notes
- No database or backup-format changes: v0.6 data and backups load exactly as before.
- Verified on the production build: no axe violations on the new screens (digest, select mode with the bar, delete confirmation, undo toast, chart dialog) in light and dark at 1280px and 390px; every new feature also works offline.

## 0.6.0 - 2026-10-16
### Added
- **Smarter detection.** Weekly, every-2-weeks, monthly, quarterly and yearly charges are found from the median gap between charges (7 ±1, 14 ±2, 28-31 ±3, 90 ±6, 365 ±10 days). Every result gets a **confidence** from 0 to 1 and a label: High (0.75 and up), Medium (0.5 to 0.75) or Low. The score weighs how often it repeated, how regular the gaps are, how consistent the amount is and how recent the last charge is. Erratic amounts, a yearly charge seen only twice and two weekly sightings are capped so they cannot look certain. Grocery and fuel style spending is rejected or Low.
- **Price history.** Each distinct price is recorded with its date, a mid-series price change stays one subscription, and the "price crept up" flag is now derived from that history. The detail view shows the list.
- **Review before adding.** A scan no longer saves anything: it opens a preview sorted by confidence with a tick box per item (High and Medium ticked, Low not), editable name, amount, cycle and category, and the skipped and already-tracked counts. "Add N selected" is disabled when nothing is ticked, and items you already track are shown unticked and disabled.
- **Undo.** After an import, an Undo toast (30 seconds) removes exactly the rows that import added; deleting a subscription now shows an Undo toast (10 seconds) instead of a confirm box. Ctrl/Cmd+Z works while a toast is showing, and the toast is the first Tab stop after the skip link.
- **Reminder settings.** Choose 1, 3 and/or 7 days before a renewal. Each subscription has a bell: mute, or snooze for 1 day, 3 days or a week (snoozes lapse on their own). Muted and snoozed items still count in totals. Free trials ending within 3 days always remind you unless muted or snoozed. Each reminder (subscription, renewal date, window) is shown once, even across reloads, and a blocked-notifications note appears once and can be dismissed. "Renewing soon" now follows your windows and is labelled with the soonest renewal.
- Sample statement `sample-data/mixed-cycles.csv` and a new end-to-end check, `scripts/verify-features.mjs`.

### Changed
- Reminders and "today" use your **local** date (they used UTC before, which could be a day off late in the evening).
- Merging duplicates now keeps every price from every record in the price history, current price last.
- Database schema v5: adds a table that remembers which reminders were shown, and gives existing subscriptions a one-entry price history from their current price. Nothing else moves. The backup format version is unchanged and the new fields are optional, so older backups still restore.
- Removing a subscription no longer asks for confirmation; use Undo.

### Notes
- Verified on the production build: Lighthouse Accessibility, Best Practices and SEO 100, no axe violations on the new screens (preview, toast, bell menu, reminders card) in light and dark at 1280px and 390px, 51 end-to-end feature checks, and everything works offline.

## 0.5.0 - 2026-10-15
### Added
- **Accessibility.** Skip link, one `h1`, a `main` landmark and a sensible heading order. Tabs are real tabs (arrow keys, Home and End) with a tab panel. Dialogs move focus in, keep Tab inside, close on Escape and give focus back to what opened them; only the top dialog reacts when two are stacked. Scan results, errors, "N rows skipped" and backup messages are announced through always-mounted live regions that never repeat the same message on a re-render. Logos are decorative and tiles are named by their visible text. File pickers are real buttons (they were unreachable by keyboard). Focus rings are visible everywhere (3px, high contrast) and keyboard focus on an Explore tile pans it into view.
- **Contrast.** Text and chips meet WCAG AA (4.5:1) in light and dark; form controls have a 3:1 edge. `scripts/contrast.mjs` prints the numbers.
- **Mobile.** Single-column layout under 600px, 44x44px tap targets, `inputmode="decimal"` on amounts, no horizontal scroll down to 320px, a floating "Add subscription" button that sits under dialogs, and safe-area padding. `prefers-reduced-motion` and forced-colors are respected.
- **Offline and updates.** The service worker precaches the app shell with a build-stamped, content-hashed cache name, serves hashed assets cache-first and navigations network-first with a cached fallback, and removes old caches on activate. A new version waits and shows a "Reload to update" banner; nothing reloads by itself and user data in IndexedDB is never touched. An "Offline" chip shows when the connection drops.
- **Install.** An "Install app" button in the new App card (hidden once installed), "Add to Home Screen" guidance on iOS Safari, a full manifest with 192, 512 and maskable icons, an Apple touch icon and iOS meta tags.
- **Sample data.** "Load sample data" in the App card adds clearly labelled fake subscriptions (INR, USD, EUR) behind a confirmation, only into an empty SubSweep, and "Remove sample data" takes exactly those rows out again.
- **Deploy.** `vercel.json` (Vite static build, SPA rewrite, strict Content-Security-Policy with `default-src 'self'`, nosniff, no-referrer, immutable asset caching, no-cache for `sw.js` and `index.html`), `robots.txt`, an MIT `LICENSE`, and `npm run preview:prod`, which serves `dist/` with those same headers.
- Tooling (dev only): `scripts/verify-prod.mjs` and `scripts/verify-update.mjs` check the production build end to end (headers and CSP, keyboard and dialogs, overflow at phone widths, offline cold start, update flow); `scripts/screenshots.mjs` regenerates the README images; `scripts/icons.mjs` renders the PNG icons. They use `playwright-core` with an installed Chrome or Edge, so there is no browser download.
- New app icon and theme colours.

### Fixed
- The service worker no longer auto-activates (`skipWaiting`) and takes over open pages.
- Floating add button could cover buttons inside dialogs on phones.
- Stat cards no longer overflow on narrow screens.

### Notes
- No Dexie schema or backup format changes.
- Measured on the production build: Lighthouse Accessibility, Best Practices and SEO 100; no axe-core violations (WCAG 2.2 A/AA) in light and dark at 1280px and 390px across all tabs and dialogs; Chrome reports the app as installable.

## 0.4.0 - 2026-10-14
### Added
- **Multi-currency.** Every subscription has a currency (default: your base currency, INR out of the box). Pick a base currency and type in manual exchange rates (base units per 1 unit of each currency) in the new Currency panel. Totals, the category bars, the explore board and renewals use the base currency, while each row keeps its native price with the converted amount in small text. A currency with no rate shows "set rate", is left out of totals and is called out in a banner, never treated as 1. Changing the base currency keeps your rates and asks you to review them. No live rate lookups.
- Statement scans pick up a currency from the amount ($, €, £, ₹, Rs, an ISO code) or a Currency column, and fall back to the base currency.
- **Yearly view** with yearly cost by category and per subscription (sortable) plus a **"what you'd save" simulator**: tick Cancel? on items to see the monthly, yearly and 5-year savings. Selections are saved and survive a reload; Clear selection resets them.
- **Insights** at the top of the screen: overlapping services (music, video, storage, news, fitness, design), subscriptions you have not marked "Used recently" in 60 days (45 days if never marked), price hikes and trials about to convert, each with a yearly saving. Dismiss keeps an insight hidden until the underlying set changes; "Review & select" ticks the involved items in the simulator.
- Backup now carries currency, the base currency, rates, selections, last-used dates and dismissed insights. Backups made before this version still restore (their rows are read in the base currency).

### Changed
- Database schema v4: existing subscriptions get `currency` set to your base currency (INR by default); nothing else moves.
- Backup format stays at version 2; the new fields are optional on import.

## 0.3.0 - 2026-10-13
### Added
- **Cancel & verify loop.** From any subscription, "Start cancelling" opens a cancellation kit: steps, a direct account link where known, how hard the service is to leave, and copyable cancellation email and chat-script templates. Record the date you cancelled, the paid-through date and a confirmation number.
- **Still-charging detection.** Scan a later statement and SubSweep checks it against what you cancelled. A matching charge after the paid-through date (plus a 2-day grace) is flagged with a one-click dispute message. A statement that covers a full billing cycle after that date with no charge marks the cancellation verified.
- Board tiles, list badges and the hero card show Cancelling, Unverified, Verified and Still charging states, plus "Saved per year" from verified cancellations.
- Backup format v2 carries the new fields; v1 backups still restore.
- Sample statements for the flow in `sample-data/` (`cancel-zombie-charge.csv`, `cancel-verified.csv`).
- Brand logos for around 50 services, bundled locally (no network), with brand-coloured monograms for the rest; draggable "Explore" board.

### Changed
- Cancelled and cancelling subscriptions no longer count toward monthly/yearly totals, reminders, the calendar export or duplicate detection.
- Database schema v3 (no data moves; old rows read as active). Merchant names ignore `autopay`, `prepaid` and `mandate`.

## 0.2.0 - 2026-10-13
### Added
- Robust bank CSV import: header aliases (Date / Transaction Date / Posting Date / Value Date, Description / Narration / Details / Merchant / Payee / Particulars, Amount / Debit / Credit / Withdrawal / Deposit / Dr / Cr), single signed amount, separate debit and credit columns, and a Dr/Cr indicator column.
- Date formats YYYY-MM-DD, DD/MM/YYYY, MM/DD/YYYY, DD-MM-YYYY and DD MMM YYYY. Ambiguous dates are resolved from the whole file (day-first by default).
- Amounts with thousands separators, decimal commas, parentheses, currency symbols, trailing minus and Dr/Cr suffixes.
- UTF-8 BOM, comma / semicolon / tab / pipe delimiters, and junk header or footer lines are handled. Unparseable rows are counted and shown as "N rows skipped"; a CSV with no recognisable columns gives a clear error.
- Possible-duplicates banner with Merge and Dismiss (never merges on its own). Dismissed pairs are remembered.
- Scanning a statement skips charges you already track and reports "N already tracked".
- JSON backup download and restore (Merge or Replace), validated in full before a single transaction writes anything.
- `createdAt` and `priceHistory` on subscriptions.

### Changed
- Ambiguous `NN/NN/YYYY` dates now default to day-first (previously month-first) unless the file shows month-first.
- Merchant normalisation ignores payment-rail prefixes such as UPI, NEFT and IMPS.
- Database schema v2: adds `dismissedDuplicates` and `settings` tables. Existing subscriptions are carried over untouched.

## 0.1.0
- Initial release: CSV scan, price-creep flag, manual add/edit, trials, categories, totals, renewals, .ics export, reminders, cancel hints.
