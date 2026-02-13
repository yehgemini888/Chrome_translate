/* Chrome Translate — YouTube Dual Subtitle Renderer */
/* Runs in ISOLATED world — has chrome.* API access */
/*
 * Architecture V5.2: Preprocessed Sentences + RAF Time-Primary Sync.
 * - Interceptor captures raw timedtext events (may be ASR word-level fragments)
 * - Preprocessor merges fragments into complete sentences (better translation quality)
 * - Preprocessor fills time gaps so findByTime always matches
 * - Time-Primary sync: video.currentTime is the single source of truth
 * - requestAnimationFrame (~60Hz) replaces timeupdate (~4Hz) for minimal latency
 * - Configurable time offset (ct_yt_sub_offset) compensates ASR timestamp delay
 * - MutationObserver only detects "captions visible or not"
 * - YouTube captions remain active but hidden (opacity: 0)
 */
'use strict';

const CTYouTube = {
  _translationMap: new Map(),  // normalizedText -> translatedText (fallback)
  _sentences: [],              // [{text, translation, startMs, endMs}] — preprocessed sentences
  _overlay: null,
  _observer: null,
  _currentVideoId: null,
  _currentLanguage: null,
  _isTranslating: false,
  _initialized: false,
  _displayMode: 'bilingual',
  _isEnabled: true,
  _subScale: 1.0,
  _subColor: '#ffffff',
  _subOffset: 0,               // time offset in ms (negative = show earlier)
  _rafId: null,                // requestAnimationFrame handle
  _currentSubIndex: -1,        // index of currently displayed sentence

  init() {
    if (this._initialized) return;
    this._initialized = true;

    document.addEventListener('CT_SUBTITLES_READY', (event) => {
      this._onSubtitlesReceived(event.detail);
    });

    document.addEventListener('yt-navigate-finish', () => {
      this._onNavigate();
    });

    this._loadSubtitleStyle();

    chrome.storage.onChanged.addListener((changes) => {
      if (changes[CT.STORAGE_YT_SUB_SCALE] || changes[CT.STORAGE_YT_SUB_COLOR] || changes[CT.STORAGE_YT_SUB_OFFSET]) {
        this._loadSubtitleStyle().then(() => {
          this._currentSubIndex = -1;
          this._syncByTime();
        });
      }
    });

    this._ensureOverlay();
    this._startCaptionObserver();
    this._startRAFLoop();
  },

  // ─── Overlay ─────────────────────────────────────────────

  _ensureOverlay() {
    if (this._overlay && this._overlay.isConnected) return;

    const tryCreate = () => {
      const player = document.querySelector('#movie_player');
      if (!player) {
        setTimeout(tryCreate, 1000);
        return;
      }

      const old = player.querySelector('#ct-yt-overlay');
      if (old) old.remove();

      const overlay = document.createElement('div');
      overlay.id = 'ct-yt-overlay';
      overlay.setAttribute(CT.ATTR_CT_INJECTED, 'true');
      player.appendChild(overlay);
      this._overlay = overlay;

      // Hide YouTube's captions visually (keep DOM active for reading)
      player.classList.add('ct-hide-yt-captions');
    };

    tryCreate();
  },

  // ─── Caption Observer (read-only) ────────────────────────

  _startCaptionObserver() {
    if (this._observer) {
      this._observer.disconnect();
    }

    this._observer = new MutationObserver(() => {
      this._syncFromYouTube();
    });

    const observeTarget = () => {
      const container = document.querySelector('.ytp-caption-window-container');
      if (container) {
        this._observer.observe(container, {
          childList: true,
          subtree: true,
          characterData: true
        });
      } else {
        setTimeout(observeTarget, 1000);
      }
    };

    observeTarget();
  },

  // ─── Sync Engine V5.1: Time-Primary ─────────────────────

  /**
   * Called by MutationObserver when YouTube's caption DOM changes.
   * Only checks if YouTube is showing captions (visibility gate).
   * Actual sentence selection is always done by currentTime.
   */
  _syncFromYouTube() {
    if (!this._isEnabled || this._sentences.length === 0) return;

    // Visibility gate: is YouTube showing any caption?
    const segments = document.querySelectorAll('.ytp-caption-segment');
    const hasCaption = segments.length > 0 &&
      Array.from(segments).some(s => s.textContent.trim());

    if (!hasCaption) {
      // YouTube hid captions — hide our overlay too
      if (this._currentSubIndex !== -1) {
        this._currentSubIndex = -1;
        if (this._overlay) {
          this._overlay.innerHTML = '';
          this._overlay.style.display = 'none';
        }
      }
      return;
    }

    // Captions visible — use currentTime to find the right sentence
    this._syncByTime();
  },

  /**
   * Core sync: use video.currentTime to find and display the correct sentence.
   * Preprocessor's gap-filling ensures findByTime almost always matches.
   * _subOffset shifts the lookup time (negative = subtitles appear earlier).
   */
  _syncByTime() {
    const video = document.querySelector('video');
    if (!video) return;

    const timeMs = video.currentTime * 1000 - this._subOffset;
    const matchIndex = CTYouTubePreprocessor.findByTime(this._sentences, timeMs);

    if (matchIndex >= 0 && matchIndex !== this._currentSubIndex) {
      this._currentSubIndex = matchIndex;
      const sub = this._sentences[matchIndex];
      this._renderOverlay(sub.text, sub.translation);
    } else if (matchIndex === -1 && this._currentSubIndex >= 0) {
      // Past all sentences or before first — clear
      this._currentSubIndex = -1;
      if (this._overlay) {
        this._overlay.innerHTML = '';
        this._overlay.style.display = 'none';
      }
    }
  },

  // ─── RAF sync loop (~60Hz) ──────────────────────────────

  /**
   * Start a requestAnimationFrame loop for high-frequency time sync.
   * ~60fps (16ms) vs timeupdate's ~4Hz (250ms) — reduces max latency by 15x.
   */
  _startRAFLoop() {
    if (this._rafId) return;

    const tick = () => {
      if (!this._isEnabled || this._sentences.length === 0) {
        this._rafId = requestAnimationFrame(tick);
        return;
      }
      this._syncByTime();
      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  },

  _stopRAFLoop() {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  },

  // ─── Rendering ───────────────────────────────────────────

  _renderOverlay(originalText, translation) {
    if (!this._overlay) this._ensureOverlay();
    if (!this._overlay) return;

    const fontSize = Math.round(18 * this._subScale);

    if (this._displayMode === 'original') {
      this._overlay.innerHTML = '';
      const line = document.createElement('div');
      line.className = 'ct-yt-line-original';
      line.textContent = originalText;
      line.style.fontSize = fontSize + 'px';
      this._overlay.appendChild(line);
      this._overlay.style.display = '';
      return;
    }

    if (this._displayMode === 'translation') {
      this._overlay.innerHTML = '';
      if (translation) {
        const line = document.createElement('div');
        line.className = 'ct-yt-line-translation';
        line.textContent = translation;
        line.style.fontSize = fontSize + 'px';
        line.style.color = this._subColor;
        this._overlay.appendChild(line);
        this._overlay.style.display = '';
      } else {
        this._overlay.style.display = 'none';
      }
      return;
    }

    // Bilingual mode
    this._overlay.innerHTML = '';
    this._overlay.style.display = '';

    const origLine = document.createElement('div');
    origLine.className = 'ct-yt-line-original';
    origLine.textContent = originalText;
    origLine.style.fontSize = fontSize + 'px';
    this._overlay.appendChild(origLine);

    if (translation) {
      const transLine = document.createElement('div');
      transLine.className = 'ct-yt-line-translation';
      transLine.textContent = translation;
      transLine.style.fontSize = fontSize + 'px';
      transLine.style.color = this._subColor;
      this._overlay.appendChild(transLine);
    }
  },

  // ─── Subtitle Data Handling ──────────────────────────────

  async _onSubtitlesReceived(payload) {
    const { subtitles, videoId, language } = payload;

    if (videoId === this._currentVideoId && language === this._currentLanguage && this._sentences.length > 0) {
      return;
    }

    this._currentVideoId = videoId;
    this._currentLanguage = language;
    this._translationMap.clear();
    this._currentSubIndex = -1;

    // ── Preprocess: merge ASR fragments into complete sentences ──
    const merged = CTYouTubePreprocessor.mergeSentences(subtitles);
    this._sentences = merged.map(s => ({
      text: s.text,
      translation: null,
      startMs: s.startMs,
      endMs: s.endMs
    }));

    console.log(`[CT YouTube] Preprocessed: ${subtitles.length} fragments → ${this._sentences.length} sentences`);

    const targetLang = await this._getTargetLang();
    if (this._isTargetLang(language, targetLang)) return;

    console.log('[CT YouTube] Translating', this._sentences.length, 'sentences:', language, '->', targetLang);
    try {
      await this._translateSentences();
    } catch (err) {
      console.error('[CT YouTube] Translation error:', err);
    }
  },

  async _translateSentences() {
    if (this._isTranslating) return;
    this._isTranslating = true;

    try {
      console.log('[Chrome Translate] YouTube 字幕翻譯中...');
      if (typeof CTYouTubeButton !== 'undefined' && CTYouTubeButton._button) {
        CTYouTubeButton.setState('translating', 'YouTube 字幕翻譯中...');
      }

      const texts = this._sentences.map(s => s.text);
      const targetLang = await this._getTargetLang();
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

      // Populate sentence translations + build fallback map
      this._sentences.forEach((sentence, i) => {
        if (allTranslations[i]) {
          sentence.translation = allTranslations[i];
          const key = this._normalizeText(sentence.text);
          this._translationMap.set(key, allTranslations[i]);
        }
      });

      this._isTranslating = false;
      const count = this._sentences.filter(s => s.translation).length;
      console.log(`[Chrome Translate] YouTube 字幕翻譯完成 (${count} 句)`);
      if (typeof CTYouTubeButton !== 'undefined' && CTYouTubeButton._button) {
        CTYouTubeButton.setState('done', `YouTube 字幕翻譯完成 (${count} 句)`);
      }

      // Force re-sync
      this._currentSubIndex = -1;
      this._syncFromYouTube();

    } catch (e) {
      this._isTranslating = false;
      console.error('[Chrome Translate] Subtitle translation failed:', e);
      if (typeof CTYouTubeButton !== 'undefined' && CTYouTubeButton._button) {
        CTYouTubeButton.setState('error', 'YouTube 字幕翻譯失敗: ' + e.message);
      }
    }
  },

  // ─── AI Segmentation (Hybrid) ────────────────────────────

  /**
   * Hybrid approach: heuristic preprocessor for timing + Google Translate
   * for translation via MSG_TRANSLATE_FULL (preserves segment structure).
   *
   * Inserts \n at heuristic sentence boundaries before sending to Google.
   * Google respects \n as segment boundaries → 1:1 mapping guaranteed.
   * Combines: heuristic timing accuracy + batch translation efficiency.
   */
  async _translateWithAISegmentation(rawFragments, targetLang) {
    if (this._isTranslating) return null;
    this._isTranslating = true;

    try {
      // 1. Use heuristic preprocessor for sentence boundaries + timing
      const heuristicSentences = CTYouTubePreprocessor.mergeSentences(rawFragments);
      if (heuristicSentences.length === 0) return null;

      console.log(`[CT YouTube] Heuristic: ${rawFragments.length} fragments → ${heuristicSentences.length} sentences`);

      // 2. Batch sentences and translate (join with \n per batch)
      const texts = heuristicSentences.map(s => s.text);
      const batches = CTDom.batchTexts(texts);
      const allTranslations = new Array(texts.length).fill(null);

      for (const batch of batches) {
        try {
          const joined = batch.texts.join('\n');
          const response = await chrome.runtime.sendMessage({
            type: CT.MSG_TRANSLATE_FULL,
            payload: { text: joined, targetLang }
          });

          if (response && response.error) {
            console.error('[CT YouTube] Batch error:', response.error.message);
            continue;
          }

          if (response && response.payload && response.payload.segments) {
            // Each segment corresponds to one \n-separated sentence
            response.payload.segments.forEach((seg, i) => {
              if (i < batch.indices.length) {
                allTranslations[batch.indices[i]] = seg.translated;
              }
            });
          }
        } catch (e) {
          console.error('[CT YouTube] Batch failed:', e.message);
        }
      }

      // 3. Build sentences with heuristic timing + translations
      return heuristicSentences.map((s, i) => ({
        text: s.text,
        translation: allTranslations[i] || null,
        startMs: s.startMs,
        endMs: s.endMs
      }));
    } finally {
      this._isTranslating = false;
    }
  },

  // ─── Text Matching ───────────────────────────────────────

  _fuzzyMatch(text) {
    if (!text) return null;
    const lower = text.toLowerCase().trim();

    for (const [key, value] of this._translationMap) {
      if (key.toLowerCase().trim() === lower) return value;
      if (lower.includes(key.toLowerCase()) || key.toLowerCase().includes(lower)) {
        return value;
      }
    }
    return null;
  },

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

  // ─── Navigation & State ──────────────────────────────────

  _onNavigate() {
    this._translationMap.clear();
    this._sentences = [];
    this._currentVideoId = null;
    this._isTranslating = false;
    this._currentSubIndex = -1;

    if (this._overlay) {
      this._overlay.innerHTML = '';
      this._overlay.style.display = 'none';
    }

    this._ensureOverlay();
    this._startCaptionObserver();
    this._startRAFLoop();
  },

  _isTargetLang(sourceLang, targetLang) {
    if (!sourceLang || sourceLang === 'unknown') return false;
    const srcNorm = sourceLang.toLowerCase().replace(/-/g, '');
    const tgtNorm = targetLang.toLowerCase().replace(/-/g, '');
    return srcNorm === tgtNorm
      || srcNorm.startsWith(tgtNorm)
      || tgtNorm.startsWith(srcNorm);
  },

  async _getTargetLang() {
    const result = await chrome.storage.local.get(CT.STORAGE_TARGET_LANG);
    return result[CT.STORAGE_TARGET_LANG] || CT.DEFAULT_TARGET_LANG;
  },

  async _loadSubtitleStyle() {
    const result = await chrome.storage.local.get([
      CT.STORAGE_YT_SUB_SCALE, CT.STORAGE_YT_SUB_COLOR, CT.STORAGE_YT_SUB_OFFSET
    ]);
    this._subScale = result[CT.STORAGE_YT_SUB_SCALE] || 1.0;
    this._subColor = result[CT.STORAGE_YT_SUB_COLOR] || '#ffffff';
    this._subOffset = result[CT.STORAGE_YT_SUB_OFFSET] || 0;
  },

  // ─── Public API ──────────────────────────────────────────

  setDisplayMode(mode) {
    this._displayMode = mode;
    this._currentSubIndex = -1;
    this._syncFromYouTube();
  },

  toggleEnabled() {
    this._isEnabled = !this._isEnabled;
    if (!this._isEnabled) {
      if (this._overlay) {
        this._overlay.innerHTML = '';
        this._overlay.style.display = 'none';
      }
    } else {
      this._currentSubIndex = -1;
      this._syncFromYouTube();
    }
    return this._isEnabled;
  },

  refreshTranslation() {
    this._translationMap.clear();
    this._sentences = [];
    this._currentSubIndex = -1;
    this._currentVideoId = null;
    this._currentLanguage = null;
  },

  destroy() {
    this._stopRAFLoop();
    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
    }
    if (this._overlay) {
      this._overlay.remove();
      this._overlay = null;
    }
    this._translationMap.clear();
    this._initialized = false;
    const player = document.querySelector('#movie_player');
    if (player) player.classList.remove('ct-hide-yt-captions');
  }
};
