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
- **Data:** export or import a JSON backup of this browser's follow-ups, reset them to sample data, or add 500 test follow-ups to check performance.

Keyboard shortcuts: `/` search · `L` new shift log · `F` new follow-up · `N` shift note · `Esc` close or clear.

## Storage and security notes

- Shift logs and notices are saved in Supabase (`shift_logs` and `notices` tables), shared by everyone who signs in. Resident suggestions come from the `occupant_report` table.
- Resources are saved in Supabase (`resources` table). Everyone who signs in can read them; only users listed in `app_admins` can add, edit or delete them. Pins are personal and saved in each browser.
- Follow-ups are still saved in this browser's `localStorage`.
- Sign-in uses Supabase Auth. Every table needs Row Level Security policies for the `authenticated` role.
- Saves are atomic. If a save fails, an error appears and whatever was entered stays in the form so you can retry.
- All sample data is fictional. Replace the placeholder resource links with real ones from the Resources tab. Linked systems still use their own logins.
- The code contains no passwords or API secrets.

## Files

- `index.html` contains the page shell and dialogs.
- `styles.css` contains the styles, including responsive layouts and a dark theme.
- `data.js` contains the options lists, fictional sample data and the test-record generator.
- `app.js` contains storage, rendering, forms, search and the shift note generator.
