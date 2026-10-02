/* Constants and fictional sample data for the Concierge Dashboard prototype.
   All names, units and links below are made up. Replace resource links with
   your real systems from the Resources tab (they are stored in this browser). */

const OPTIONS = {
  categories: ['Package', 'Maintenance', 'Resident request', 'Amenity booking', 'Security', 'Noise / complaint', 'Leasing', 'Move in / out', 'Guest / visitor', 'General'],
  teams: ['Concierge', 'Maintenance', 'Leasing', 'Property Management'],
  priorities: ['High', 'Medium', 'Low'],
  statuses: ['Open', 'In progress', 'Waiting', 'Done'],
  resourceGroups: ['Work systems', 'SharePoint trackers', 'SOPs', 'Guides & tips', 'Contacts'],
  shifts: ['Morning', 'Afternoon', 'Overnight'],
};

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

function sampleResources() {
  const r = (group, name, url, notes, tags = '') => ({ id: uid(), group, name, url, notes, tags, pinned: false });
  return [
    r('Work systems', 'Property management system', 'https://example.com/pms', 'Resident profiles, unit info, ledgers. Search by unit number first — faster than by name.', 'yardi, residents'),
    r('Work systems', 'Resident app admin', 'https://example.com/resident-app', 'Post announcements and approve amenity bookings.', 'rise, announcements, amenities'),
    r('Work systems', 'Package locker portal', 'https://example.com/lockers', 'Re-send pickup codes from the “Deliveries” tab.', 'packages, parcels'),
    r('Work systems', 'Work order system', 'https://example.com/work-orders', 'Always include unit, location in unit, and permission to enter.', 'maintenance, repairs'),
    r('SharePoint trackers', 'Package tracker', 'https://example.sharepoint.com/sites/property/Lists/Packages', 'Log oversized packages that do not fit in the lockers.', 'packages'),
    r('SharePoint trackers', 'Key & fob tracker', 'https://example.sharepoint.com/sites/property/Lists/Keys', 'Record every fob issued, deactivated or replaced.', 'keys, fobs, access'),
    r('SharePoint trackers', 'Amenity booking tracker', 'https://example.sharepoint.com/sites/property/Lists/Amenities', 'Party room deposits go here too.', 'amenities, party room'),
    r('SharePoint trackers', 'Incident tracker', 'https://example.sharepoint.com/sites/property/Lists/Incidents', 'Fill out the same shift as the incident. Attach photos.', 'security, incidents'),
    r('SharePoint trackers', 'Move in / out tracker', 'https://example.sharepoint.com/sites/property/Lists/Moves', 'Book the service elevator and pad it 30 min before.', 'moves, elevator'),
    r('SOPs', 'Water leak SOP', 'https://example.sharepoint.com/sites/property/SOPs/WaterLeak.pdf', '1) Shut-off valve 2) Call on-call maintenance 3) Notify units below 4) Incident tracker.', 'leak, flood, emergency'),
    r('SOPs', 'Lockout SOP', 'https://example.sharepoint.com/sites/property/SOPs/Lockout.pdf', 'Verify ID against the resident profile before opening any door.', 'lockout, keys'),
    r('SOPs', 'Fire alarm SOP', 'https://example.sharepoint.com/sites/property/SOPs/FireAlarm.pdf', 'Do not silence the panel. Meet the fire department at the front entrance.', 'fire, alarm, emergency'),
    r('Guides & tips', 'Shift note template', 'https://example.sharepoint.com/sites/property/Guides/ShiftNote.docx', 'Or use “Generate shift note” on the Shift Log tab.', 'shift note, handover'),
    r('Guides & tips', 'Writing good handovers', 'https://example.com/guides/handover', 'Lead with anything that needs action. One line per unit.', 'handover, tips'),
    r('Contacts', 'On-call maintenance', 'tel:555-0100', '555-0100 — after hours and weekends.', 'maintenance, emergency, phone'),
    r('Contacts', 'Property manager (fictional)', 'mailto:pm@example.com', 'pm@example.com — escalate anything involving cost or legal.', 'pm, escalation'),
    r('Contacts', 'Security company', 'tel:555-0199', '555-0199 — patrol requests and incidents.', 'security, phone'),
  ];
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
    resources: sampleResources(),
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
