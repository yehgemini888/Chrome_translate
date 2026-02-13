/* Chrome Translate — Background Service Worker */
'use strict';

// MV3 service worker: paths relative to this file (background/)
importScripts('../utils/constants.js', '../libs/google-translate-client.js');

// ─── Installation ────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Chrome Translate] Extension installed.');
  chrome.storage.local.get([CT.STORAGE_ENABLED, CT.STORAGE_TARGET_LANG], (result) => {
    const defaults = {};
    if (result[CT.STORAGE_ENABLED] === undefined) defaults[CT.STORAGE_ENABLED] = true;
    if (!result[CT.STORAGE_TARGET_LANG]) defaults[CT.STORAGE_TARGET_LANG] = CT.DEFAULT_TARGET_LANG;
    if (Object.keys(defaults).length) chrome.storage.local.set(defaults);
  });
});

// ─── Message Router ──────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return false;

  switch (message.type) {
    case CT.MSG_TRANSLATE:
      handleTranslate(message.payload).then(sendResponse);
      return true; // async response

    case CT.MSG_TRANSLATE_HTML:
      handleTranslateHTML(message.payload).then(sendResponse);
      return true;

    case CT.MSG_TRANSLATE_FULL:
      handleTranslateFull(message.payload).then(sendResponse);
      return true;

    default:
      return false;
  }
});

// ─── Handlers ────────────────────────────────────────────────

/**
 * Handle translation request with cache support.
 * @param {{ texts: string[], targetLang: string }} payload
 */
async function handleTranslate(payload) {
  try {
    const { texts, targetLang } = payload;

    // Check session cache
    const cached = await getCachedBatch(texts);
    const uncachedTexts = [];
    const uncachedIndices = [];

    texts.forEach((text, i) => {
      if (!cached[i]) {
        uncachedTexts.push(text);
        uncachedIndices.push(i);
      }
    });

    // All cached — return immediately
    if (uncachedTexts.length === 0) {
      return {
        type: CT.MSG_TRANSLATE_RESULT,
        payload: { translations: cached, sourceLang: '', fromCache: true }
      };
    }

    // Translate uncached texts individually with concurrency
    const result = await GoogleTranslateClient.translate(uncachedTexts, targetLang);

    // Merge cached + fresh results
    const translations = [...cached];
    uncachedIndices.forEach((origIdx, freshIdx) => {
      translations[origIdx] = result.translations[freshIdx];
    });

    // Store fresh translations in session cache (only non-empty)
    const validTexts = [];
    const validTranslations = [];
    uncachedTexts.forEach((text, i) => {
      if (result.translations[i]) {
        validTexts.push(text);
        validTranslations.push(result.translations[i]);
      }
    });
    if (validTexts.length > 0) {
      await setCacheBatch(validTexts, validTranslations);
    }

    console.log(`[Chrome Translate] Translated ${uncachedTexts.length} texts (${cached.filter(Boolean).length} cached)`);

    return {
      type: CT.MSG_TRANSLATE_RESULT,
      payload: {
        translations,
        sourceLang: result.sourceLang,
        fromCache: false
      }
    };
  } catch (e) {
    console.error('[Chrome Translate] handleTranslate error:', e);
    return {
      type: CT.MSG_TRANSLATE_RESULT,
      error: { message: e.message, code: e.code || 'UNKNOWN' }
    };
  }
}

/**
 * Handle per-text-node translation (preserves links/formatting structure).
 * Flattens all text nodes, translates each individually via the working gtx
 * endpoint (with cache + concurrency), then maps results back per-piece.
 * @param {{ textNodeArrays: string[][], targetLang: string }} payload
 */
