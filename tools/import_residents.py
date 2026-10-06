"""Import the Yardi occupant exports into the Supabase occupant_report table.

Save the two Yardi Occupant Report exports in the project folder as:
    residents.xlsx   current residents
    future.xlsx      future residents (moving in, or moved in but still "Future" in Yardi)

Together they are treated as the full list of residents: after a successful
import the table holds exactly the people in those files. Only unit, name and
relationship are imported; contact details and other personal columns in the
export (email, phone, DOB, ...) are ignored.

Usage (from the project folder):
    .venv/bin/python tools/import_residents.py            # preview only
    .venv/bin/python tools/import_residents.py --apply    # write to Supabase

Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env. The service_role key
bypasses Row Level Security, so it must only ever live in .env, never in the website.
"""

import argparse
import os
import re
import sys
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv
from supabase import create_client

TABLE = 'occupant_report'
ROOT = Path(__file__).resolve().parent.parent
CURRENT_FILE = 'residents'
FUTURE_FILE = 'future'

# Yardi column headings (lowercased, punctuation stripped) -> occupant_report column.
COLUMN_ALIASES = {
    'unit': ['unit', 'unit code', 'unit number', 'unit no', 'apt', 'apartment', 'suite'],
    'first_name': ['first name', 'firstname', 'first', 'given name'],
    'last_name': ['last name', 'lastname', 'last', 'surname'],
    'name': ['name', 'resident', 'resident name', 'tenant', 'tenant name', 'occupant', 'occupant name'],
    'tenant_category': ['tenant category', 'category', 'relationship', 'occupant type', 'type', 'role'],
}

# If more than this share of the current rows would disappear, require --force.
MAX_SHRINK = 0.5


def normalize_heading(value):
    return re.sub(r'[^a-z0-9]+', ' ', str(value).lower()).strip()


def match_columns(headings):
    """Map our column names to the index of the matching Yardi heading."""
    found = {}
    for i, heading in enumerate(headings):
        h = normalize_heading(heading)
        for col, aliases in COLUMN_ALIASES.items():
            if col not in found and h in aliases:
                found[col] = i
    return found


def find_header_row(raw):
    """Yardi puts report titles above the table, so look for the row with a Unit heading."""
    for i in range(min(len(raw), 30)):
        cols = match_columns(raw.iloc[i].tolist())
        if 'unit' in cols and len(cols) >= 2:
            return i, cols
    sys.exit('Could not find a header row with a "Unit" column in the first 30 rows. '
             'Check that this is the occupant export.')


def clean_text(value):
    if pd.isna(value):
        return None
    text = re.sub(r'\s+', ' ', str(value)).strip()
    return text or None


def split_name(full):
    """Yardi writes "First Middle Last". The first word is the first name and everything
    after it is the last name, matching earlier imports. Commas are kept as written
    (e.g. two people on one lease)."""
    if not full:
        return None, None
    parts = full.split(' ', 1)
    return (parts[0], parts[1]) if len(parts) == 2 else (None, parts[0])


def find_export(name):
    """residents.xlsx (or .xls) in the project folder, or None if it isn't there."""
    for ext in ('.xlsx', '.xls'):
        path = ROOT / (name + ext)
        if path.exists():
            return path
    return None


def row_key(row):
    return (row['unit'], (row['first_name'] or '').lower(), (row['last_name'] or '').lower())


def load_rows(path):
    raw = pd.read_excel(path, header=None, dtype=str)
    header_row, cols = find_header_row(raw)
    if not ({'first_name', 'last_name'} <= cols.keys() or 'name' in cols):
        sys.exit('Found a Unit column but no name column(s). Headings seen: '
                 + ', '.join(str(h) for h in raw.iloc[header_row].dropna()))
    print(f'Header found on row {header_row + 1}. Columns used: '
          + ', '.join(f'{c} <- "{raw.iat[header_row, i]}"' for c, i in cols.items()))

    rows = []
    unit = None
    for _, record in raw.iloc[header_row + 1:].iterrows():
        get = lambda col: clean_text(record.iloc[cols[col]]) if col in cols else None

        # Yardi prints the unit only on the household's first line. A blank unit means
        # this person (roommate, spouse, ...) lives in the unit above.
        unit = get('unit') or unit
        if 'name' in cols and not ({'first_name', 'last_name'} <= cols.keys()):
            first, last = split_name(get('name'))
        else:
            first, last = get('first_name'), get('last_name')

        if not (first or last):
            continue  # blank spacer, subtotal or footer line
        if not unit or not re.search(r'\d', unit) or 'total' in unit.lower():
            continue

        rows.append({
            'unit': unit.upper().replace(' ', ''),
            'first_name': first,
            'last_name': last,
            'tenant_category': get('tenant_category'),
        })
    return rows


def connect():
    load_dotenv(ROOT / '.env')
    url = os.environ.get('SUPABASE_URL', '')
    key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    if not url or not key:
        sys.exit('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.')
    # The client wants the project URL, not the REST endpoint.
    url = re.sub(r'/rest/v1/?$', '', url.rstrip('/'))
    return create_client(url, key)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--apply', action='store_true', help='write to Supabase (default is a preview)')
    parser.add_argument('--force', action='store_true', help=f'allow the import to remove more than {MAX_SHRINK * 100:.0f}%% of current rows')
    args = parser.parse_args()

    current_path = find_export(CURRENT_FILE)
    if not current_path:
        sys.exit(f'Save the current Occupant Report as {CURRENT_FILE}.xlsx in {ROOT}')
    future_path = find_export(FUTURE_FILE)

    # One row per person per unit. Yardi repeats a person for each extra vehicle or pet,
    # and someone can be in both reports; the current report wins.
    rows, seen = [], set()
    for path in filter(None, [current_path, future_path]):
        print(f'\n{path.name}')
        added = 0
        for row in load_rows(path):
            if row_key(row) not in seen:
                seen.add(row_key(row))
                rows.append(row)
                added += 1
        print(f'{added} residents added from {path.name}.')
    if not future_path:
        print(f'\nNote: no {FUTURE_FILE}.xlsx found, so future residents are not included.')
    if not rows:
        sys.exit('No resident rows found.')

    units = {r['unit'] for r in rows}
    print(f'\nCleaned {len(rows)} residents across {len(units)} units in total.')
    print(pd.DataFrame(rows).head(10).to_string(index=False))

    sb = connect()
    current = sb.table(TABLE).select('id', count='exact').order('id', desc=True).limit(1).execute()
    current_count = current.count or 0
    max_old_id = current.data[0]['id'] if current.data else 0
    print(f'\n{TABLE} currently has {current_count} rows; it will have {len(rows)} after import.')

    if current_count and len(rows) < current_count * (1 - MAX_SHRINK) and not args.force:
        sys.exit('That is a big drop, so nothing was changed. Check the file, or rerun with --force.')
    if not args.apply:
        print('\nPreview only, nothing was changed. Rerun with --apply to update Supabase.')
        return

    # Insert the new rows first (one request, so all or nothing), then remove the old ones.
    # The table is never empty, and a failed insert leaves the old list untouched.
    sb.table(TABLE).insert(rows).execute()
    if max_old_id:
        sb.table(TABLE).delete().lte('id', max_old_id).execute()
    print(f'Done. {TABLE} now has {len(rows)} residents.')


if __name__ == '__main__':
    main()
