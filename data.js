/* Constants and fictional sample data for the Concierge Dashboard prototype.
   All names and units below are made up. Resources are managed in Supabase. */

/* Shift note template settings. */
const SHIFT_NOTE = {
  property: 'Ledbury',
  signOff: 'Andrea',
};

const OPTIONS = {
  // Categories for Residents & Guests logs and for follow-ups.
  categories: ['Package', 'Maintenance', 'Resident request', 'Access / keycard', 'Amenity booking', 'Security', 'Noise / complaint', 'Leasing', 'Move in / out', 'Guest / visitor', 'Incident', 'General'],
  teams: ['Concierge', 'Maintenance', 'Leasing', 'Property Management'],
  priorities: ['High', 'Medium', 'Low'],
  statuses: ['Open', 'In progress', 'Waiting', 'Done'],
  resourceGroups: ['Work systems', 'SharePoint trackers', 'SOPs', 'Guides & tips', 'Contacts'],
  shifts: ['Morning', 'Afternoon', 'Overnight'],
};

/* Overview quick-access sidebar. Leave url empty to use the Resource with the same name
   (or the name given in "resource"), which the admin manages on the Resources tab.
   If neither is set, the item shows greyed out until a link is added. */
const QUICK_ACCESS = [
  {
    title: 'Frequently Used',
    links: [
      { name: 'Yardi', url: '' },
      { name: 'Rise', url: '' },
      { name: 'LuxerOne', url: '' },
      { name: 'Sharepoint', url: '' },
      { name: '88Q Credentials', url: '' },
      { name: 'SP+ Parking', url: '' },
    ],
  },
  {
    title: 'Trackers',
    links: [
      { name: 'Guest Suite', url: '' },
      { name: 'Guest Keycard', url: '' },
      { name: 'Live Events', url: '' },
      { name: '4S & Corporate Stays', url: '' },
      { name: 'Elevator OOS', url: '' },
    ],
  },
];

/* Current weather on the Overview, from Open-Meteo (free, no API key needed).
   Set a place name (e.g. 'Toronto') or exact coordinates. Leave both empty to hide it. */
const WEATHER = {
  location: '',
  latitude: null,
  longitude: null,
  unit: 'celsius', // or 'fahrenheit'
};

/* Suggestions for free-text fields (people can still type their own value). */
const SUGGESTIONS = {
  trackers: ['Snow Log', 'Live Event Tracker', 'Package Tracker', 'Key & Fob Tracker', 'Incident Tracker', 'Amenity Booking Tracker'],
  vendors: ['White Rose', 'SPA'],
  areas: ['Curb Appeal', 'Ledbury Chutes', 'LIDO', 'Sky Lounge', 'STOA', 'Dining / Boardroom', 'Yoga Room', 'The Temple', 'North Court', 'Sports Lounge', 'Ski Simulator', 'F1 Simulator', 'Lobby', 'Elevators', 'Other Common Area'],
};

/* ---------- Shift log types ----------
   Every log belongs to one section of the shift note (section) and one subtype.
   Each subtype has its own form. Field names map to shift_logs columns:
   unit, category, description, actionTaken, pendingAction, guestSuite, checkIn;
   touchpoint, gift and giftStatus are stored in the "details" column. */

const F = {
  resident: (label = 'Unit / Resident') => ({ name: 'unit', label, required: true, list: 'occupant-list', placeholder: 'Type a unit or resident name' }),
  pending: { name: 'pendingAction', label: 'Pending action', type: 'textarea', rows: 2, placeholder: 'Leave blank if nothing is pending' },
};

