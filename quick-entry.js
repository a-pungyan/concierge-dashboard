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
const qeVendors = () => qeKeywords(SUGGESTIONS.vendors, QUICK_ENTRY.vendors);
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

/* Who the line is about: a unit (plus the resident, if their first name follows it) or a full name. */
function qeResident(text, occupants) {
  const found = qeUnits(text)[0];
  if (found) {
    const rest = qeCut(text, found);
    const after = text.slice(found.end).replace(/^[\s:,–-]+/, '');
    const word = after.split(/[\s,:]/)[0].toLowerCase();
    const person = word && occupants.find((o) => String(o.unit).toUpperCase() === found.unit
      && String(o.first_name || '').split(' ')[0].toLowerCase() === word);
    if (!person) return { unit: found.unit, rest };
    const first = String(person.first_name).split(' ')[0];
    return { unit: occLabel(person), rest: rest.replace(new RegExp(`\\b${qeEscape(word)}\\b`, 'i'), first) };
  }
  for (const o of occupants) {
    const name = occName(o);
    const at = name.includes(' ') ? qeFind(text, name) : -1;
    if (at >= 0) {
      return { unit: occLabel(o), rest: `${text.slice(0, at)}${o.first_name}${text.slice(at + name.length)}` };
    }
  }
  return null;
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
