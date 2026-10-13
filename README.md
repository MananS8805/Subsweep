# SubSweep

Find and track forgotten subscriptions. Everything runs in your browser; statements are parsed locally and stored in IndexedDB.

## Features
- Scan a bank/card statement CSV → detects recurring charges (weekly/monthly/quarterly/yearly) and flags price creep
- Manual add/edit, free-trial flag, categories
- Possible-duplicates banner: similar subscriptions can be merged (only when you click) or dismissed
- JSON backup and restore (Merge or Replace) so your data is never stuck in one browser
- Dashboard: monthly/yearly totals, category breakdown, renewals in the next 7 days
- Reminders: browser notifications (when the app is opened) + `.ics` calendar export with 1-day-before alarms
- "How to cancel" hints per service
- Installable PWA, light/dark mode

## Run
    npm install
    npm run dev      # dev server
    npm test         # CSV, detection, dedupe, backup and DB-upgrade tests
    npm run build    # production build in dist/ (deploy to Vercel/Netlify as a static site)

## Notes / next steps
- Browser notifications fire only when the app is opened (a true background push would need a server or Periodic Background Sync); the .ics export covers background reminders.
- Statements spanning 3+ months detect best.

## Supported CSV formats
- **Columns** (case-insensitive): date = Date / Transaction Date / Posting Date / Value Date; description = Description / Narration / Details / Merchant / Payee / Particulars; amount = a single signed Amount, separate Debit + Credit (or Withdrawal + Deposit) columns, or Amount + a Dr/Cr column.
- **Dates**: YYYY-MM-DD, DD/MM/YYYY, MM/DD/YYYY, DD-MM-YYYY, DD MMM YYYY. If every date is ambiguous (both parts 12 or less) SubSweep reads them day-first; any date with a part above 12 settles day-first or month-first for the whole file.
- **Amounts**: `1,234.56`, `1.234,56`, `12,99`, `(15.49)`, `$-15.49`, `15.49-`, `1,299.00 Dr`.
- UTF-8 BOM, comma / semicolon / tab delimiters and junk lines above the header are fine. Only outflows are treated as subscription candidates, so refunds and credits are ignored. Rows that cannot be read are counted ("N rows skipped").
- Test samples live in `src/fixtures/`.

## Backup and restore
Use **Download backup** to save `subsweep-backup-YYYY-MM-DD.json` (subscriptions, dismissed duplicates, settings). **Restore from backup** offers *Merge* (adds missing, skips ids that already exist) or *Replace* (asks first). Files are validated completely before anything is written; wrong-app files, newer formats and malformed JSON are rejected with a message and your data is left untouched. Backups never leave your device.