const SECTIONS = [
  {
    id: 'operations_events',
    title: 'Operations & Events',
    desc: 'Building operations, trackers, vendors, guest suites and events.',
    examples: ['Snow Log', 'Live Event Tracker', 'White Rose on site', 'Guest Suite check-in', 'Thanksgiving Donation Drive', 'Matcha Workshop'],
    ask: 'What kind of Operations & Events update is this?',
    subtypes: [
      { id: 'logs_trackers', title: 'Logs & Trackers', fields: [
        { name: 'unit', label: 'Log or tracker', required: true, list: 'tracker-list', placeholder: 'e.g. Snow Log' },
        { name: 'actionTaken', label: 'Status / update', type: 'textarea', required: true, placeholder: 'e.g. No new snowfall was recorded during this shift.' },
        F.pending,
      ] },
      { id: 'vendor_contractor', title: 'Vendor / Contractor', fields: [
        { name: 'unit', label: 'Vendor', required: true, list: 'vendor-list', placeholder: 'e.g. White Rose' },
        { name: 'actionTaken', label: 'Update', required: true, placeholder: 'e.g. On site for cleaning.' },
        { name: 'description', label: 'Additional detail', type: 'textarea', rows: 2, placeholder: 'e.g. Given Amazon delivery of extra pod holders.' },
        F.pending,
      ] },
      { id: 'guest_suite', title: 'Guest Suite', fields: [
        F.resident('Booked by'),
        { name: 'guestSuite', label: 'Guest suite', required: true, placeholder: 'e.g. E511' },
        { name: 'checkIn', label: 'Check-in date', type: 'date', required: true },
        { name: 'actionTaken', label: 'Status / note', type: 'textarea', required: true, placeholder: 'e.g. Previous guest has checked out, kindly ask WR to clean in the morning.' },
        F.pending,
      ] },
      { id: 'event', title: 'Event', fields: [
        { name: 'unit', label: 'Event', required: true, placeholder: 'e.g. Matcha Workshop' },
        { name: 'actionTaken', label: 'Details', type: 'textarea', required: true, placeholder: 'What happened or what is planned' },
        F.pending,
      ] },
      { id: 'general_operations', title: 'General Operations', fields: [
        { name: 'actionTaken', label: 'Update', type: 'textarea', required: true, placeholder: 'Operational information for this shift' },
        F.pending,
      ] },
    ],
  },
  {
    id: 'resident_experience',
    title: 'Resident Experience',
    desc: 'Completed or upcoming resident touchpoints and resident experience updates.',
    examples: ['30-day touchpoint', '75-day touchpoint', '120-day touchpoint', 'No calls made this shift'],
    ask: 'What kind of Resident Experience update is this?',
    subtypes: [
      { id: 'resident_touchpoint', title: 'Resident Touchpoint', fields: [
        F.resident(),
        { name: 'touchpoint', label: 'Touchpoint type', type: 'select', required: true, options: ['30 Day', '75 Day', '120 Day', 'Other'] },
        { name: 'actionTaken', label: 'Notes / details', type: 'textarea', required: true, placeholder: 'e.g. Called to check in; resident is enjoying the building.' },
        F.pending,
      ] },
      { id: 'general_update', title: 'General Resident Experience Update', fields: [
        { name: 'actionTaken', label: 'Update', type: 'textarea', required: true, placeholder: 'e.g. No calls made this shift, will resume tomorrow.' },
        F.pending,
      ] },
    ],
  },
  {
    id: 'fitz_gifts',
    title: 'Fitz Gifts',
    desc: 'Fitz Gift deliveries, distributions or related updates.',
    examples: ['Gift delivered', 'Gift pending', 'No Fitz Gifts this shift'],
    subtypes: [
      { id: 'fitz_gift', title: 'Fitz Gift', fields: [
        F.resident(),
        { name: 'gift', label: 'Gift / occasion', required: true, placeholder: 'e.g. Birthday gift' },
        { name: 'giftStatus', label: 'Status', type: 'select', required: true, options: ['Delivered', 'Pending', 'Left at concierge desk', 'Other'] },
        { name: 'actionTaken', label: 'Notes', type: 'textarea', rows: 2, placeholder: 'Optional' },
        F.pending,
      ] },
    ],
  },
  {
    id: 'residents_guests',
    title: 'Residents & Guests',
    desc: 'Updates involving a specific resident, unit or guest.',
    examples: ['FedEx return left for pickup', 'Yardi occupants updated', 'Resident request', 'Keycard/access issue', 'Resident incident'],
    subtypes: [
      { id: 'resident', title: 'Resident / Guest', fields: [
        F.resident('Unit or name'),
        { name: 'category', label: 'Category', type: 'select', options: OPTIONS.categories },
        { name: 'description', label: 'Description', type: 'textarea', required: true, placeholder: 'e.g. Resident dropped off FedEx pickup return.' },
        { name: 'actionTaken', label: 'Action taken', type: 'textarea', rows: 2, placeholder: 'e.g. Stored in Ledbury back office.' },
        F.pending,
      ] },
    ],
  },
  {
    id: 'amenities_common_areas',
    title: 'Amenities, Common Areas & Curb Appeal',
    desc: 'Amenity conditions, common-area issues, building presentation and curb appeal.',
    examples: ['Curb Appeal', 'Ledbury Chutes', 'LIDO', 'Sky Lounge', 'Elevator/common-area condition'],
    // The subtype is the chosen area, e.g. "curb_appeal".
    subtypes: [
      { id: 'area', title: 'Area', fields: [
        { name: 'unit', label: 'Area', required: true, list: 'area-list', placeholder: 'Choose or type an area' },
        { name: 'description', label: 'Status / update', type: 'textarea', required: true, placeholder: 'e.g. Operational upon departure.' },
        { name: 'actionTaken', label: 'Action taken', type: 'textarea', rows: 2, placeholder: 'Optional' },
        F.pending,
      ] },
    ],
  },
];

