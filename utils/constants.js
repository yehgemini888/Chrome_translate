/* Chrome Translate — Constants */
'use strict';

const CT = Object.freeze({
  // Google Translate (free endpoint)
  GOOGLE_TRANSLATE_URL: 'https://translate.googleapis.com/translate_a/single',
  DEFAULT_TARGET_LANG: 'zh-TW',

  // Storage keys (chrome.storage.local)
  STORAGE_TARGET_LANG: 'ct_target_lang',
  STORAGE_ENABLED: 'ct_enabled',

  // Cache prefix (chrome.storage.session)
  CACHE_PREFIX: 'cache:',

  // Translation batch limits
  BATCH_MAX_TEXTS: 20,     // texts per Google Translate request (joined by \n\n)
  BATCH_MAX_CHARS: 4000,   // chars per request (Google has ~5000 limit)
  MAX_CONCURRENT_BATCHES: 2,

  // Message types (content <-> background)
  MSG_TRANSLATE: 'TRANSLATE',
  MSG_TRANSLATE_RESULT: 'TRANSLATE_RESULT',

  // YouTube interceptor -> content script
  MSG_YT_SUBTITLES: 'CT_SUBTITLES_RAW',

  // DOM attributes
  ATTR_TRANSLATED: 'data-ct-translated',
  ATTR_CT_ID: 'data-ct-id',

  // CSS classes
  CLS_TRANSLATED: 'ct-translated',
  CLS_FLOAT_BTN: 'ct-float-btn',
  CLS_YT_TRANSLATED: 'ct-yt-translated',

  // Skip these tags during DOM traversal
  SKIP_TAGS: new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE',
    'TEXTAREA', 'INPUT', 'SELECT', 'SVG', 'CANVAS',
    'VIDEO', 'AUDIO', 'IFRAME', 'OBJECT', 'EMBED'
  ]),

  // Block-level elements for text grouping
  BLOCK_TAGS: new Set([
    'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'LI', 'TD', 'TH', 'BLOCKQUOTE', 'FIGCAPTION',
    'ARTICLE', 'SECTION', 'HEADER', 'FOOTER',
    'DT', 'DD', 'CAPTION', 'SUMMARY'
  ])
});
