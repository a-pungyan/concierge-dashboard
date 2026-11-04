/* Quick log: works out where a one-line shift note belongs and pulls out the form fields.
   Keyword rules only, nothing leaves the browser. The keywords live in data.js (QUICK_ENTRY). */

const qeEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Position of a whole word or phrase in the text, or -1.
function qeFind(text, phrase) {
  const m = new RegExp(`(^|[^a-z0-9])${qeEscape(phrase.toLowerCase())}(?![a-z0-9])`).exec(text.toLowerCase());
  return m ? m.index + m[1].length : -1;
}

// Finds the first keyword in a { keyword: name } map, longest keyword first so "sky lounge" beats "sky".
function qeMatch(text, keywords, { startOnly = false } = {}) {
  const words = Object.keys(keywords).sort((a, b) => b.length - a.length);
  for (const word of words) {
    const at = qeFind(text, word);
    if (at === 0 || (at > 0 && !startOnly)) return { name: keywords[word], start: at, end: at + word.length };
  }
  return null;
}

const qeKeywords = (names, aliases) => ({
  ...Object.fromEntries(names.map((n) => [n.toLowerCase(), n])),
  ...aliases,
});
const qeAreas = () => qeKeywords(SUGGESTIONS.areas, QUICK_ENTRY.areas);
const qeListedVendors = () => qeKeywords(SUGGESTIONS.vendors, QUICK_ENTRY.vendors);
const qeVendors = () => ({ ...Object.fromEntries(learnedVendors.map((v) => [v.toLowerCase(), v])), ...qeListedVendors() });

let learnedVendors = []; // vendors picked up from past logs, set by setLearnedVendors

/* Vendors staff have logged at least twice that aren't on the list in data.js. One log isn't
   enough, so a one-off typo never becomes a suggestion. Near-copies of a listed vendor are
   treated as typos too, and a name made up only of resident names is taken to be a person
   logged by mistake. Deleting or correcting those logs removes a learned vendor. */
function findLearnedVendors(logs, occupants = []) {
  const { names } = qeNames(occupants);
  const isPerson = (key) => key.split(/[^\p{L}'’-]+/u).filter(Boolean).every((w) => names.has(w));
  const listed = SUGGESTIONS.vendors.map((v) => v.toLowerCase());
  const seen = new Map(); // lowercase name -> how often each spelling was used
  logs.filter((l) => l.section === 'operations_events' && l.subtype === 'vendor_contractor').forEach((l) => {
    const name = String(l.unit || '').replace(/\s+/g, ' ').trim();
    const key = name.toLowerCase();
    if (name.length < 2 || name.length > 60 || qeUnits(name).length || listed.includes(key) || isPerson(key)) return;
    if (listed.some((v) => key.length >= 5 && qeEditDistance(key, v) <= 2)) return;
    if (!seen.has(key)) seen.set(key, new Map());
    seen.get(key).set(name, (seen.get(key).get(name) || 0) + 1);
  });
  return [...seen.values()]
    .map((spellings) => [...spellings.entries()].sort((a, b) => b[1] - a[1]))
    .map((sorted) => ({ name: sorted[0][0], uses: sorted.reduce((n, [, count]) => n + count, 0) }))
    .filter((v) => v.uses >= 2)
    .sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name))
    .map((v) => v.name);
}

function setLearnedVendors(logs, occupants) {
  learnedVendors = findLearnedVendors(logs, occupants);
  return learnedVendors;
}
const qeTrackers = () => qeKeywords(SUGGESTIONS.trackers.filter((t) => t !== 'Guest Suite'), QUICK_ENTRY.trackers);

// Units are stored as a letter and four digits, so "e315" means E0315.
function qeUnits(text) {
  return [...text.matchAll(/\b([EW])-?(\d{3,4})\b/gi)].map((m) => ({
    unit: m[1].toUpperCase() + m[2].padStart(4, '0'),
    start: m.index,
    end: m.index + m[0].length,
  }));
}

