// What stays on this device while a post is being written, so nothing is lost if the page closes (the
// phone locks, the tab reloads): the text in localStorage, the new photos (not on the site yet) in IndexedDB.
// Everything is cleared once the post is saved. If the browser blocks storage, the editor still works.

const mem = new Map();
export const local = {
  get(k) {
    try {
      const v = localStorage.getItem(k);
      return v == null ? null : JSON.parse(v);
    } catch {
      return mem.has(k) ? mem.get(k) : null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      mem.set(k, v);
    }
  },
  del(k) {
    try {
      localStorage.removeItem(k);
    } catch {}
    mem.delete(k);
  },
  keys(prefix) {
    try {
      return Object.keys(localStorage).filter((k) => k.startsWith(prefix));
    } catch {
      return [...mem.keys()].filter((k) => k.startsWith(prefix));
    }
  },
};

// a tiny key → value store for the photos (blobs are too big for localStorage)
const blobsMem = new Map();
let dbp;
const db = () =>
  (dbp ||= new Promise((ok) => {
    try {
      const r = indexedDB.open('blog-editor', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('images');
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ok(null);
    } catch {
      ok(null);
    }
  }));
const tx = async (mode, fn) => {
  const d = await db();
  if (!d) return null;
  return new Promise((ok) => {
    try {
      const t = d.transaction('images', mode);
      const req = fn(t.objectStore('images'));
      t.oncomplete = () => ok(req?.result ?? null);
      t.onerror = () => ok(null);
    } catch {
      ok(null);
    }
  });
};
export const blobs = {
  async put(key, value) {
    blobsMem.set(key, value);
    await tx('readwrite', (s) => s.put(value, key));
  },
  async get(key) {
    return blobsMem.get(key) || (await tx('readonly', (s) => s.get(key)));
  },
  async del(key) {
    blobsMem.delete(key);
    await tx('readwrite', (s) => s.delete(key));
  },
};
