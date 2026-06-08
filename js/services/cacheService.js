export function createBoundedMemoryCache(maxEntries = 40) {
  const store = new Map();

  function touch(key, value) {
    if (store.has(key)) store.delete(key);
    store.set(key, value);
    while (store.size > maxEntries) {
      store.delete(store.keys().next().value);
    }
  }

  return {
    has: (key) => store.has(key),
    get(key) {
      if (!store.has(key)) return undefined;
      const value = store.get(key);
      touch(key, value);
      return value;
    },
    set: touch,
    delete: (key) => store.delete(key),
    clear: () => store.clear(),
    get size() {
      return store.size;
    }
  };
}

export function collectStorageKeysByPrefix(prefix) {
  const keys = [];
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(prefix)) keys.push(key);
    }
  } catch {
    return keys;
  }
  return keys;
}

export function pruneStorageCache({ prefix, maxItems, ttlMs, remove }) {
  const candidates = [];
  try {
    for (const key of collectStorageKeysByPrefix(prefix)) {
      const raw = localStorage.getItem(key);
      let createdAt = 0;
      try { createdAt = Number(JSON.parse(raw || "{}").createdAt || 0); } catch {}
      candidates.push({ key, createdAt });
    }
  } catch {
    return;
  }

  const now = Date.now();
  const removeKey = typeof remove === "function" ? remove : (key) => localStorage.removeItem(key);
  candidates
    .filter((item) => !item.createdAt || now - item.createdAt > ttlMs)
    .forEach((item) => removeKey(item.key));

  candidates
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, Math.max(0, candidates.length - maxItems))
    .forEach((item) => removeKey(item.key));
}
