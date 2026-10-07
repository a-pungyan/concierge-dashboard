# Concierge Dashboard

A single-user prototype that puts the concierge team's shift logs, follow-ups and resource links in one place. It is built from the PRD dated Sep 30, 2026.

## Run it

Open `index.html` in a browser. It needs no build step and no server, and it has no dependencies.

## Features

- **Overview:** the day's tasks plus overdue, high-priority and upcoming follow-ups, important notices, recent shift activity and pinned quick links. You can filter by team (Concierge, Maintenance, Leasing, Property Management), so each team sees only its own actionable items.
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

## Updating residents from Yardi

Export three Occupant Reports from Yardi as Excel and save them in the project folder, replacing last time's files:

- `residents.xlsx`: current residents
- `future.xlsx`: future residents (moving in, or moved in but still "Future" in Yardi)
- `notice.xlsx`: residents on notice (still living here, but moving out)

Then run this from the project folder:

```
python3 -m venv .venv && .venv/bin/pip install -r tools/requirements.txt   # first time only
.venv/bin/python tools/import_residents.py            # preview, changes nothing
.venv/bin/python tools/import_residents.py --apply    # replace occupant_report
```

The script cleans the exports (header rows, unit spacing, units only shown on a household's first line, duplicate lines and totals), combines them and replaces the `occupant_report` table with the result. Only unit, name and relationship are imported. It needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env`. It runs on your computer only, because the service_role key must never be in the website.

## Files

- `index.html` contains the page shell and dialogs.
- `styles.css` contains the styles, including responsive layouts and a dark theme.
- `data.js` contains the options lists, fictional sample data and the test-record generator.
- `app.js` contains storage, rendering, forms, search and the shift note generator.