// Removes part of the line, along with a "to" or "for" that only introduced it.
function qeCut(text, { start, end }) {
  const before = text.slice(0, start).replace(/\b(to|for|at|in)\s+$/i, '');
  return `${before} ${text.slice(end)}`;
}

const qeTrim = (text) => text.replace(/\s+/g, ' ').replace(/^[\s:,;–-]+|[\s:,;–-]+$/g, '');

/* Capitals, spacing and a final period. It tidies the wording, it doesn't rephrase it. */
function tidySentence(text) {
  let out = qeTrim(text);
  if (!out) return '';
  QUICK_ENTRY.properNames.forEach((name) => {
    out = out.replace(new RegExp(`\\b${qeEscape(name)}\\b`, 'gi'), name);
  });
  return out
    .replace(/\b([ew])-?(\d{3,4})\b/gi, (_, l, d) => l.toUpperCase() + d.padStart(4, '0'))
    .replace(/\bi\b/g, 'I')
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/(^|[.!?]\s+)([a-z])/g, (_, p, c) => p + c.toUpperCase())
    .replace(/([^.!?:])$/, '$1.');
}

/* A bookable suite is always a guest suite. A contingency suite can also be lived in, so it
   only counts when the line talks about a guest stay or nobody is listed in the unit. */
function qeSuite(text, occupants) {
  const guestWords = /\bguest suite\b|\bcheck(ed|ing)?[\s-]?(in|out)\b|\bturn[\s-]?over\b|\bbooked\b/i.test(text);
  return qeUnits(text).find(({ unit }) => {
    if (GUEST_SUITES.bookable.includes(unit)) return true;
    if (!GUEST_SUITES.contingency.includes(unit)) return false;
    return guestWords || (occupants.length > 0 && !occupants.some((o) => String(o.unit).toUpperCase() === unit));
  }) || null;
}

/* Who the line is about: a unit (plus the resident, if their first name follows it) or a full
   name. The log shows the person in its unit label, so their name is taken out of the note. */
function qeResident(text, occupants) {
  const found = qeUnits(text)[0];
  if (found) {
    const after = text.slice(found.end);
    const gap = after.match(/^[\s:,–-]*/)[0].length;
    const word = after.slice(gap).split(/[\s,:]/)[0].toLowerCase();
    const person = word && occupants.find((o) => String(o.unit).toUpperCase() === found.unit
      && String(o.first_name || '').split(' ')[0].toLowerCase() === word);
    if (!person) return { unit: found.unit, rest: qeCut(text, found) };
    return { unit: occLabel(person), code: found.unit, rest: qeCut(text, { start: found.start, end: found.end + gap + word.length }) };
  }
  for (const o of occupants) {
    const name = occName(o);
    const at = name.includes(' ') ? qeFind(text, name) : -1;
    if (at >= 0) return { unit: occLabel(o), code: o.unit, rest: qeCut(text, { start: at, end: at + name.length }) };
  }
  return null;
}

/* ---------- Suggestions while typing ---------- */

const qeNorm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// How many single-letter edits apart two words are, so "mohamed" still finds "Mohammad".
function qeEditDistance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}

