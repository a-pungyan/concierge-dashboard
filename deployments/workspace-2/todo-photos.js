/* Screenshot to-dos stay in this browser. IndexedDB holds images; the daily list holds IDs. */
(() => {
  const main = document.getElementById('main');
  const MAX_FILE = 10 * 1024 * 1024;
  let database, busy = false;
  const cache = new Map();
  const dbName = `${TODO_KEY}:photos`;
  function openDB() {
    if (typeof indexedDB === 'undefined') return Promise.reject(new Error('Photo storage is unavailable in this browser.'));
    if (!database) database = new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('photos', { keyPath: 'id' });
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); database = null; };
        resolve(db);
      };
      request.onerror = () => { database = null; reject(new Error('Photo storage is unavailable in this browser.')); };
      request.onblocked = () => { database = null; reject(new Error('Close other dashboard tabs and try adding the photo again.')); };
    });
    return database;
  }
  async function transaction(mode, action) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('photos', mode);
      let request;
      try { request = action(tx.objectStore('photos')); } catch (error) { tx.abort(); reject(error); return; }
      tx.oncomplete = () => resolve(request?.result);
      tx.onerror = tx.onabort = () => reject(new Error('Could not save or read the screenshot. Browser storage may be full or unavailable.'));
    });
  }
  const get = id => transaction('readonly', store => store.get(id));
  const remove = id => transaction('readwrite', store => store.delete(id));
  async function purgeOldPhotos() {
    await transaction('readwrite', store => {
      const cursor = store.openCursor();
      cursor.onsuccess = () => {
        const entry = cursor.result;
        if (!entry) return;
        if (entry.value.day !== today()) entry.delete();
        entry.continue();
      };
      return cursor;
    });
  }
  async function validateImage(file) {
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error('Choose PNG, JPG, WebP or GIF screenshots.');
    if (!file.size || file.size > MAX_FILE) throw new Error('Each screenshot must be smaller than 10 MB.');
    const url = URL.createObjectURL(file);
    try {
      const image = new Image(); image.src = url;
      await image.decode();
      if (!image.naturalWidth || !image.naturalHeight) throw new Error();
    } catch (_) { throw new Error('One of these files could not be opened as an image. Try a PNG or JPG screenshot.'); }
    finally { URL.revokeObjectURL(url); }
  }
  async function addPhotos(files, composer) {
    if (busy || !files.length) return;
    const day = today(), userId = currentUser?.id;
    if (!userId || document.body.classList.contains('signed-out')) return;
    if (files.length > 10 || files.reduce((total, file) => total + file.size, 0) > 40 * 1024 * 1024) {
      toast('Add up to 10 screenshots at a time, totalling no more than 40 MB.', 'error'); return;
    }
    busy = true;
    const button = composer?.querySelector('[data-add-todo-photo]');
    if (button) { button.disabled = true; button.textContent = 'Saving…'; }
    const caption = composer?.elements.text.value.trim() || '';
    const records = [];
    try {
      for (const file of files) {
        await validateImage(file);
        records.push({ id: crypto.randomUUID(), day, blob: file });
      }
      await transaction('readwrite', store => { records.forEach(record => store.put(record)); });
      if (today() !== day || currentUser?.id !== userId || document.body.classList.contains('signed-out')) {
        throw new Error('The day or signed-in account changed. Add your screenshots again.');
      }
      const items = records.map((record, index) => ({ id: crypto.randomUUID(), text: index === 0 ? caption : '', done: false, photoId: record.id }));
      if (!saveTodos([...loadTodos(), ...items])) {
        await transaction('readwrite', store => { records.forEach(record => store.delete(record.id)); });
        return;
      }
      if (composer?.isConnected && composer.elements.text.value.trim() === caption) composer.elements.text.value = '';
      render();
      document.getElementById('todo-input')?.focus();
      toast(`${items.length === 1 ? 'Screenshot added' : `${items.length} screenshots added`} to your to-do list.`);
    } catch (error) {
      await Promise.allSettled(records.map(record => remove(record.id)));
      toast(error.message || 'Could not save the screenshots. Please try again.', 'error');
    } finally {
      busy = false;
      if (button?.isConnected) { button.disabled = false; button.textContent = 'Add photo'; }
      if (composer?.isConnected) composer.classList.remove('is-dragging-photo');
    }
  }
  async function hydrate() {
    const activeIds = new Set(loadTodos().map(item => item.photoId).filter(Boolean));
    for (const [id, url] of cache) {
      if (!activeIds.has(id)) { URL.revokeObjectURL(url); cache.delete(id); }
    }
    if (document.body.classList.contains('signed-out')) return;
    const images = main.querySelectorAll('img[data-todo-photo-src]:not([data-photo-requested])');
    for (const image of images) {
      image.dataset.photoRequested = 'true';
      const id = image.dataset.todoPhotoSrc;
      const status = image.parentElement.querySelector('.todo-photo-status');
      try {
        if (!cache.has(id)) {
          const record = await get(id);
          if (!image.isConnected || document.body.classList.contains('signed-out')) continue;
          if (!record || record.day !== today()) throw new Error('Screenshot unavailable in this browser.');
          if (!cache.has(id)) cache.set(id, URL.createObjectURL(record.blob));
        }
        image.src = cache.get(id);
        status.textContent = 'Open screenshot';
      } catch (_) {
        if (image.isConnected) { image.hidden = true; status.textContent = 'Screenshot unavailable. Remove this item and add it again.'; }
      }
    }
  }
  const viewer = document.createElement('dialog');
  viewer.className = 'todo-photo-viewer'; viewer.setAttribute('aria-label', 'To-do screenshot');
  viewer.innerHTML = '<div class="dialog-body"><div class="dialog-actions"><span class="spacer"></span><button type="button" class="btn btn-ghost" data-close-photo>Close</button></div><img alt="To-do screenshot"></div>';
  document.body.append(viewer);
  let viewerURL = null;
  viewer.querySelector('[data-close-photo]').addEventListener('click', () => viewer.close());
  viewer.addEventListener('click', event => { if (event.target === viewer) viewer.close(); });
  viewer.addEventListener('close', () => {
    viewer.querySelector('img').removeAttribute('src');
    if (viewerURL) URL.revokeObjectURL(viewerURL);
    viewerURL = null;
  });
  document.addEventListener('click', async event => {
    const add = event.target.closest('[data-add-todo-photo]');
    if (add) return add.closest('form').querySelector('input[type="file"]').click();
    const removed = event.target.closest('[data-remove-todo-photo]');
    if (removed) remove(removed.dataset.removeTodoPhoto).catch(() => {});
    const button = event.target.closest('[data-todo-photo]');
    if (!button || document.body.classList.contains('signed-out')) return;
    const userId = currentUser?.id;
    try {
      const record = await get(button.dataset.todoPhoto);
      if (currentUser?.id !== userId || document.body.classList.contains('signed-out')) return;
      if (!record || record.day !== today()) throw new Error('This screenshot is no longer available.');
      if (viewer.open) viewer.close();
      viewerURL = URL.createObjectURL(record.blob);
      viewer.querySelector('img').src = viewerURL;
      viewer.showModal(); viewer.querySelector('button').focus();
    } catch (error) { toast(error.message, 'error'); }
  });
  main.addEventListener('change', event => {
    if (event.target.id !== 'todo-photo-files') return;
    const files = [...event.target.files]; event.target.value = '';
    addPhotos(files, event.target.closest('form'));
  });
  main.addEventListener('paste', event => {
    const composer = event.target.closest('[data-form="todo"]');
    if (!composer) return;
    const files = [...(event.clipboardData?.items || [])].filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile()).filter(Boolean);
    if (files.length) { event.preventDefault(); addPhotos(files, composer); }
  });
  main.addEventListener('dragover', event => {
    const composer = event.target.closest('[data-form="todo"]');
    if (composer && [...(event.dataTransfer?.types || [])].includes('Files')) { event.preventDefault(); composer.classList.add('is-dragging-photo'); }
  });
  main.addEventListener('dragleave', event => {
    const composer = event.target.closest('[data-form="todo"]');
    if (composer && !composer.contains(event.relatedTarget)) composer.classList.remove('is-dragging-photo');
  });
  main.addEventListener('drop', event => {
    const composer = event.target.closest('[data-form="todo"]');
    if (!composer) return;
    event.preventDefault(); composer.classList.remove('is-dragging-photo');
    addPhotos([...(event.dataTransfer?.files || [])], composer);
  });
  new MutationObserver(hydrate).observe(main, { childList: true, subtree: true });
  new MutationObserver(() => {
    if (!document.body.classList.contains('signed-out')) return;
    if (viewer.open) viewer.close();
    for (const url of cache.values()) URL.revokeObjectURL(url);
    cache.clear();
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  // Expired images are removed when the dashboard is next opened; none are uploaded.
  purgeOldPhotos().catch(() => {});
  hydrate();
})();