async function handleTranslateHTML(payload) {
  try {
    const { textNodeArrays, targetLang } = payload;

    // 1. Flatten all text nodes into a single list with mapping
    const allTexts = [];
    const mapping = []; // { pieceIdx, nodeIdx }

    for (let p = 0; p < textNodeArrays.length; p++) {
      for (let n = 0; n < textNodeArrays[p].length; n++) {
        const text = textNodeArrays[p][n];
        if (text && text.trim()) {
          allTexts.push(text);
          mapping.push({ pieceIdx: p, nodeIdx: n });
        }
      }
    }

    if (allTexts.length === 0) {
      return {
        type: CT.MSG_TRANSLATE_RESULT,
        payload: { perNodeTranslations: textNodeArrays.map(a => new Array(a.length).fill('')), sourceLang: '' }
      };
    }

    // 2. Check cache for already-translated texts
    const cached = await getCachedBatch(allTexts);
    const uncachedTexts = [];
    const uncachedIndices = [];

    allTexts.forEach((text, i) => {
      if (!cached[i]) {
        uncachedTexts.push(text);
        uncachedIndices.push(i);
      }
    });

    // 3. Translate uncached texts using existing concurrent translator
    const freshTranslations = new Array(allTexts.length).fill('');
    cached.forEach((val, i) => { if (val) freshTranslations[i] = val; });

    if (uncachedTexts.length > 0) {
      const result = await GoogleTranslateClient.translate(uncachedTexts, targetLang);

      uncachedIndices.forEach((origIdx, freshIdx) => {
        freshTranslations[origIdx] = result.translations[freshIdx];
      });

      // Cache the new translations
      const validTexts = [];
      const validTranslations = [];
      uncachedTexts.forEach((text, i) => {
        if (result.translations[i]) {
          validTexts.push(text);
          validTranslations.push(result.translations[i]);
        }
      });
      if (validTexts.length > 0) {
        await setCacheBatch(validTexts, validTranslations);
      }
    }

    // 4. Map flat results back to per-piece, per-node structure
    const perNodeTranslations = textNodeArrays.map(arr => new Array(arr.length).fill(''));
    mapping.forEach((m, i) => {
      perNodeTranslations[m.pieceIdx][m.nodeIdx] = freshTranslations[i];
    });

    console.log(`[Chrome Translate] Per-node translated ${allTexts.length} nodes (${cached.filter(Boolean).length} cached)`);

    return {
      type: CT.MSG_TRANSLATE_RESULT,
      payload: { perNodeTranslations, sourceLang: '' }
    };
  } catch (e) {
    console.error('[Chrome Translate] handleTranslateHTML error:', e);
    return {
      type: CT.MSG_TRANSLATE_RESULT,
      error: { message: e.message, code: e.code || 'UNKNOWN' }
    };
  }
}

/**
 * Handle full-text translation with AI segmentation.
 * Sends text as-is to Google Translate and returns per-segment results
 * with both translated and original text preserved.
 * @param {{ text: string, targetLang: string }} payload
 */
async function handleTranslateFull(payload) {
  try {
    const { text, targetLang } = payload;

    // Check cache
    const cached = await getCachedBatch([text]);
    if (cached[0]) {
      try {
        const parsed = JSON.parse(cached[0]);
        return {
          type: CT.MSG_TRANSLATE_RESULT,
          payload: { segments: parsed.segments, sourceLang: parsed.sourceLang, fromCache: true }
        };
      } catch (e) { /* cache corrupted, translate fresh */ }
    }

    const result = await GoogleTranslateClient.translateWithSegments(text, targetLang);

    // Cache as JSON string
    if (result.segments.length > 0) {
      await setCacheBatch([text], [JSON.stringify(result)]);
    }

    console.log(`[Chrome Translate] Full-text translated: ${result.segments.length} segments`);

    return {
      type: CT.MSG_TRANSLATE_RESULT,
      payload: { segments: result.segments, sourceLang: result.sourceLang, fromCache: false }
    };
  } catch (e) {
    console.error('[Chrome Translate] handleTranslateFull error:', e);
    return {
      type: CT.MSG_TRANSLATE_RESULT,
      error: { message: e.message, code: e.code || 'UNKNOWN' }
    };
  }
}

// ─── Cache Helpers ───────────────────────────────────────────

function hashKey(text) {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) & 0xffffffff;
  }
  return CT.CACHE_PREFIX + hash.toString(36);
}

async function getCachedBatch(texts) {
  const keys = texts.map(t => hashKey(t));
  const result = await chrome.storage.session.get(keys);
  return texts.map((t, i) => result[keys[i]] || null);
}

async function setCacheBatch(texts, translations) {
  const data = {};
  texts.forEach((t, i) => {
    if (translations[i]) {
      data[hashKey(t)] = translations[i];
    }
  });
  if (Object.keys(data).length > 0) {
    await chrome.storage.session.set(data);
  }
}
