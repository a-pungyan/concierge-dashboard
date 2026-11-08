(() => {
  const toggle = document.getElementById('sticky-toggle');
  const note = document.getElementById('scratch-note');
  const text = document.getElementById('scratch-text');
  const key = 'concierge-personal-sticky-note';
  try { text.value = localStorage.getItem(key) || ''; } catch (_) { /* Storage can be unavailable. */ }
  function setOpen(open) {
    note.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    (open ? text : toggle).focus();
  }
  toggle.addEventListener('click', () => setOpen(note.hidden));
  document.getElementById('sticky-close').addEventListener('click', () => setOpen(false));
  note.addEventListener('keydown', (event) => { if (event.key === 'Escape') setOpen(false); });
  text.addEventListener('input', () => {
    try { localStorage.setItem(key, text.value); } catch (_) { /* Keep editing available. */ }
  });
})();
