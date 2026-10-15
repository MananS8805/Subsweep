# SubSweep

Find, understand and get out of forgotten subscriptions. SubSweep reads your bank statement, spots the recurring charges, tells you what they really cost per year, and checks that a cancellation actually stopped the charges.

![The SubSweep explore board: every subscription is a card, bigger when it costs more](docs/screenshots/explore-board.png)

> **Live demo:** SubSweep isn't deployed yet. It is a static site and is ready for Vercel (see [Deploy to Vercel](#deploy-to-vercel)), and you can run it locally in a minute (see [Run, build and test](#run-build-and-test)). The screenshots here come from the production build with the built-in sample data.

## Privacy promise
**Everything stays in your browser.** Statements are parsed on your device, subscriptions are stored in IndexedDB, and nothing is uploaded. There are no accounts, no analytics, no third-party scripts, fonts or logo services, and no live exchange-rate lookups (you type rates in yourself). The deployed site ships a strict Content-Security-Policy (`default-src 'self'`) so the page cannot talk to anyone else even if something went wrong. Backups are files you download and keep.

## Features
- Scan a bank or card statement CSV: finds recurring charges (weekly, monthly, quarterly, yearly) and flags price creep
- Manual add and edit, free-trial flag, categories, brand logos (bundled, never fetched)
- Possible-duplicates banner: similar subscriptions can be merged (only when you click) or dismissed
- Multi-currency totals with manual exchange rates, a yearly cost view, a "what you'd save" simulator, and overlap / unused insights
- Cancel & verify: a cancellation kit per service, tracking of what you cancelled, a check that charges really stopped and a dispute message if they did not
- JSON backup and restore (Merge or Replace)
- Reminders: browser notifications (when the app is opened) and an `.ics` calendar export with 1-day-before alarms
- Installable PWA that works offline, with a safe in-app update prompt
- Keyboard-operable, screen-reader friendly, light and dark themes, phone-friendly layout

## Screenshots

| | |
|---|---|
| **Yearly view and "what you'd save" simulator.** Tick *Cancel?* to see monthly, yearly and 5-year savings. | **Insights.** Overlapping services, unused subscriptions, price hikes and trials about to convert. |
| ![Yearly view with the savings simulator](docs/screenshots/desktop-yearly.png) | ![Insight cards](docs/screenshots/desktop-insights.png) |
| **Cancel kit.** Steps, a direct account link, how hard the service is to leave, and message templates. | **Still charging.** A charge after the paid period is flagged, with a dispute message ready to copy. |
| ![Cancellation kit](docs/screenshots/cancel-kit.png) | ![Still being charged banner](docs/screenshots/still-charging.png) |
| **Scan a statement.** Recurring charges are found for you, with price creep called out. | **Missing rates are never ignored.** The item is left out of totals and you are told. |
| ![Statement scan results](docs/screenshots/scan-results.png) | ![Missing exchange rate warning](docs/screenshots/missing-rate.png) |
| **Settings.** Base currency, manual rates, install, sample data. | **Light theme.** Follows your system setting. |
| ![Settings](docs/screenshots/desktop-settings.png) | ![Light theme](docs/screenshots/light-theme.png) |

**The main list**

![The list view with totals, renewals, categories and every subscription](docs/screenshots/desktop-list.png)

**On a phone** (single column, large tap targets, an always-reachable add button)

<p>
  <img src="docs/screenshots/mobile-list.png" alt="Phone: list view" width="190">
  <img src="docs/screenshots/mobile-yearly.png" alt="Phone: yearly view" width="190">
  <img src="docs/screenshots/mobile-insights.png" alt="Phone: insights" width="190">
  <img src="docs/screenshots/mobile-settings.png" alt="Phone: settings" width="190">
</p>

## Try it with sample data
Open the **App** card (near the bottom) and choose **Load sample data**. It asks first, adds clearly labelled fake subscriptions in INR, USD and EUR, and shows a banner while they are loaded. It only works in an empty SubSweep so it can never mix with your own data, and **Remove sample data** deletes exactly those rows again. It shows insights, a verified cancellation, a still-charging one and a trial about to end.

Other samples in [`sample-data/`](sample-data):
- [`us-credit-card.csv`](sample-data/us-credit-card.csv), [`indian-bank.csv`](sample-data/indian-bank.csv): use **Scan statement**
- [`cancel-zombie-charge.csv`](sample-data/cancel-zombie-charge.csv), [`cancel-verified.csv`](sample-data/cancel-verified.csv): scan one after starting to cancel a service
- [`demo-backup.json`](sample-data/demo-backup.json): restore with **Restore from backup**

## Run, build and test
```bash
npm install
npm run dev            # dev server
npm test               # unit tests (CSV, detection, dedupe, backup, currency, insights, a11y helpers, PWA build)
npx tsc --noEmit       # type check
npm run build          # production build in dist/ (also stamps the service worker)
npm run preview        # Vite's preview server
npm run preview:prod   # serves dist/ with the exact headers from vercel.json (CSP, caching)
```

End-to-end checks of the production build (need Chrome or Edge installed; `playwright-core` is a dev dependency and downloads no browser):
```bash
npm run build && npm run preview:prod         # terminal 1
node scripts/verify-prod.mjs                  # terminal 2: headers/CSP, keyboard, dialogs, no overflow at 320-1280px, offline cold start
node scripts/verify-update.mjs                # service worker update flow (banner, no auto-reload, data untouched)
npm run screenshots                           # regenerate docs/screenshots
npm run icons                                 # re-render the PNG icons from public/icon.svg
npm run contrast                              # print the contrast ratios for the colour tokens
```

