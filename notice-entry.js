/* Notice of Entry: all resident selection and document preparation stays in this browser. */
const EntryNotice = (() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const date = value => new Date(`${value}T12:00:00`).toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const time = value => { const [h, m] = value.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
  function addressFor(unit, defaults = {}) {
    const prefix = String(unit || '').trim().charAt(0).toUpperCase();
    return defaults.addressByPrefix?.[prefix] || '';
  }
  function group(people) {
    const units = new Map();
    for (const person of people) {
      const unit = String(person.unit || '').trim();
      const name = [person.first_name, person.last_name].filter(Boolean).join(' ').trim();
      if (!unit || !name) continue;
      const key = unit.toUpperCase().replace(/\s/g, '');
      if (!units.has(key)) units.set(key, { unit, names: [], seen: new Set() });
      const entry = units.get(key), normalized = name.toLowerCase().replace(/\s+/g, ' ');
      if (!entry.seen.has(normalized)) { entry.names.push(name); entry.seen.add(normalized); }
    }
    return [...units.values()].map(({ unit, names }) => ({ unit, names: names.join(', ') }));
  }
  function paragraphs(values, recipient) {
    return [
      'NOTICE OF ENTRY',
      'Pursuant to Section 27 of the Residential Tenancies Act, 2006 (Ontario)',
      `Tenant(s): ${recipient.names}`,
      `Rental unit: ${recipient.unit}, ${recipient.address}`,
      `Date of notice: ${date(values.noticeDate)}`,
      "Please accept this email as written notice that the landlord, or persons acting on the landlord's behalf, will enter your rental unit on the following dates and times:",
      `Date of entry: ${date(values.entryDate)}`,
      `Time of entry: Between the hours of ${time(values.startTime)} - ${time(values.endTime)}`,
      `Reason for entry: ${values.reason}`,
      `Persons entering: Representatives of ${values.company} and ${values.property} staff.`,
      `Multiple entries may be required within the period above. If any work remains after ${date(values.entryDate)}, a new notice of entry will be provided before any further entry.`,
      `If you have any entry requests, such as pets that need to be secured or anything else we should know, please inform the concierge team before the date of entry.`,
      'Sincerely,', values.sender,
    ];
  }
  function html(values, recipient) {
    return `<article class="entry-paper">${paragraphs(values, recipient).map((p, i) => i === 0 ? `<h1>${escape(p)}</h1>` : `<p class="entry-line-${i}">${escape(p)}</p>`).join('')}</article>`;
  }
  const printCSS = `@page { size: letter; margin: 1in; } body { margin: 0; background: #fff; color: #000; } .entry-paper { font: 12pt/1.2 "Times New Roman", serif; overflow-wrap: anywhere; break-after: page; } .entry-paper:last-child { break-after: auto; } .entry-paper h1 { font: bold 14pt/1.2 "Times New Roman", serif; text-align: center; margin: 0; } .entry-paper p { margin: 0; white-space: pre-wrap; } .entry-paper .entry-line-1 { text-align: center; font-size: 14pt; margin-bottom: 24pt; } .entry-paper .entry-line-5, .entry-paper .entry-line-6, .entry-paper .entry-line-10, .entry-paper .entry-line-11, .entry-paper .entry-line-12 { margin-top: 12pt; }`;
  return { escape, addressFor, group, paragraphs, html, printCSS, time };
})();

