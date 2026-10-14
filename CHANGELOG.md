# Changelog

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
