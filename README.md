# SubSweep

Find and track forgotten subscriptions. Everything runs in your browser; statements are parsed locally and stored in IndexedDB.

## Features
- Scan a bank/card statement CSV → detects recurring charges (weekly/monthly/quarterly/yearly) and flags price creep
- Manual add/edit, free-trial flag, categories
- Dashboard: monthly/yearly totals, category breakdown, renewals in the next 7 days
- Reminders: browser notifications (when the app is opened) + `.ics` calendar export with 1-day-before alarms
- "How to cancel" hints per service
- Installable PWA, light/dark mode

## Run
    npm install
    npm run dev      # dev server
    npm test         # detection/ICS tests
    npm run build    # production build in dist/ (deploy to Vercel/Netlify as a static site)

## Notes / next steps
- Browser notifications fire only when the app is opened (a true background push would need a server or Periodic Background Sync); the .ics export covers background reminders.
- CSV layouts: needs date, description and amount (or debit) columns. Statements spanning 3+ months detect best.
