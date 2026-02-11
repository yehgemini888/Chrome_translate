/* Chrome Translate — Popup Logic */
'use strict';

document.addEventListener('DOMContentLoaded', async () => {
  const enableToggle = document.getElementById('enableToggle');
  const targetLangSelect = document.getElementById('targetLang');

  // Load saved settings
  const stored = await chrome.storage.local.get([
    CT.STORAGE_TARGET_LANG,
    CT.STORAGE_ENABLED
  ]);

  enableToggle.checked = stored[CT.STORAGE_ENABLED] !== false;
  targetLangSelect.value = stored[CT.STORAGE_TARGET_LANG] || CT.DEFAULT_TARGET_LANG;

  // Enable toggle
  enableToggle.addEventListener('change', async () => {
    await chrome.storage.local.set({ [CT.STORAGE_ENABLED]: enableToggle.checked });
  });

  // Target language
  targetLangSelect.addEventListener('change', async () => {
    await chrome.storage.local.set({ [CT.STORAGE_TARGET_LANG]: targetLangSelect.value });
  });
});
