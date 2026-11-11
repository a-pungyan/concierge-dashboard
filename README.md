# Concierge Dashboard

A single-user prototype that puts the concierge team's shift logs, follow-ups and resource links in one place. It is built from the PRD dated Sep 30, 2026.

## Run it

Open `index.html` in a browser. It needs no build step and no server, and it has no dependencies.

## Features

- **Overview:** the day's tasks plus overdue, high-priority and upcoming follow-ups, important notices, recent shift activity and pinned quick links. You can filter by team (Concierge, Maintenance, Leasing, Property Management), so each team sees only its own actionable items.
- **Quick log:** type one line on the Overview and it is filed under the right shift note heading using keyword rules. The destination can be changed before saving.
- **Shift Log:** create and edit entries with unit or name, category, shift, action taken, pending action and date. A pending action can become a follow-up in one step.
- **Follow-ups:** each one has an owner team, an optional assignee, a due date, a priority, a status, a next action and a resolution. Overdue items are flagged, and you can change the status from the table. Marking an item Done requires a resolution.
- **Resources:** links to work systems, SharePoint trackers, SOPs, guides and contacts, with tips and tags. Pin a resource to show it on the Overview.
- **Search and filters:** global search covers everything. Each tab also has its own filters (unit or keyword, date range, category, owner, status, priority).
- **Generate shift note:** builds a handover note from the shift's logs and open follow-ups, grouped by team, ready to copy into an email or Teams. This is the main lever for the PRD's 30% shift note time goal.
- **Data:** see what's stored and export a JSON backup of the shared data.

Keyboard shortcuts: `/` search · `L` new shift log · `F` new follow-up · `N` shift note · `Esc` close or clear.

## Storage and security notes

- Shift logs, follow-ups, notices and resources are saved in Supabase and shared by everyone who signs in. Resident suggestions come from the `occupant_report` table.
- Each shift log records its author. Only the author (or an admin in `app_admins`) can edit or delete it.
- Anyone signed in can add and update follow-ups. Only the creator (or an admin) can delete one.
- Only admins can add, edit or delete resources. Pins are personal and saved in each browser.
- Sign-in uses Supabase Auth. Every table has Row Level Security policies, so these rules are enforced by the database, not just the page.
- If a save fails, an error appears and whatever was entered stays in the form so you can retry.
- The code contains no passwords or secret keys (the Supabase anon key is designed to be public).

## Resident Data Import

The dashboard includes a Python-based data import utility designed to process structured Excel reports and synchronize resident records with a database.

### Features

- **Excel Processing:** Processes multiple Excel files using Python.
- **Data Cleaning:** Standardizes inconsistent data formats, removes duplicate records, and eliminates unnecessary report headers.
- **Data Consolidation:** Combines multiple datasets into a consistent database structure.
- **Database Integration:** Synchronizes processed records with Supabase.
- **Preview Mode:** Allows changes to be reviewed before applying database updates.
- **Credential Security:** Uses environment variables to securely manage database credentials.

### Data Privacy

The public repository is intended to contain only application code and non-sensitive demonstration materials.

Real resident information, proprietary reports, and database credentials must not be included. Synthetic sample data should be used for development and demonstrations.


## Quick log with Claude

Pressing Enter in the Quick log saves the note straight away, filed by the keyword rules. **Tidy with Claude** is optional: it sends the line to Claude (Haiku) to tidy the wording and choose the heading, and shows the result to check before saving. Resident names, emails and phone numbers are replaced with placeholders in the browser before sending and restored afterwards.

Quick log also suggests residents and vendors as you type. A vendor that isn't in `data.js` is suggested once it has been logged twice; deleting or correcting those logs removes it.

Pasting rows from the guest suite tracker into the Quick log (unit, name, suite, check-in, check-out) creates one log per booking. Nothing is sent to Claude, and bookings already logged are skipped.

To turn it on, get an API key from the Anthropic Console, set a monthly spend limit, then run from the project folder:

```
npx supabase login
npx supabase secrets set ANTHROPIC_API_KEY=your-key --project-ref yodrtjrweyrnwnsqrcom
npx supabase functions deploy quick-log-ai --project-ref yodrtjrweyrnwnsqrcom
```

## Files

- `index.html` contains the page shell and dialogs.
- `styles.css` contains the styles, including responsive layouts and a dark theme.
- `quick-entry.js` contains the Quick log keyword rules. Their keywords and the guest suite list are in `data.js`.
- `supabase/functions/quick-log-ai/` is the server function that calls Claude for the Quick log.
- `data.js` contains the options lists, fictional sample data and the test-record generator.
- `app.js` contains storage, rendering, forms, search and the shift note generator.

### Resident upload screen

Dashboard admins can open **Data → Import residents**, select one or more `.xlsx`, `.xls`, or `.csv` reports, preview the cleaned list, and confirm replacement. Include current, future, and notice residents together when appropriate. The first worksheet of each workbook is read. Files are parsed in the browser using the [SheetJS standalone reader](https://docs.sheetjs.com/docs/getting-started/installation/standalone/); only unit, first name, last name and relationship are sent to Supabase. The preview removes duplicate residents and flags a drop below half the loaded list.

One-time database setup: run `supabase/migrations/202611070001_resident_upload.sql` in the project's Supabase SQL editor. It creates the `import_residents` RPC, restricted to users in `app_admins`. Replacement is transactional: an insert failure rolls back deletion of the previous residents. No service-role key is exposed to the browser. Until that migration is installed, previews work but importing shows a setup-required message. The existing Python importer remains available.

## Notice of Entry

Available in both dashboards from the overview, the hamburger menu, or a resident search result. Select the intended leaseholders, fill in the common entry details, and review the names and rental address for each unit. Preview produces one notice per unit using the wording of the supplied form. The fixed example deadline is replaced with the selected last entry date (or the single entry date). Company, property, contact and sender are editable; the second dashboard has no first-property contact defaults.

Use **Print / Save PDF** to open the browser's print dialog, or **Copy text** to prepare an email. For the clean paper layout, leave browser print headers/footers off. Notices are not emailed automatically, stored in the database, or sent to Claude. Changes invalidate the preview before printing, and closing/signing out clears the notice draft. The builder fills the supplied template; staff still review recipient names, addresses, wording and dates before issuing it.

Implementation: `notice-entry.js` and `notice-entry.css`, mirrored in `workspace-2/`. No SQL setup is required. The original uploaded Word file is a reference, not a public download asset.