const SECTION_BY_ID = Object.fromEntries(SECTIONS.map((s) => [s.id, s]));

/* Logs saved before sections existed only have a category; this maps them. */
const LEGACY_CATEGORY_SECTION = {
  'Logs and trackers': ['operations_events', 'logs_trackers'],
  'Vendor / contractor': ['operations_events', 'vendor_contractor'],
  'Guest suite': ['operations_events', 'guest_suite'],
  Event: ['operations_events', 'event'],
  'Resident touchpoint': ['resident_experience', 'resident_touchpoint'],
  'Fitz gift': ['fitz_gifts', 'fitz_gift'],
  'Amenity / common area': ['amenities_common_areas', ''],
};

const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dayOffset(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const SAMPLE_NAMES = ['A. Chen', 'M. Okafor', 'L. Moreau', 'D. Singh', 'R. Alvarez', 'K. Nakamura', 'S. Haddad', 'T. Novak', 'P. Mensah', 'J. Rivera'];

function sampleUnit() {
  const floor = 2 + Math.floor(Math.random() * 22);
  const unit = 1 + Math.floor(Math.random() * 12);
  return `${floor}${String(unit).padStart(2, '0')}`;
}

function sampleData() {
  const now = new Date().toISOString();
  const fu = (title, unit, category, owner, dueOff, priority, status, nextAction = '', resolution = '', assignee = '') => ({
    id: uid(), title, unit, category, owner, assignee, dueDate: dayOffset(dueOff), priority, status, nextAction, resolution, createdAt: now, updatedAt: now,
  });

  return {
    version: 1,
    followups: [
      fu('Inspect leak under kitchen sink', '807', 'Maintenance', 'Maintenance', 0, 'High', 'Open', 'Tech to visit before noon; permission to enter given.'),
      fu('Service call for P2 garage gate', 'P2 garage', 'Security', 'Maintenance', -1, 'High', 'In progress', 'Vendor booked — confirm arrival time.', '', 'D. Singh'),
      fu('Send noise letter to 702', '702', 'Noise / complaint', 'Property Management', -2, 'Medium', 'Open', 'Draft letter using noise template.'),
      fu('Confirm guest suite availability', 'M. Okafor', 'Guest / visitor', 'Leasing', 1, 'Medium', 'Waiting', 'Reply to resident by email.'),
      fu('Issue replacement fob once paid', '1911', 'Resident request', 'Concierge', 2, 'Low', 'Waiting', 'Check ledger for payment.'),
      fu('Review camera footage for tailgating', 'Lobby', 'Security', 'Property Management', -1, 'High', 'Open', 'Pull 1:55–2:20am clip.'),
      fu('Add party room booking to tracker', '1510', 'Amenity booking', 'Concierge', 0, 'Low', 'Open', 'Amenity booking tracker in SharePoint.'),
      fu('Fix front entrance door closer', 'Lobby', 'Maintenance', 'Maintenance', 3, 'Medium', 'Open', 'Create work order.'),
      fu('Remind resident about bike box pickup', '1204', 'Package', 'Concierge', 1, 'Low', 'Open', 'Call if not picked up by tomorrow.'),
      fu('Replace hallway light on 14th floor', '14th floor', 'Maintenance', 'Maintenance', -4, 'Low', 'Done', '', 'Bulb replaced by maintenance.'),
    ],
  };
}

/* Generates bulk fictional follow-ups for the 500-record performance target. */
function bulkTestFollowups(count) {
  const now = new Date().toISOString();
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  return Array.from({ length: count }, (_, i) => {
    const unit = Math.random() < 0.8 ? sampleUnit() : pick(SAMPLE_NAMES);
    const category = pick(OPTIONS.categories);
    const status = pick(OPTIONS.statuses);
    return {
      id: uid(), title: `Test follow-up #${i + 1} (${category})`, unit, category, owner: pick(OPTIONS.teams), assignee: '',
      dueDate: dayOffset(Math.floor(Math.random() * 40) - 20), priority: pick(OPTIONS.priorities), status,
      nextAction: 'Test next action.', resolution: status === 'Done' ? 'Resolved (test).' : '', createdAt: now, updatedAt: now,
    };
  });
}
