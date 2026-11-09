(() => {
  const toggle = document.getElementById('sticky-toggle');
  const note = document.getElementById('scratch-note');
  const text = document.getElementById('scratch-text');
  const key = 'concierge-personal-sticky-note:workspace-2';
  const handle = note.querySelector('header');
  let drag = null;
  function place(left, top) {
    const rect = note.getBoundingClientRect();
    note.style.left = `${Math.max(0, Math.min(left, window.innerWidth - rect.width))}px`;
    note.style.top = `${Math.max(0, Math.min(top, window.innerHeight - rect.height))}px`;
    note.style.right = 'auto';
    note.style.bottom = 'auto';
  }
  handle.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button') || event.button !== 0) return;
    const rect = note.getBoundingClientRect();
    drag = { id: event.pointerId, x: event.clientX - rect.left, y: event.clientY - rect.top };
    handle.setPointerCapture(event.pointerId);
    note.classList.add('is-dragging');
    event.preventDefault();
  });
  handle.addEventListener('pointermove', (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    place(event.clientX - drag.x, event.clientY - drag.y);
  });
  function endDrag(event) {
    if (!drag || drag.id !== event.pointerId) return;
    drag = null;
    note.classList.remove('is-dragging');
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
  }
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);
  handle.addEventListener('lostpointercapture', endDrag);
  window.addEventListener('resize', () => {
    if (note.hidden || !note.style.left) return;
    const rect = note.getBoundingClientRect();
    place(rect.left, rect.top);
  });
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
