/* Files are parsed in this browser; only the four cleaned resident fields are sent. */
function cleanResidentRows(raw) {
  const aliases = {
    unit: ['unit', 'unit code', 'unit number', 'unit no', 'apt', 'apartment', 'suite'],
    first_name: ['first name', 'firstname', 'first', 'given name'],
    last_name: ['last name', 'lastname', 'last', 'surname'],
    name: ['name', 'resident', 'resident name', 'tenant', 'tenant name', 'occupant', 'occupant name'],
    tenant_category: ['tenant category', 'category', 'relationship', 'occupant type', 'type', 'role'],
  };
  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  let cols, header = -1;
  for (let i = 0; i < Math.min(30, raw.length); i++) {
    const found = {};
    raw[i].forEach((value, index) => {
      const heading = clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      for (const [key, names] of Object.entries(aliases)) {
        if (!(key in found) && names.includes(heading)) found[key] = index;
      }
    });
    if ('unit' in found && ('name' in found || ('first_name' in found && 'last_name' in found))) {
      cols = found; header = i; break;
    }
  }
  if (!cols) throw new Error('No Unit and Resident name headings found in the first 30 rows. Use a resident report with those columns.');
  let unit = '';
  const rows = [];
  for (const record of raw.slice(header + 1)) {
    const get = key => clean(record[cols[key]]);
    const nextUnit = get('unit');
    if (/total|unit|report/i.test(nextUnit)) { unit = ''; continue; }
    unit = nextUnit || unit;
    if (!unit || !/\d/.test(unit)) continue;
    let first = get('first_name'), last = get('last_name');
    if (!('first_name' in cols && 'last_name' in cols)) {
      const parts = get('name').split(' ');
      first = parts.length > 1 ? parts.shift() : '';
      last = parts.join(' ');
    }
    if (!(first || last)) continue;
    if (Math.max(first.length, last.length, get('tenant_category').length) > 200 || unit.length > 100) {
      throw new Error('A resident field is too long. Check the report columns before importing.');
    }
    rows.push({ unit: unit.toUpperCase().replace(/\s/g, ''), first_name: first || null, last_name: last || null, tenant_category: get('tenant_category') || null });
  }
  return rows;
}

(() => {
  const files = document.getElementById('resident-files');
  const preview = document.getElementById('resident-upload-preview');
  const status = document.getElementById('resident-upload-status');
  const confirm = document.getElementById('resident-replace-confirm');
  const save = document.getElementById('resident-import-btn');
  const inspect = document.getElementById('resident-preview-btn');
  let pending = null, parsing = false, saving = false, owner = null;
  function reset() {
    pending = null; owner = null; preview.hidden = true; confirm.checked = false; save.disabled = true;
    document.getElementById('resident-preview-rows').replaceChildren();
    status.textContent = '';
  }
  files.addEventListener('change', reset);
  document.getElementById('data-dialog').addEventListener('close', () => {
    reset(); files.value = '';
  });
  confirm.addEventListener('change', () => { save.disabled = saving || !pending || !confirm.checked; });
  let library;
  function loadReader() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (!library) library = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
      script.onload = () => resolve(window.XLSX);
      script.onerror = () => { library = null; script.remove(); reject(new Error('Could not load the spreadsheet reader. Check your connection and try again.')); };
      document.head.append(script);
    });
    return library;
  }
  inspect.addEventListener('click', async () => {
    if (parsing || saving) return;
    reset();
    const selected = [...files.files];
    if (!selected.length) { status.textContent = 'Choose one or more resident reports first.'; return; }
    if (selected.some(file => !/\.(xlsx|xls|csv)$/i.test(file.name)) || selected.reduce((sum, file) => sum + file.size, 0) > 20 * 1024 * 1024) {
      status.textContent = 'Choose Excel or CSV reports totalling no more than 20 MB.'; return;
    }
    parsing = true; inspect.disabled = true; files.disabled = true;
    status.textContent = 'Reading reports…';
    const userId = currentUser?.id;
    try {
      const reader = await loadReader();
      const unique = new Map();
      let total = 0;
      for (const file of selected) {
        const workbook = reader.read(await file.arrayBuffer(), { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        let rows;
        try { rows = cleanResidentRows(reader.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false })); }
        catch (error) { throw new Error(`${file.name}: ${error.message}`); }
        if (!rows.length) throw new Error(`${file.name}: no residents found. Nothing has been changed.`);
        for (const row of rows) {
          total++;
          unique.set(JSON.stringify([row.unit, row.first_name?.toLowerCase(), row.last_name?.toLowerCase()]), row);
        }
      }
      if (!unique.size || unique.size > 20000) throw new Error('The import must contain between 1 and 20,000 residents.');
      if (currentUser?.id !== userId || !document.getElementById('data-dialog').open) return;
      pending = [...unique.values()]; owner = userId;
      const summary = `${pending.length} residents across ${new Set(pending.map(row => row.unit)).size} units. ${total - pending.length} duplicates removed. Current list: ${occupants.length} residents.`;
      status.textContent = summary + (occupants.length && pending.length < occupants.length / 2 ? ' This is less than half your current list—check that all reports are included.' : '');
      document.getElementById('resident-preview-rows').innerHTML = pending.slice(0, 50).map(row => `<tr><td>${esc(row.unit)}</td><td>${esc([row.first_name, row.last_name].filter(Boolean).join(' '))}</td><td>${esc(row.tenant_category || '')}</td></tr>`).join('');
      preview.hidden = false;
    } catch (error) { status.textContent = error.message; }
    finally { parsing = false; inspect.disabled = false; files.disabled = false; }
  });
  save.addEventListener('click', async () => {
    if (saving || !pending || !confirm.checked) return;
    if (!owner || currentUser?.id !== owner) { reset(); status.textContent = 'Please sign in and preview the reports again.'; return; }
    saving = true; save.disabled = true; inspect.disabled = true; files.disabled = true; confirm.disabled = true;
    status.textContent = 'Importing residents…';
    try {
      const { data, error } = await sb.rpc('import_residents', { residents: pending });
      if (error) {
        if (error.code === 'PGRST202') throw new Error('The upload screen is ready, but database setup is still required. Run the resident-upload SQL migration in Supabase first.');
        if (/DELETE requires a WHERE clause/i.test(error.message)) throw new Error('The database import function needs the updated SQL migration (202611090001_fix_resident_upload.sql). Your existing resident list has not changed.');
        throw new Error(error.message);
      }
      reset(); files.value = '';
      await loadOccupants();
      status.textContent = `Imported ${data} residents. Search and quick-log suggestions are updated.`;
    } catch (error) { status.textContent = `Import failed: ${error.message}`; }
    finally {
      saving = false; save.disabled = !pending || !confirm.checked;
      inspect.disabled = false; files.disabled = false; confirm.disabled = false;
    }
  });
})();
