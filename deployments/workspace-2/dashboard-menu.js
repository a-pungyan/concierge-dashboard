(() => {
  const toggle = document.getElementById('menu-toggle');
  const menu = document.getElementById('dashboard-menu');
  let closeTimer;
  let hoverOpened = false;
  function setOpen(open, restoreFocus = false) {
    clearTimeout(closeTimer);
    if (open && menu.hidden) menu.innerHTML = quickAccessHtml(false);
    if (!open) hoverOpened = false;
    menu.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');
    if (restoreFocus) toggle.focus();
  }
  toggle.addEventListener('click', () => {
    if (hoverOpened) {
      hoverOpened = false;
      setOpen(true);
    } else setOpen(menu.hidden);
  });
  function enter(event) {
    if (event.pointerType !== 'mouse') return;
    clearTimeout(closeTimer);
    if (menu.hidden) {
      hoverOpened = true;
      setOpen(true);
    }
  }
  function leave(event) {
    if (event.pointerType !== 'mouse' || !hoverOpened) return;
    closeTimer = setTimeout(() => {
      if (menu.contains(document.activeElement)) return;
      setOpen(false);
    }, 220);
  }
  [toggle, menu].forEach((element) => {
    element.addEventListener('pointerenter', enter);
    element.addEventListener('pointerleave', leave);
  });
  toggle.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      hoverOpened = false;
      setOpen(true);
      menu.querySelector('a')?.focus();
    }
  });
  document.addEventListener('click', (event) => {
    if (!menu.contains(event.target) && !toggle.contains(event.target)) setOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !menu.hidden) setOpen(false, true);
  });
  document.addEventListener('focusin', (event) => {
    if (!menu.contains(event.target) && !toggle.contains(event.target)) setOpen(false);
  });
  menu.addEventListener('click', (event) => {
    const item = event.target.closest('a, button');
    if (!item) return;
    setOpen(false, true);
  });
})();
