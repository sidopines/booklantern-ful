const store = new Map(); // key -> { value, expires }
module.exports = {
  get(key) {
    const it = store.get(key);
    if (!it) return null;
    if (Date.now() > it.expires) { store.delete(key); return null; }
    return it.value;
  },
  set(key, value, ttlMs = 60 * 60 * 1000) { // default 1 hour
    store.set(key, { value, expires: Date.now() + ttlMs });
  }
};