(() => {
  const e = EntryNotice.escape;
  const timeValues = Array.from({ length: 17 }, (_, index) =>
    `${String(9 + Math.floor(index / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}`);
  const minuteOfDay = value => { const [hours, minutes] = value.split(':').map(Number); return hours * 60 + minutes; };
  const optionsFor = values => '<option value="">Choose time…</option>' + values.map(value =>
    `<option value="${value}">${EntryNotice.time(value)}</option>`).join('');
  const timeOptions = optionsFor(timeValues.slice(0, -1));
  const dialog = document.createElement('dialog');
  dialog.id = 'entry-notice-dialog'; dialog.className = 'entry-notice-dialog';
  dialog.setAttribute('aria-labelledby', 'entry-notice-title');
  dialog.innerHTML = `<form id="entry-notice-form">
    <header class="entry-dialog-head"><div><h2 id="entry-notice-title">Notice of Entry</h2><p class="muted small">Select the leaseholders, fill in the entry details, and review one notice per unit.</p></div><button type="button" class="btn btn-ghost" data-entry-close aria-label="Close Notice of Entry">Close</button></header>
    <div class="entry-editor">
      <section class="entry-residents" aria-labelledby="entry-resident-heading"><h3 id="entry-resident-heading">Residents</h3>
        <label for="entry-resident-search" class="sr-only">Search residents by unit or name</label><input id="entry-resident-search" type="search" placeholder="Search unit or name…" autocomplete="off">
        <div class="entry-selection-actions"><button type="button" class="link-btn small-link" id="entry-select-visible">Select matches</button><button type="button" class="link-btn small-link" id="entry-clear">Clear selection</button></div>
        <p class="muted small" id="entry-selection-count" role="status"></p><div id="entry-resident-list" class="entry-resident-list"></div>
        <button type="button" class="btn btn-sm btn-ghost" id="entry-reload-residents">Refresh resident list</button>
      </section>
      <section class="entry-fields" aria-labelledby="entry-details-heading"><h3 id="entry-details-heading">Entry details</h3>
        <div class="grid-2"><label>Property name<input name="property" maxlength="120" required></label><label>Date of notice<input type="date" name="noticeDate" required></label></div>
        <label>Entry date<input type="date" name="entryDate" required></label>
        <div class="grid-2"><label>From<select name="startTime" required>${timeOptions}</select></label><label>Until<select name="endTime" required disabled aria-describedby="entry-time-hint"><option value="">Choose a start time first</option></select></label></div>
        <p id="entry-time-hint" class="muted small">Up to 4 hours, between 9 AM and 5 PM.</p>
        <label>Reason for entry<textarea name="reason" rows="2" maxlength="1500" required></textarea></label>
        <label>Company entering<input name="company" maxlength="200" required></label>
        <label>Sender name<input name="sender" maxlength="200" required></label>
        <datalist id="entry-address-options"></datalist>
        <p class="muted small">Review tenant names and addresses for the selected units below.</p>
        <div id="entry-recipients" class="entry-recipients"></div>
      </section>
    </div>
    <p id="entry-error" class="form-error" role="alert" hidden></p>
    <div class="dialog-actions"><span class="spacer"></span><button type="submit" class="btn btn-primary">Preview notices</button><button type="button" class="btn" id="entry-print" disabled>Print / Save PDF</button><button type="button" class="btn" id="entry-copy" disabled>Copy text</button></div>
    <p id="entry-output-status" class="small muted" role="status"></p>
    <section id="entry-preview" aria-label="Notice previews" hidden></section>
  </form>`;
  document.body.append(dialog);
  const form = dialog.querySelector('form'), find = id => dialog.querySelector(`#${id}`);
  let people = [], selected = new Set(), edits = new Map(), reviewed = null, owner = null, frame = null;
  const fields = form.elements;
  const defaults = typeof ENTRY_NOTICE_DEFAULTS === 'undefined' ? {} : ENTRY_NOTICE_DEFAULTS;
  function updateEndTimes() {
    const start = fields.startTime.value;
    const previous = fields.endTime.value;
    const allowed = start ? timeValues.filter(value => value > start && minuteOfDay(value) - minuteOfDay(start) <= 240) : [];
    fields.endTime.innerHTML = start ? optionsFor(allowed) : '<option value="">Choose a start time first</option>';
    fields.endTime.disabled = !start;
    fields.endTime.value = allowed.includes(previous) ? previous : '';
  }
  fields.startTime.addEventListener('change', () => { updateEndTimes(); invalidate(); });
  function invalidate() {
    reviewed = null; find('entry-preview').hidden = true; find('entry-preview').replaceChildren();
    find('entry-print').disabled = find('entry-copy').disabled = true;
    find('entry-output-status').textContent = ''; find('entry-error').hidden = true;
  }
  function showError(message) { find('entry-error').textContent = message; find('entry-error').hidden = false; }
  function groups() { return EntryNotice.group([...selected].map(i => people[i]).filter(Boolean)); }
  function matching() {
    const terms = find('entry-resident-search').value.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return people.map((person, index) => ({ person, index })).filter(({ person }) => terms.every(term => [person.unit, person.first_name, person.last_name].join(' ').toLowerCase().includes(term)));
  }
  function renderList() {
    const matches = matching();
    find('entry-resident-list').innerHTML = matches.length ? matches.map(({ person, index }) => `<label class="check entry-resident"><input type="checkbox" data-person="${index}"${selected.has(index) ? ' checked' : ''}><span><strong>${e(person.unit)}</strong> ${e([person.first_name, person.last_name].filter(Boolean).join(' '))}<small class="muted">${e(person.tenant_category || '')}</small></span></label>`).join('') : `<p class="empty">${people.length ? 'No matching residents.' : 'No residents loaded. Import residents under Data, or refresh this list after loading completes.'}</p>`;
    find('entry-selection-count').textContent = `${selected.size} selected · ${groups().length} units · ${matches.length} matches`;
  }
  function renderRecipients() {
    const recipients = groups();
    find('entry-recipients').innerHTML = recipients.map(({ unit, names }) => {
      const edit = edits.get(unit) || {};
      return `<fieldset class="entry-recipient"><legend>${e(unit)}</legend><label>Tenant names<input data-unit="${e(unit)}" data-recipient-field="names" maxlength="1000" required value="${e(edit.names ?? names)}"></label><label>Rental address<input data-unit="${e(unit)}" data-recipient-field="address" list="entry-address-options" maxlength="250" required value="${e(edit.address ?? EntryNotice.addressFor(unit, defaults))}" placeholder="Street address, city, province"></label></fieldset>`;
    }).join('');
  }
  function selectionChanged() { invalidate(); renderList(); renderRecipients(); }
  function loadPeople() { people = occupants.map(person => ({ ...person })); selected.clear(); edits.clear(); reviewed = null; selectionChanged(); }
  function open(personIndex) {
    if (document.body.classList.contains('signed-out') || !currentUser) return;
    if (dialog.open) return;
    owner = currentUser.id;
    form.reset(); updateEndTimes(); invalidate(); loadPeople();
    fields.property.value = SHIFT_NOTE.property === 'Property' ? '' : SHIFT_NOTE.property;
    fields.noticeDate.value = today(); fields.sender.value = currentUser.name || '';
    find('entry-address-options').innerHTML = (defaults.addresses || []).map(address => `<option value="${e(address)}"></option>`).join('');
    find('entry-resident-search').value = '';
    if (Number.isInteger(personIndex) && people[personIndex]) selected.add(personIndex);
    selectionChanged();
    dialog.showModal(); find('entry-resident-search').focus();
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-notice-open]');
    if (!button) return;
    const index = button.dataset.noticeResident;
    open(index === undefined ? undefined : Number(index));
  });
  dialog.querySelector('[data-entry-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    selected.clear(); edits.clear(); people = []; owner = null; form.reset(); invalidate();
    find('entry-resident-list').replaceChildren(); find('entry-recipients').replaceChildren();
    if (frame) { frame.remove(); frame = null; }
  });
  new MutationObserver(() => {
    if (document.body.classList.contains('signed-out') && dialog.open) dialog.close();
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  find('entry-resident-search').addEventListener('input', renderList);
  find('entry-select-visible').addEventListener('click', () => {
    const before = new Map(groups().map(group => [group.unit, group.names]));
    matching().forEach(({ index }) => selected.add(index));
    groups().forEach(group => {
      if (before.get(group.unit) !== group.names && edits.has(group.unit)) delete edits.get(group.unit).names;
    });
    selectionChanged();
  });
  find('entry-clear').addEventListener('click', () => { selected.clear(); edits.clear(); selectionChanged(); });
  find('entry-reload-residents').addEventListener('click', () => { loadPeople(); });
  find('entry-resident-list').addEventListener('change', event => {
    const input = event.target.closest('[data-person]'); if (!input) return;
    const index = Number(input.dataset.person), unit = people[index]?.unit;
    input.checked ? selected.add(index) : selected.delete(index);
    if (edits.has(unit)) delete edits.get(unit).names;
    selectionChanged();
    find('entry-resident-list').querySelector(`[data-person="${index}"]`)?.focus();
  });
  form.addEventListener('input', event => {
    if (event.target.id === 'entry-resident-search') return;
    invalidate();
    if (event.target === fields.startTime) updateEndTimes();
    const input = event.target;
    if (input.dataset.recipientField) {
      const edit = edits.get(input.dataset.unit) || {};
      edit[input.dataset.recipientField] = input.value;
      edits.set(input.dataset.unit, edit);
    }
  });
  form.addEventListener('submit', event => {
    event.preventDefault(); invalidate();
    if (!currentUser || owner !== currentUser.id) return showError('Please sign in and reopen Notice of Entry.');
    if (!selected.size) return showError('Select at least one resident.');
    if (groups().length > 100) return showError('Prepare up to 100 units at a time.');
    if (!form.reportValidity()) return;
    const values = Object.fromEntries(['property','noticeDate','entryDate','startTime','endTime','reason','company','sender'].map(name => [name, fields[name].value.trim()]));
    if (['property','reason','company','sender'].some(name => !values[name])) return showError('Complete the entry details; spaces alone cannot be used.');
    if (values.noticeDate > values.entryDate) return showError('The date of notice cannot be after the entry date.');
    if (!timeValues.slice(0, -1).includes(values.startTime) || !timeValues.includes(values.endTime)) return showError('Choose entry times between 9 AM and 5 PM in half-hour intervals.');
    if (minuteOfDay(values.endTime) - minuteOfDay(values.startTime) > 240) return showError('The entry window cannot exceed 4 hours.');
    if (values.endTime <= values.startTime) return showError('The end time must be later than the start time.');
    const recipients = groups().map(group => ({ ...group, names: (edits.get(group.unit)?.names ?? group.names).trim(), address: (edits.get(group.unit)?.address ?? EntryNotice.addressFor(group.unit, defaults)).trim() }));
    if (recipients.some(recipient => !recipient.names || !recipient.address)) return showError('Every unit needs tenant names and a complete address.');
    reviewed = { values, recipients, owner };
    find('entry-preview').innerHTML = recipients.map(recipient => EntryNotice.html(values, recipient)).join('');
    find('entry-preview').hidden = false;
    find('entry-print').disabled = find('entry-copy').disabled = false;
    find('entry-output-status').textContent = `${recipients.length} notice${recipients.length === 1 ? '' : 's'} ready to review. Each unit has its own notice. Nothing has been sent.`;
    find('entry-preview').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
  });
  const validReview = () => reviewed && reviewed.owner === currentUser?.id && !document.body.classList.contains('signed-out');
  find('entry-print').addEventListener('click', () => {
    if (!validReview()) return;
    if (frame) frame.remove();
    frame = document.createElement('iframe'); frame.className = 'entry-print-frame'; frame.title = 'Notices prepared for printing';
    frame.setAttribute('sandbox', 'allow-same-origin allow-modals');
    frame.onload = () => {
      if (!validReview() || !frame?.contentWindow) return;
      frame.contentWindow.focus(); frame.contentWindow.print();
    };
    frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><title>Notice of Entry</title><style>${EntryNotice.printCSS}</style></head><body>${reviewed.recipients.map(recipient => EntryNotice.html(reviewed.values, recipient)).join('')}</body></html>`;
    document.body.append(frame);
  });
  find('entry-copy').addEventListener('click', async () => {
    if (!validReview()) return;
    try {
      await navigator.clipboard.writeText(reviewed.recipients.map(recipient => EntryNotice.paragraphs(reviewed.values, recipient).join('\n\n')).join('\n\n\n'));
      find('entry-output-status').textContent = 'Notice text copied. Review it before sending.';
    } catch (_) { showError('Clipboard access was blocked. You can select the preview text to copy it, or print instead.'); }
  });
})();