// 0 = the name starts with what was typed, 1 = a later name does, 2 = close spelling, null = no match.
function qeNameRank(o, query) {
  const words = qeNorm(occName(o)).split(/[^\p{L}'’-]+/u).filter(Boolean);
  if (words[0]?.startsWith(query) || qeNorm(occName(o)).startsWith(query)) return 0;
  if (words.some((w) => w.startsWith(query))) return 1;
  // Close spellings only for long words with the same start, so everyday words don't match.
  const allowed = query.length >= 7 ? 2 : 1;
  if (query.length >= 6 && words.some((w) => w.slice(0, 3) === query.slice(0, 3) && qeEditDistance(w, query) <= allowed)) return 2;
  return null;
}

/* Vendors matching what's typed at the start of the line, which is where the rules look
   for one. Matches the name, any word in it, or a keyword like "wr". */
function qeVendorSuggestions(typed) {
  const query = qeNorm(typed.trimStart());
  if (query.length < 2 || /\d/.test(query)) return [];
  const hit = (phrase) => {
    const p = qeNorm(phrase);
    return p.startsWith(query) || (!query.includes(' ') && p.split(/[^\p{L}]+/u).some((w) => w.startsWith(query)));
  };
  const aliases = Object.entries(QUICK_ENTRY.vendors);
  return [...SUGGESTIONS.vendors, ...learnedVendors]
    .filter((v) => hit(v) || aliases.some(([word, name]) => name === v && hit(word)))
    .map((v) => ({
      label: v, tag: VENDOR_UPDATES[v] ? `Vendor · ${VENDOR_UPDATES[v]}` : 'Vendor', insert: `${v} `, start: 0, end: typed.length,
    }));
}

/* What can finish the word being typed: vendors first, then residents. Picking one replaces
   start..end with insert, so the rules and the log's unit label work from there. */
function quickSuggestions(text, cursor, occupants, limit = 6) {
  if (/[^\s]/.test(text.charAt(cursor))) return null; // only while typing at the end of a word
  const typed = text.slice(0, cursor);
  if (!/[\p{L}\d'’-]$/u.test(typed)) return null;
  const matches = [...qeVendorSuggestions(typed), ...qeResidentSuggestions(typed, occupants)].slice(0, limit);
  return matches.length ? matches : null;
}

function qeResidentSuggestions(typed, occupants) {
  const cursor = typed.length;
  const last = typed.match(/[\p{L}\d][\p{L}\d'’-]*$/u);
  if (!last) return [];
  const start = last.index;
  const earlier = qeUnits(typed.slice(0, start)).at(-1);
  const unitAhead = earlier && /^[\s:,–-]*$/.test(typed.slice(earlier.end, start)) ? earlier : null;
  const word = qeNorm(last[0]);
  const fix = (o) => [o.unit, String(o.first_name || '').split(' ')[0]].filter(Boolean).join(' ');
  const found = (matches, from, insert) => matches.map((o) => ({ label: occLabel(o), tag: o.tenant_category || '', insert: `${insert(o)} `, start: from, end: cursor }));

  // A unit, whole or part: "e315", "w23".
  const unit = last[0].match(/^([EW])-?(\d{2,4})$/i);
  if (unit) {
    const prefix = unit[1].toUpperCase() + unit[2];
    const padded = unit[2].length === 3 ? unit[1].toUpperCase() + unit[2].padStart(4, '0') : '';
    return found(occupants.filter((o) => {
      const u = String(o.unit).toUpperCase();
      return u.startsWith(prefix) || u === padded;
    }), start, fix);
  }

  // A first name after its unit: only that unit's residents, and the unit isn't repeated.
  if (unitAhead) {
    const inUnit = occupants.filter((o) => String(o.unit).toUpperCase() === unitAhead.unit && qeNameRank(o, word) !== null);
    return found(inUnit, start, (o) => String(o.first_name || '').split(' ')[0] || '');
  }
  // Once a line names a unit, other words are the note itself rather than another person.
  if (qeUnits(typed).length) return [];

  // "dana fo" searches the full name and replaces both words.
  const before = typed.slice(0, start).match(/([\p{L}'’-]+)\s+$/u);
  const pair = before ? `${qeNorm(before[1])} ${word}` : '';
  const pairHits = pair ? occupants.filter((o) => qeNorm(occName(o)).startsWith(pair)) : [];
  if (pairHits.length) return found(pairHits, before.index, fix);
  if (word.length < 3 || qeNames(occupants).exempt.has(word)) return [];

  const ranked = occupants
    .map((o) => ({ o, rank: qeNameRank(o, word) }))
    .filter((x) => x.rank !== null)
    .sort((a, b) => a.rank - b.rank || occName(a.o).localeCompare(occName(b.o)));
  return found(ranked.map((x) => x.o), start, fix);
}

const QE_TOUCHPOINT = /\b(30|75|120)[\s-]?days?\b(?!\s+notice)(\s+(touchpoint|call))?|\btouchpoints?\b/i;
const QE_GIFT = /\b(?:fitz\s+)?(?:(\w+)\s+)?gifts?\b/i;
const QE_NOT_GIFT_NAME = ['a', 'an', 'the', 'fitz', 'of', 'delivered', 'pending', 'left'];

/* Returns "section/subtype" for the line, or '' if no rule fits. */
function detectQuickDest(line, occupants = []) {
  const text = qeTrim(line);
  if (!text) return '';
  if (QE_GIFT.test(text)) return 'fitz_gifts/fitz_gift';
  if (/\bno calls?\b/i.test(text)) return 'resident_experience/general_update';
  if (QE_TOUCHPOINT.test(text)) return 'resident_experience/resident_touchpoint';
  if (qeMatch(text, qeTrackers())) return 'operations_events/logs_trackers';
  if (qeSuite(text, occupants) || qeFind(text, 'guest suite') >= 0) return 'operations_events/guest_suite';
  if (qeMatch(text, qeAreas(), { startOnly: true })) return 'amenities_common_areas/area';
  if (qeMatch(text, qeVendors(), { startOnly: true })) return 'operations_events/vendor_contractor';
  if (qeResident(text, occupants)) return 'residents_guests/resident';
  if (QUICK_ENTRY.eventWords.some((w) => qeFind(text, w) >= 0)) return 'operations_events/event';
  if (qeMatch(text, qeAreas())) return 'amenities_common_areas/area';
  return '';
}

/* Pulls the form fields for a destination out of the line. Fields it can't find are left out. */
function quickFields(dest, line, occupants = []) {
  const text = qeTrim(line);
  switch (dest.split('/')[1]) {
    case 'vendor_contractor': {
      const v = qeMatch(text, qeVendors());
      if (!v) return { actionTaken: tidySentence(text) };
      return { unit: v.name, actionTaken: tidySentence(qeCut(text, v)) || VENDOR_UPDATES[v.name] || '' };
    }
    case 'logs_trackers': {
      const t = qeMatch(text, qeTrackers());
      if (!t) return { actionTaken: tidySentence(text) };
      return { unit: t.name, actionTaken: tidySentence(qeCut(text, t)) };
    }
    case 'guest_suite': {
      let rest = text;
      const fields = {};
      const suite = qeSuite(rest, occupants) || qeUnits(rest)[0];
      if (suite) {
        fields.guestSuite = suite.unit;
        rest = qeCut(rest, suite);
      }
      rest = rest.replace(/\bguest suite\b/i, ' ');
      const booked = rest.match(/\bbooked by\s+(.+?)(?=\s+(?:check|checked|checking|for|on|to|has|is)\b|[,.;]|$)/i);
      if (booked) {
        fields.unit = qeTrim(booked[1]).replace(/\b[a-z]/g, (c) => c.toUpperCase());
        rest = rest.replace(booked[0], ' ');
      }
      fields.actionTaken = tidySentence(rest);
      return fields;
    }
    case 'event': {
      const word = QUICK_ENTRY.eventWords.map((w) => ({ w, at: qeFind(text, w) })).find((x) => x.at >= 0);
      if (!word) return { actionTaken: tidySentence(text) };
      const end = word.at + word.w.length;
      const name = qeTrim(text.slice(0, end)).replace(/\b[a-z]/g, (c) => c.toUpperCase());
      return { unit: name, actionTaken: tidySentence(text.slice(end)) };
    }
    case 'resident_touchpoint': {
      const tp = text.match(QE_TOUCHPOINT);
      const fields = { touchpoint: tp?.[1] ? `${tp[1]} Day` : 'Other' };
      const who = qeResident(text.replace(QE_TOUCHPOINT, ' '), occupants);
      if (who) fields.unit = who.unit;
      fields.actionTaken = tidySentence(who ? who.rest : text.replace(QE_TOUCHPOINT, ' '));
      return fields;
    }
    case 'fitz_gift': {
      const who = qeResident(text, occupants);
      let rest = who ? who.rest : text;
      const m = rest.match(QE_GIFT);
      const named = m?.[1] && !QE_NOT_GIFT_NAME.includes(m[1].toLowerCase());
      const fields = { gift: named ? `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} gift` : 'Fitz Gift' };
      if (who) fields.unit = who.unit;
      rest = rest.replace(QE_GIFT, ' ');
      const status = [[/\bdelivered\b/i, 'Delivered'], [/\bpending\b/i, 'Pending'], [/\bleft (at|with|by)\b.*\b(desk|concierge)\b/i, 'Left at concierge desk']]
        .find(([re]) => re.test(rest));
      if (status) {
        fields.giftStatus = status[1];
        rest = rest.replace(status[0], ' ');
      }
      fields.actionTaken = tidySentence(rest);
      return fields;
    }
    case 'resident': {
      const who = qeResident(text, occupants);
      return { category: 'General', ...(who ? { unit: who.unit } : {}), description: tidySentence(who ? who.rest : text) };
    }
    case 'area': {
      const a = qeMatch(text, qeAreas());
      if (!a) return { description: tidySentence(text) };
      // Only an area named first can be lifted out and leave a sentence behind.
      return { unit: a.name, description: tidySentence(a.start === 0 ? text.slice(a.end) : text) };
    }
    default:
      return { actionTaken: tidySentence(text) };
  }
}

/* ---------- Claude ----------
   Only the unit number leaves the browser. Before a line is sent, every word matching a
   resident's name becomes a placeholder like [P1], and emails and phone numbers do too.
   The placeholders are swapped back when the answer returns. */

let qeNameCache = { occupants: null, names: null, exempt: null };

function qeNames(occupants) {
  if (qeNameCache.occupants === occupants) return qeNameCache;
  const names = new Map();
  occupants.forEach((o) => [o.first_name, o.last_name].forEach((part) => {
    const words = String(part || '').match(/[\p{L}][\p{L}'’-]+/gu) || [];
    words.flatMap((w) => [w, ...w.split('-')]).forEach((w) => {
      if (w.length > 1 && !names.has(w.toLowerCase())) names.set(w.toLowerCase(), w);
    });
  }));
  // Words of the building's vendors, areas and trackers are never treated as names.
  // Learned vendors stay out of this: a person logged as a vendor mustn't stop being hidden.
  const known = [...Object.keys(qeListedVendors()), ...Object.keys(qeAreas()), ...Object.keys(qeTrackers()), ...QUICK_ENTRY.properNames];
  const exempt = new Set(known.flatMap((k) => k.toLowerCase().split(/[^\p{L}]+/u)));
  qeNameCache = { occupants, names, exempt };
  return qeNameCache;
}

// A shared swaps list keeps one person on one placeholder across the line and the examples.
function qeRedact(text, occupants, swaps) {
  const { names, exempt } = qeNames(occupants);
  const hold = (value) => {
    let i = swaps.indexOf(value);
    if (i < 0) i = swaps.push(value) - 1;
    return `[P${i + 1}]`;
  };
  return String(text || '')
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, hold)
    .replace(/(?<![\w-])\+?\d[\d\s().-]{7,}\d(?!\w)/g, hold)
    .replace(/[\p{L}][\p{L}'’-]*/gu, (word) => {
      const lower = word.toLowerCase();
      if (!names.has(lower) || exempt.has(lower)) return word;
      // "will" is a word and "Will" is a person. Common words only count when capitalized.
      if (word === lower && QUICK_ENTRY.commonWordNames.includes(lower)) return word;
      return hold(names.get(lower));
    });
}

const qeRestore = (text, swaps) => String(text || '').replace(/\[P(\d+)\]/g, (_, n) => swaps[n - 1] ?? '');

const qeWords = (text) => new Set(String(text || '').toLowerCase().match(/[\p{L}\d]{3,}/gu) || []);

/* Past Quick log entries for Claude to learn from: the ones people corrected, then the ones
   most like this line. Each goes out with names replaced and without the resident's unit label. */
function quickExamples(line, logs, occupants, swaps, limit = 25) {
  const words = qeWords(line);
  const overlap = (l) => [...qeWords(l.details.quickLine)].filter((w) => words.has(w)).length;
  const corrected = (l) => !!l.details.quickEdited || (!!l.updatedAt && l.updatedAt > l.createdAt);
  const past = logs.filter((l) => l.details?.quickLine);
  const fixes = past.filter(corrected).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')).slice(0, 10);
  const similar = past.filter((l) => !fixes.includes(l)).sort((a, b) => overlap(b) - overlap(a)).slice(0, limit - fixes.length);
  return [...fixes, ...similar].map((l) => {
    const destination = `${l.section}/${l.section === 'amenities_common_areas' ? 'area' : l.subtype}`;
    const hasEntity = ['vendor_contractor', 'logs_trackers', 'event', 'area'].includes(destination.split('/')[1]);
    return {
      note: qeRedact(l.details.quickLine, occupants, swaps),
      destination,
      ...(hasEntity ? { entity: qeRedact(l.unit, occupants, swaps) } : {}),
      text: qeRedact(quickMainField(destination) === 'description' ? l.description : l.actionTaken, occupants, swaps),
      ...(l.details.quickEdited || (l.updatedAt && l.updatedAt > l.createdAt) ? { corrected_by_staff: true } : {}),
    };
  });
}

const quickMainField = (dest) => (['resident', 'area'].includes(dest.split('/')[1]) ? 'description' : 'actionTaken');

/* What gets sent to Claude for a line, plus the list needed to swap the names back. */
function quickAiRequest(line, occupants, logs, fixedDest) {
  const swaps = [];
  // Without the resident's name, so Claude can't write it into the note.
  const who = qeResident(qeTrim(line), occupants);
  const payload = {
    line: qeRedact(who?.code ? `${who.code} ${qeTrim(who.rest)}` : line, occupants, swaps),
    keyword_guess: detectQuickDest(line, occupants),
    ...(fixedDest ? { fixed_destination: fixedDest } : {}),
    examples: quickExamples(line, logs, occupants, swaps),
    destinations: SECTIONS.flatMap((sec) => sec.subtypes.map((st) => ({
      id: `${sec.id}/${st.id}`, section: sec.title, type: st.title, about: sec.desc,
    }))),
    categories: OPTIONS.categories,
    // A learned vendor is only shared if it doesn't contain a resident's name.
    vendors: [...SUGGESTIONS.vendors, ...learnedVendors.filter((v) => qeRedact(v, occupants, []) === v).slice(0, 50)],
    areas: SUGGESTIONS.areas,
    trackers: SUGGESTIONS.trackers,
    guest_suites: GUEST_SUITES,
  };
  return { payload, swaps };
}

/* Turns Claude's answer into form fields for a destination. The resident and the unit come
   from the original line here in the browser, never from Claude. */
function quickAiFields(ai, dest, line, occupants) {
  const who = qeResident(qeTrim(line), occupants);
  const resident = who ? { unit: who.unit } : {};
  const main = { [quickMainField(dest)]: ai.text };
  const entity = ai.entity ? { unit: ai.entity } : {};
  switch (dest.split('/')[1]) {
    case 'guest_suite': {
      const suite = qeSuite(line, occupants) || qeUnits(line)[0];
      return { ...main, ...(suite ? { guestSuite: suite.unit } : {}), ...(ai.booked_by ? { unit: ai.booked_by } : {}) };
    }
    case 'resident_touchpoint':
      return { ...main, ...resident, touchpoint: ai.touchpoint || 'Other' };
    case 'fitz_gift':
      return { ...main, ...resident, gift: ai.gift || 'Fitz Gift', ...(ai.gift_status ? { giftStatus: ai.gift_status } : {}) };
    case 'resident':
      return { ...main, ...resident, category: ai.category || 'General' };
    case 'general_operations':
    case 'general_update':
      return main;
    default:
      return { ...main, ...entity };
  }
}

/* ---------- Pasted guest suite bookings ----------
   Rows copied from the tracker, like "E2506 <tab> Name <tab> E1208 <tab> November 04 <tab> November 05".
   Cells are recognized by what they contain, so the column order doesn't matter. */

const QE_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function qeIso(year, month, day) {
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCMonth() === month - 1 && d.getUTCDate() === day ? d.toISOString().slice(0, 10) : '';
}

// "November 04", "Nov 4, 2026", "4 Nov", "11/04", "11/04/2026" or "2026-11-04". Without a year,
// it's the date closest to today, so a December paste of "January 03" means next January.
function qeParseDate(cell, todayIso) {
  const text = cell.trim().toLowerCase().replace(/,/g, ' ');
  let month, day, year;
  let m;
  if ((m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) [year, month, day] = [+m[1], +m[2], +m[3]];
  else if ((m = text.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/))) [month, day, year] = [+m[1], +m[2], m[3] ? +m[3] : 0];
  else if ((m = text.match(/^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+(\d{4}))?$/))) [month, day, year] = [QE_MONTHS.indexOf(m[1].slice(0, 3)) + 1, +m[2], m[3] ? +m[3] : 0];
  else if ((m = text.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?(?:\s+(\d{4}))?$/))) [month, day, year] = [QE_MONTHS.indexOf(m[2].slice(0, 3)) + 1, +m[1], m[3] ? +m[3] : 0];
  else return '';
  if (!month) return '';
  if (year && year < 100) year += 2000;
  if (year) return qeIso(year, month, day);
  const thisYear = +todayIso.slice(0, 4);
  const iso = qeIso(thisYear, month, day);
  if (!iso) return '';
  const daysAway = (Date.parse(iso) - Date.parse(todayIso)) / 86400000;
  return daysAway < -180 ? qeIso(thisYear + 1, month, day) : iso;
}

function qeParseBooking(line, todayIso) {
  const cells = line.split(/\t| {2,}/).map((c) => c.trim()).filter(Boolean);
  const units = [];
  const dates = [];
  const words = [];
  cells.forEach((cell) => {
    const unit = cell.match(/^([EW])-?(\d{3,4})$/i);
    const date = qeParseDate(cell, todayIso);
    if (unit) units.push(unit[1].toUpperCase() + unit[2].padStart(4, '0'));
    else if (date) dates.push(date);
    else words.push(cell);
  });
  const listed = [...GUEST_SUITES.bookable, ...GUEST_SUITES.contingency];
  const suite = [...units].reverse().find((u) => listed.includes(u)) || (units.length > 1 ? units.at(-1) : '');
  if (!suite || !dates.length) return null;
  const [checkIn, secondDate = ''] = dates;
  // A check-out that lands before the check-in crosses into the next year.
  const checkOut = secondDate && secondDate < checkIn ? qeIso(+secondDate.slice(0, 4) + 1, +secondDate.slice(5, 7), +secondDate.slice(8, 10)) : secondDate;
  const booker = units.filter((u) => u !== suite);
  return { bookedBy: [...booker, ...words].join(' '), suite, checkIn, checkOut, listed: listed.includes(suite) };
}

/* Returns the bookings in pasted text, or null if it isn't booking rows. */
function parseGuestBookings(text, todayIso) {
  const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim());
  const rows = lines.map((l) => qeParseBooking(l, todayIso));
  const bookings = rows.filter(Boolean);
  return bookings.length ? { bookings, unread: rows.length - bookings.length } : null;
}
