/* Chrome Translate — Web Page Translation Engine */
'use strict';

const CTTranslator = {
  _isTranslating: false,
  _abortController: null,
  _translated: false,
  _mutationObserver: null,
  _pendingNodes: [],
  _mutationTimer: null,
  _scrollHandler: null,
  _scrollTimer: null,

  /**
   * Translate the current page. Extracts text pieces, sends for translation,
   * and injects bilingual display after each source block.
   */
  async translatePage() {
    if (this._isTranslating) return;
    this._isTranslating = true;
    this._abortController = new AbortController();

    try {
      CTFloatingButton.setState('translating');

      // 1. Extract text pieces from DOM (Text Node level)
      const pieces = CTDom.extractPieces();
      if (pieces.length === 0) {
        CTFloatingButton.setState('done', '此頁面沒有可翻譯的文字');
        this._isTranslating = false;
        return;
      }

      // 2. Get target language
      const settings = await chrome.storage.local.get([CT.STORAGE_TARGET_LANG, CT.STORAGE_ENABLED]);
      const targetLang = settings[CT.STORAGE_TARGET_LANG] || CT.DEFAULT_TARGET_LANG;

      // 3. Extract per-text-node arrays for HTML-aware translation
      const allTextNodeArrays = pieces.map(p => CTDom.getPieceTextArray(p));

      // 4. Batch pieces for the HTML endpoint (smaller batches for reliability)
      const BATCH_SIZE = 10;
      const allPerNodeResults = new Array(pieces.length).fill(null);
      let completedPieces = 0;

      CTFloatingButton.setProgress(0, pieces.length);

      for (let start = 0; start < allTextNodeArrays.length; start += BATCH_SIZE) {
        if (this._abortController.signal.aborted) break;

        const batchArrays = allTextNodeArrays.slice(start, start + BATCH_SIZE);

        try {
          const response = await chrome.runtime.sendMessage({
            type: CT.MSG_TRANSLATE_HTML,
            payload: { textNodeArrays: batchArrays, targetLang }
          });

          if (!response) {
            console.error('[Chrome Translate] No response from service worker');
            continue;
          }

          if (response.error) {
            console.error('[Chrome Translate] Service worker error:', response.error);
            throw new Error(response.error.message);
          }

          if (response.payload && response.payload.perNodeTranslations) {
            response.payload.perNodeTranslations.forEach((nodeTranslations, batchIdx) => {
              const origIdx = start + batchIdx;
              // Only accept non-empty results
              if (nodeTranslations && nodeTranslations.some(t => t)) {
                allPerNodeResults[origIdx] = nodeTranslations;
              }
            });
          }
        } catch (e) {
          console.error('[Chrome Translate] Batch translation error:', e);
          if (e.message && e.message.includes('Extension context invalidated')) {
            throw e;
          }
        }

        completedPieces += batchArrays.length;
        CTFloatingButton.setProgress(completedPieces, pieces.length);
      }

      // Check if aborted
      if (this._abortController.signal.aborted) {
        this._isTranslating = false;
        return;
      }

      // 5. Inject per-node translations into DOM
      let injectedCount = 0;
      pieces.forEach((piece, i) => {
        if (allPerNodeResults[i]) {
          const id = 'ct-' + i;
          CTDom.insertTranslation(piece, allPerNodeResults[i], id);
          injectedCount++;
        }
      });

      console.log(`[Chrome Translate] Injected ${injectedCount}/${pieces.length} translations`);

      if (injectedCount === 0) {
        CTFloatingButton.showError('翻譯失敗 — 請檢查網路連線或重新整理頁面');
      } else {
        this._translated = true;
        CTFloatingButton.setState('done', `翻譯完成 (${injectedCount} 段)`);
        // Start observing for dynamically added content
        this._startObserving();
      }

    } catch (e) {
      console.error('[Chrome Translate] Translation error:', e);
      if (e.message && e.message.includes('Extension context invalidated')) {
        CTFloatingButton.showError('擴充功能已更新，請重新整理頁面 (Ctrl+R)');
      } else {
        CTFloatingButton.showError(e.message || '翻譯失敗');
      }
    } finally {
      this._isTranslating = false;
    }
  },

  /**
   * Process batches from a shared queue (for concurrency control).
   */
  async _processBatchQueue(queue, results, targetLang, onBatchDone) {
    while (queue.length > 0) {
      if (this._abortController.signal.aborted) return;

      const batch = queue.shift();
      if (!batch) return;

      try {
        const response = await chrome.runtime.sendMessage({
          type: CT.MSG_TRANSLATE,
          payload: { texts: batch.texts, targetLang }
        });

        if (!response) {
          console.error('[Chrome Translate] No response from service worker');
          continue;
        }

        if (response.error) {
          console.error('[Chrome Translate] Service worker error:', response.error);
          throw new Error(response.error.message);
        }

        if (!response.payload || !response.payload.translations) {
          console.error('[Chrome Translate] Invalid response structure:', response);
          continue;
        }

        // Place results in correct positions
        let batchSuccess = 0;
        batch.indices.forEach((origIdx, batchIdx) => {
          if (response.payload.translations[batchIdx]) {
            results[origIdx] = response.payload.translations[batchIdx];
            batchSuccess++;
          }
        });
        console.log(`[Chrome Translate] Batch done: ${batchSuccess}/${batch.texts.length} texts translated`);
      } catch (e) {
        console.error('[Chrome Translate] Batch translation error:', e);
        if (e.message && e.message.includes('Extension context invalidated')) {
          throw e;
        }
      }

      onBatchDone();
    }
  },

  /**
   * Start MutationObserver to translate dynamically added content.
   */
  _startObserving() {
    if (this._mutationObserver) return;

    this._mutationObserver = new MutationObserver((mutations) => {
      if (!this._translated) return;

      // Collect parent elements that lost their translations (React reconciliation)
      const retranslateTargets = new Set();

      mutations.forEach(mutation => {
        // Existing: collect newly added element nodes
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === 1 && !CT.SKIP_TAGS.has(node.tagName) &&
            !(node.className && typeof node.className === 'string' &&
              node.className.indexOf('ct-') !== -1) &&
            !(node.hasAttribute && node.hasAttribute(CT.ATTR_CT_INJECTED))) {
            this._pendingNodes.push(node);
          }
        });

        // New: detect when React/framework removes our injected wrappers
        mutation.removedNodes.forEach(node => {
          if (node.nodeType === 1 && node.hasAttribute &&
            node.hasAttribute(CT.ATTR_CT_INJECTED)) {
            // Our wrapper was removed — queue the parent for re-translation
            const target = mutation.target;
            if (target && target.nodeType === 1 && !CT.SKIP_TAGS.has(target.tagName)) {
              retranslateTargets.add(target);
            }
          }
        });
      });

      // Queue parents that lost their translations
      retranslateTargets.forEach(target => {
        if (this._pendingNodes.indexOf(target) === -1) {
          this._pendingNodes.push(target);
        }
      });

      if (this._pendingNodes.length > 0 && !this._mutationTimer) {
        this._mutationTimer = setTimeout(() => this._translatePendingNodes(), 2000);
      }
    });

    this._mutationObserver.observe(document.body, { childList: true, subtree: true });

    // Scroll-based safety net: when user stops scrolling, re-scan for missing
    // translations. This catches ALL cases where React/framework silently
    // re-renders content — regardless of the specific DOM mutation pattern.
    this._scrollHandler = () => {
      if (!this._translated || this._isTranslating) return;
      if (this._scrollTimer) clearTimeout(this._scrollTimer);
      this._scrollTimer = setTimeout(() => {
        this._scrollTimer = null;
        // Push document.body for a full re-scan
        if (this._pendingNodes.indexOf(document.body) === -1) {
          this._pendingNodes.push(document.body);
        }
        if (!this._mutationTimer) {
          this._mutationTimer = setTimeout(() => this._translatePendingNodes(), 0);
        }
      }, 600);
    };
    window.addEventListener('scroll', this._scrollHandler, { passive: true });
  },

  /**
   * Translate nodes that were dynamically added after initial translation.
   */
  async _translatePendingNodes() {
    this._mutationTimer = null;
    if (this._pendingNodes.length === 0) return;

    const nodes = [...this._pendingNodes];
    this._pendingNodes = [];

    // Extract pieces from new nodes
    const allPieces = [];
    nodes.forEach(node => {
      if (document.body.contains(node)) {
        try {
          const pieces = CTDom.extractPieces(node);
          allPieces.push(...pieces);
        } catch (e) { /* skip problematic nodes */ }
      }
    });

    if (allPieces.length === 0) return;

    try {
      const settings = await chrome.storage.local.get([CT.STORAGE_TARGET_LANG]);
      const targetLang = settings[CT.STORAGE_TARGET_LANG] || CT.DEFAULT_TARGET_LANG;

      const allTextNodeArrays = allPieces.map(p => CTDom.getPieceTextArray(p));
      const perNodeResults = new Array(allPieces.length).fill(null);

      // Translate in small batches
      const BATCH_SIZE = 10;
      for (let start = 0; start < allTextNodeArrays.length; start += BATCH_SIZE) {
        const batchArrays = allTextNodeArrays.slice(start, start + BATCH_SIZE);

        try {
          const response = await chrome.runtime.sendMessage({
            type: CT.MSG_TRANSLATE_HTML,
            payload: { textNodeArrays: batchArrays, targetLang }
          });
          if (response && response.payload && response.payload.perNodeTranslations) {
            response.payload.perNodeTranslations.forEach((nodeTranslations, batchIdx) => {
              const origIdx = start + batchIdx;
              if (nodeTranslations && nodeTranslations.some(t => t)) {
                perNodeResults[origIdx] = nodeTranslations;
              }
            });
          }
        } catch (e) {
          console.error('[Chrome Translate] Dynamic translation batch error:', e);
          if (e.message && e.message.includes('Extension context invalidated')) return;
        }
      }

      // Pause observer to prevent self-triggering loop during DOM writes
      if (this._mutationObserver) {
        this._mutationObserver.disconnect();
      }

      let count = 0;
      const ts = Date.now();
      allPieces.forEach((piece, i) => {
        if (perNodeResults[i]) {
          CTDom.insertTranslation(piece, perNodeResults[i], 'ct-dyn-' + ts + '-' + i);
          count++;
        }
      });

      // Resume observer and discard any mutations caused by our own DOM writes
      if (this._mutationObserver) {
        this._mutationObserver.observe(document.body, { childList: true, subtree: true });
        this._mutationObserver.takeRecords();
      }

      if (count > 0) {
        console.log(`[Chrome Translate] Dynamically translated ${count} new pieces`);
      }
    } catch (e) {
      console.error('[Chrome Translate] Dynamic translation error:', e);
    }
  },

  /**
   * Stop the MutationObserver.
   */
  _stopObserving() {
    if (this._mutationObserver) {
      this._mutationObserver.disconnect();
      this._mutationObserver = null;
    }
    if (this._mutationTimer) {
      clearTimeout(this._mutationTimer);
      this._mutationTimer = null;
    }
    if (this._scrollHandler) {
      window.removeEventListener('scroll', this._scrollHandler);
      this._scrollHandler = null;
    }
    if (this._scrollTimer) {
      clearTimeout(this._scrollTimer);
      this._scrollTimer = null;
    }
    this._pendingNodes = [];
  },

  /**
   * Remove all translations and reset state.
   */
  removeTranslations() {
    this._stopObserving();
    CTDom.removeAllTranslations();
    this._translated = false;
    CTFloatingButton.setState('idle');
  },

  /**
   * Cancel ongoing translation.
   */
  cancel() {
    if (this._abortController) {
      this._abortController.abort();
    }
    this._isTranslating = false;
    CTFloatingButton.setState('idle');
  },

  /**
   * Check if page is currently translated.
   */
  isTranslated() {
    return this._translated;
  },

  /**
   * Check if translation is in progress.
   */
  isTranslating() {
    return this._isTranslating;
  }
};
