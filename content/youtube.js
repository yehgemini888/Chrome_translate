/* Chrome Translate — YouTube Dual Subtitle Renderer */
/* Runs in ISOLATED world — has chrome.* API access */
'use strict';

const CTYouTube = {
  _translationMap: new Map(),  // originalText -> translatedText
  _observer: null,
  _currentVideoId: null,
  _isTranslating: false,
  _subtitleQueue: [],          // Queue subtitle data until ready to translate
  _initialized: false,

  /**
   * Initialize YouTube subtitle handler.
   * Listens for subtitle data from interceptor (MAIN world).
   */
  init() {
    if (this._initialized) return;
    this._initialized = true;

    // Listen for subtitle data from youtube-interceptor.js (MAIN world)
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;

      if (event.data?.type === 'CT_SUBTITLES_RAW') {
        this._onSubtitlesReceived(event.data.payload);
      }
    });

    // Listen for YouTube SPA navigation
    document.addEventListener('yt-navigate-finish', () => {
      this._onNavigate();
    });

    // Start observing caption container
    this._startCaptionObserver();
  },

  /**
   * Handle received subtitle data from interceptor.
   */
  async _onSubtitlesReceived(payload) {
    const { subtitles, videoId, language } = payload;

    // Skip if it's the same video subtitles we already translated
    if (videoId && videoId === this._currentVideoId && this._translationMap.size > 0) {
      return;
    }

    this._currentVideoId = videoId;
    this._translationMap.clear();

    // Skip if subtitles are already in target language
    const targetLang = await this._getTargetLang();
    if (this._isTargetLang(language, targetLang)) {
      return;
    }

    await this._translateSubtitles(subtitles);
  },

  /**
   * Batch translate all subtitle texts.
   */
  async _translateSubtitles(subtitles) {
    if (this._isTranslating) return;
    this._isTranslating = true;

    try {
      CTFloatingButton.setState('translating', 'YouTube 字幕翻譯中...');

      const texts = subtitles.map(s => s.text);
      const targetLang = await this._getTargetLang();

      // Batch translate
      const batches = CTDom.batchTexts(texts);
      const allTranslations = new Array(texts.length).fill(null);

      for (const batch of batches) {
        try {
          const response = await chrome.runtime.sendMessage({
            type: CT.MSG_TRANSLATE,
            payload: { texts: batch.texts, targetLang }
          });

          if (response.error) {
            console.error('[Chrome Translate] Subtitle translation error:', response.error.message);
            continue;
          }

          batch.indices.forEach((origIdx, batchIdx) => {
            allTranslations[origIdx] = response.payload.translations[batchIdx];
          });
        } catch (e) {
          console.error('[Chrome Translate] Subtitle batch error:', e);
        }
      }

      // Build translation map: original text -> translated text
      subtitles.forEach((sub, i) => {
        if (allTranslations[i]) {
          // Normalize: strip HTML entities and trim for matching
          const normalizedKey = this._normalizeText(sub.text);
          this._translationMap.set(normalizedKey, allTranslations[i]);
        }
      });

      this._isTranslating = false;
      CTFloatingButton.setState('done', `YouTube 字幕翻譯完成 (${this._translationMap.size} 句)`);

      // Re-check current visible captions
      this._translateVisibleCaptions();

    } catch (e) {
      this._isTranslating = false;
      console.error('[Chrome Translate] Subtitle translation failed:', e);
      CTFloatingButton.showError('YouTube 字幕翻譯失敗: ' + e.message);
    }
  },

  /**
   * Start observing YouTube caption container for changes.
   */
  _startCaptionObserver() {
    // Disconnect existing observer
    if (this._observer) {
      this._observer.disconnect();
    }

    this._observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList' || mutation.type === 'characterData') {
          this._translateVisibleCaptions();
          return; // Process once per batch
        }
      }
    });

    // Observe the entire player for caption changes
    // YouTube dynamically creates/destroys caption elements
    const observeTarget = () => {
      const player = document.querySelector('#movie_player') || document.querySelector('.html5-video-player');
      if (player) {
        this._observer.observe(player, {
          childList: true,
          subtree: true,
          characterData: true
        });
      } else {
        // Retry until player is available
        setTimeout(observeTarget, 1000);
      }
    };

    observeTarget();
  },

  /**
   * Find and translate currently visible caption segments.
   */
  _translateVisibleCaptions() {
    if (this._translationMap.size === 0) return;

    const captionSegments = document.querySelectorAll('.ytp-caption-segment');
    if (captionSegments.length === 0) return;

    captionSegments.forEach(segment => {
      // Skip if already has translation
      if (segment.querySelector('.' + CT.CLS_YT_TRANSLATED)) return;

      const originalText = this._normalizeText(segment.textContent);
      if (!originalText) return;

      // Look up translation — try exact match first, then fuzzy
      let translation = this._translationMap.get(originalText);

      if (!translation) {
        // Fuzzy match: find the closest subtitle
        translation = this._fuzzyMatch(originalText);
      }

      if (translation) {
        const translatedSpan = document.createElement('span');
        translatedSpan.className = CT.CLS_YT_TRANSLATED;
        translatedSpan.textContent = translation;

        // Insert after the original text within the caption window
        const captionWindow = segment.closest('.ytp-caption-window-container')
          || segment.closest('.caption-window')
          || segment.parentElement;

        if (captionWindow) {
          // Check if translation already exists in this window
          if (!captionWindow.querySelector('.' + CT.CLS_YT_TRANSLATED)) {
            captionWindow.appendChild(translatedSpan);
          }
        } else {
          segment.appendChild(translatedSpan);
        }
      }
    });
  },

  /**
   * Fuzzy match: find translation for text that might not match exactly
   * (due to HTML entities, whitespace differences, etc.)
   */
  _fuzzyMatch(text) {
    if (!text) return null;
    const lower = text.toLowerCase().trim();

    for (const [key, value] of this._translationMap) {
      if (key.toLowerCase().trim() === lower) return value;
      // Substring match for partial captions
      if (lower.includes(key.toLowerCase()) || key.toLowerCase().includes(lower)) {
        return value;
      }
    }
    return null;
  },

  /**
   * Normalize text for map lookup.
   */
  _normalizeText(text) {
    if (!text) return '';
    return text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  },

  /**
   * Handle YouTube SPA navigation (video change).
   */
  _onNavigate() {
    this._translationMap.clear();
    this._currentVideoId = null;
    this._isTranslating = false;

    // Remove existing translated elements
    document.querySelectorAll('.' + CT.CLS_YT_TRANSLATED).forEach(el => el.remove());

    // Re-start observer for new page
    this._startCaptionObserver();
  },

  /**
   * Check if source language matches target language.
   */
  _isTargetLang(sourceLang, targetLang) {
    if (!sourceLang || sourceLang === 'unknown') return false;
    const srcNorm = sourceLang.toLowerCase().replace(/-/g, '');
    const tgtNorm = targetLang.toLowerCase().replace(/-/g, '');
    // Generic match: 'en' matches 'enus', 'zh' matches 'zhhant', etc.
    return srcNorm === tgtNorm
      || srcNorm.startsWith(tgtNorm)
      || tgtNorm.startsWith(srcNorm);
  },

  async _getTargetLang() {
    const result = await chrome.storage.local.get(CT.STORAGE_TARGET_LANG);
    return result[CT.STORAGE_TARGET_LANG] || CT.DEFAULT_TARGET_LANG;
  },

  /**
   * Clean up.
   */
  destroy() {
    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
    }
    this._translationMap.clear();
    this._initialized = false;
    document.querySelectorAll('.' + CT.CLS_YT_TRANSLATED).forEach(el => el.remove());
  }
};
