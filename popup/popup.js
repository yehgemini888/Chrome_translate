/* Chrome Translate — Popup Logic */
'use strict';

document.addEventListener('DOMContentLoaded', async () => {
  const enableToggle = document.getElementById('enableToggle');
  const targetLangSelect = document.getElementById('targetLang');
  const ytSubScale = document.getElementById('ytSubScale');
  const ytSubScaleValue = document.getElementById('ytSubScaleValue');
  const ytSubColorOptions = document.getElementById('ytSubColorOptions');
  const ytSubColorCustom = document.getElementById('ytSubColorCustom');
  const ytSubPreviewText = document.getElementById('ytSubPreviewText');

  // Load saved settings
  const stored = await chrome.storage.local.get([
    CT.STORAGE_TARGET_LANG,
    CT.STORAGE_ENABLED,
    CT.STORAGE_YT_SUB_SCALE,
    CT.STORAGE_YT_SUB_COLOR
  ]);

  enableToggle.checked = stored[CT.STORAGE_ENABLED] !== false;
  targetLangSelect.value = stored[CT.STORAGE_TARGET_LANG] || CT.DEFAULT_TARGET_LANG;

  const savedScale = stored[CT.STORAGE_YT_SUB_SCALE] || 1.0;
  const savedColor = stored[CT.STORAGE_YT_SUB_COLOR] || '#ffffff';

  ytSubScale.value = savedScale;
  ytSubScaleValue.textContent = savedScale + 'x';
  updatePreview(savedScale, savedColor);
  activateColorBtn(savedColor);

  // Enable toggle
  enableToggle.addEventListener('change', async () => {
    await chrome.storage.local.set({ [CT.STORAGE_ENABLED]: enableToggle.checked });
  });

  // Target language
  targetLangSelect.addEventListener('change', async () => {
    await chrome.storage.local.set({ [CT.STORAGE_TARGET_LANG]: targetLangSelect.value });
  });

  // Subtitle scale slider
  ytSubScale.addEventListener('input', async () => {
    const scale = parseFloat(ytSubScale.value);
    ytSubScaleValue.textContent = scale.toFixed(1) + 'x';
    updatePreview(scale, getActiveColor());
    await chrome.storage.local.set({ [CT.STORAGE_YT_SUB_SCALE]: scale });
  });

  // Subtitle color preset buttons
  ytSubColorOptions.addEventListener('click', async (e) => {
    const btn = e.target.closest('.color-btn');
    if (!btn) return;

    const color = btn.dataset.color;
    activateColorBtn(color);
    ytSubColorCustom.value = color;
    updatePreview(parseFloat(ytSubScale.value), color);
    await chrome.storage.local.set({ [CT.STORAGE_YT_SUB_COLOR]: color });
  });

  // Subtitle color custom picker
  ytSubColorCustom.addEventListener('input', async () => {
    const color = ytSubColorCustom.value;
    // Deactivate preset buttons
    ytSubColorOptions.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
    updatePreview(parseFloat(ytSubScale.value), color);
    await chrome.storage.local.set({ [CT.STORAGE_YT_SUB_COLOR]: color });
  });

  function activateColorBtn(color) {
    const normalized = color.toLowerCase();
    ytSubColorOptions.querySelectorAll('.color-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.color.toLowerCase() === normalized);
    });
    ytSubColorCustom.value = color;
  }

  function getActiveColor() {
    const activeBtn = ytSubColorOptions.querySelector('.color-btn.active');
    return activeBtn ? activeBtn.dataset.color : ytSubColorCustom.value;
  }

  function updatePreview(scale, color) {
    ytSubPreviewText.style.color = color;
    ytSubPreviewText.style.fontSize = (13 * scale) + 'px';
  }
});