## Deploy to Vercel
SubSweep is a static Vite app; there are no environment variables and no server code.
1. Push the repository to GitHub (done if you are reading this there).
2. In Vercel choose **Add New... > Project** and import the repository.
3. Framework Preset: **Vite** (picked up from `vercel.json`). Build command `npm run build`, output directory `dist`. Leave environment variables empty.
4. Deploy. [`vercel.json`](vercel.json) adds the single-page-app rewrite, a strict Content-Security-Policy (`default-src 'self'`, no external connections), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, long immutable caching for `/assets/*`, and `no-cache` for `index.html` and `sw.js` so updates are picked up.
5. Open the URL on your phone and use **Install app** (Chrome) or **Share > Add to Home Screen** (iOS Safari).

Any other static host works too; copy the headers from `vercel.json`. The CSP keeps `style-src 'self'` because the app sets styles through the DOM rather than inline `style` attributes in HTML. If you add inline `<style>` blocks, you will need `'unsafe-inline'` for styles.

## Offline, installing and updates
- After the first load the app shell is cached, so SubSweep opens and works with no connection. Your data is in IndexedDB and never leaves the device.
- When a new version is deployed, the old one keeps running and a **Reload to update** banner appears. Nothing reloads by itself, so an open form is never lost, and the banner is covered while a dialog is open.
- The service worker only registers in production builds. A failure to register is logged and never breaks the app.

## Accessibility
Keyboard-only use works throughout: a skip link, real tabs (arrow keys, Home, End), dialogs that trap focus, close on Escape and return focus, visible focus rings, labelled controls, and live regions for status messages. Text meets WCAG AA contrast in both themes and tap targets are at least 44x44px on phones. On the production build, Lighthouse scores Accessibility 100 and axe-core reports no violations (WCAG 2.2 A/AA) in light and dark at desktop and phone widths.

## Supported CSV formats
- **Columns** (case-insensitive): date = Date / Transaction Date / Posting Date / Value Date; description = Description / Narration / Details / Merchant / Payee / Particulars; amount = a single signed Amount, separate Debit + Credit (or Withdrawal + Deposit) columns, or Amount + a Dr/Cr column; an optional Currency column.
- **Dates**: YYYY-MM-DD, DD/MM/YYYY, MM/DD/YYYY, DD-MM-YYYY, DD MMM YYYY. If every date is ambiguous (both parts 12 or less) SubSweep reads them day-first; any date with a part above 12 settles day-first or month-first for the whole file.
- **Amounts**: `1,234.56`, `1.234,56`, `12,99`, `(15.49)`, `$-15.49`, `15.49-`, `1,299.00 Dr`, with `$ € £ ₹ Rs` or an ISO code picked up as the currency.
- UTF-8 BOM, comma / semicolon / tab delimiters and junk lines above the header are fine. Only outflows are treated as subscription candidates, so refunds and credits are ignored. Rows that cannot be read are counted ("N rows skipped").
- Statements spanning 3+ months detect best. Test samples live in `src/fixtures/`.

## Currency
Pick a **base currency** in the Currency card (default INR). Each subscription has its own currency; scans read it from the amount or a Currency column and otherwise use the base. For anything not in the base currency, type a rate meaning "base units per 1 unit" (for example 1 USD = 83 INR). Rates are manual and never fetched. A subscription without a rate is shown with **set rate**, excluded from totals and reported in a banner. Changing the base keeps your rates but asks you to review them, because they now mean something different. Rounding happens only when numbers are displayed.

## Yearly view and savings simulator
The **Yearly** tab shows what everything costs per year (and over 5 years) in your base currency, by category and per subscription. Tick **Cancel?** on items to see what dropping them would save per month, per year and over 5 years. Ticks are saved on your device; **Clear selection** resets them.

## Insights
Cards at the top flag: services that overlap (two or more music, video, storage, news, fitness or design subscriptions; keeping the priciest, the rest is the saving), subscriptions you have not marked **Used recently** in 60 days (or 45 days if you never did), price increases, and trials about to convert. **Dismiss** hides one until the underlying set changes; **Review & select** ticks the involved items in the simulator.

## Cancel & verify
1. Open a subscription and choose **Start cancelling**. You get the steps, a direct account link where known, a heads-up if the service is hard to leave, and email / chat-script templates you can copy.
2. Cancel on the provider's site, then record the date you cancelled, the paid-through date and any confirmation number.
3. Later, **Scan statement** with a newer CSV. If a matching charge appears more than 2 days after your paid-through date, the subscription is flagged **Still charging** with a ready-to-send dispute message. If the statement spans a full billing cycle after that date with no such charge, it is marked **Verified** and counted in "Saved per year".

Cancelled items stay on the board but are excluded from totals, reminders and the calendar export. Templates are a starting point, not legal advice, and cancellation steps can change, so always confirm on the provider's site.

## Backup and restore
Use **Download backup** to save `subsweep-backup-YYYY-MM-DD.json` (subscriptions, dismissed duplicates, settings). **Restore from backup** offers *Merge* (adds missing, skips ids that already exist) or *Replace* (asks first). Files are validated completely before anything is written; wrong-app files, newer formats and malformed JSON are rejected with a message and your data is left untouched. Backups never leave your device.

## Limitations
- Browser notifications fire only when the app is opened (a true background push needs a server, which SubSweep deliberately does not have); the `.ics` export covers background reminders.
- Data lives in one browser on one device. Use backups to move or protect it, and note that clearing site data deletes it.
- Exchange rates are manual and not updated for you.
- Detection works from statement patterns, so a charge needs to repeat (two or more times) to be recognised, and merchant names are shortened to their first meaningful word.
- Direct cancellation links and steps are best-effort and can go stale.
- Brand logos are bundled for around 50 services; others get a coloured monogram. Trademarks belong to their owners.

## License
[MIT](LICENSE)
