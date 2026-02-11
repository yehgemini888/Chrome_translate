/* Chrome Translate — Storage Wrapper */
'use strict';

const CTStorage = {
  // --- chrome.storage.local (persistent) ---

  async getApiKey() {
    const result = await chrome.storage.local.get(CT.STORAGE_API_KEY);
    return result[CT.STORAGE_API_KEY] || '';
  },

  async setApiKey(key) {
    await chrome.storage.local.set({ [CT.STORAGE_API_KEY]: key });
  },

  async getTargetLang() {
    const result = await chrome.storage.local.get(CT.STORAGE_TARGET_LANG);
    return result[CT.STORAGE_TARGET_LANG] || CT.DEFAULT_TARGET_LANG;
  },

  async setTargetLang(lang) {
    await chrome.storage.local.set({ [CT.STORAGE_TARGET_LANG]: lang });
  },

  async getEnabled() {
    const result = await chrome.storage.local.get(CT.STORAGE_ENABLED);
    return result[CT.STORAGE_ENABLED] !== false; // default true
  },

  async setEnabled(enabled) {
    await chrome.storage.local.set({ [CT.STORAGE_ENABLED]: enabled });
  },

  // --- chrome.storage.session (translation cache) ---

  _hashKey(text) {
    // djb2 hash — fast, non-cryptographic
    let hash = 5381;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) + hash + text.charCodeAt(i)) & 0xffffffff;
    }
    return CT.CACHE_PREFIX + hash.toString(36);
  },

  async getCached(text) {
    const key = this._hashKey(text);
    const result = await chrome.storage.session.get(key);
    return result[key] || null;
  },

  async setCache(text, translation) {
    const key = this._hashKey(text);
    await chrome.storage.session.set({ [key]: translation });
  },

  async getCachedBatch(texts) {
    const keys = texts.map(t => this._hashKey(t));
    const result = await chrome.storage.session.get(keys);
    return texts.map((t, i) => result[keys[i]] || null);
  },

  async setCacheBatch(texts, translations) {
    const data = {};
    texts.forEach((t, i) => {
      if (translations[i]) {
        data[this._hashKey(t)] = translations[i];
      }
    });
    if (Object.keys(data).length > 0) {
      await chrome.storage.session.set(data);
    }
  }
};
