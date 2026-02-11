/* Chrome Translate — Web Page Translation Engine */
'use strict';

const CTTranslator = {
  _isTranslating: false,
  _abortController: null,
  _translated: false,

  /**
   * Translate the current page. Extracts text blocks, sends for translation,
   * and injects bilingual display below each source block.
   */
  async translatePage() {
    if (this._isTranslating) return;
    this._isTranslating = true;
    this._abortController = new AbortController();

    try {
      CTFloatingButton.setState('translating');

      // 1. Extract text blocks from DOM
      const blocks = CTDom.extractTextBlocks();
      if (blocks.length === 0) {
        CTFloatingButton.setState('done', '此頁面沒有可翻譯的文字');
        this._isTranslating = false;
        return;
      }

      // 2. Get target language
      const settings = await chrome.storage.local.get([CT.STORAGE_TARGET_LANG, CT.STORAGE_ENABLED]);
      const targetLang = settings[CT.STORAGE_TARGET_LANG] || CT.DEFAULT_TARGET_LANG;

      // 3. Batch the texts
      const allTexts = blocks.map(b => b.text);
      const batches = CTDom.batchTexts(allTexts);

      // 4. Translate batches with concurrency control
      const allTranslations = new Array(allTexts.length).fill(null);
      let completedBatches = 0;
      const totalBatches = batches.length;

      CTFloatingButton.setProgress(0, totalBatches);

      // Process batches with limited concurrency
      const queue = [...batches];
      const workers = [];

      for (let i = 0; i < Math.min(CT.MAX_CONCURRENT_BATCHES, queue.length); i++) {
        workers.push(this._processBatchQueue(queue, allTranslations, targetLang, () => {
          completedBatches++;
          CTFloatingButton.setProgress(completedBatches, totalBatches);
        }));
      }

      await Promise.all(workers);

      // Check if aborted
      if (this._abortController.signal.aborted) {
        this._isTranslating = false;
        return;
      }

      // 5. Inject translations into DOM
      let injectedCount = 0;
      blocks.forEach((block, i) => {
        if (allTranslations[i]) {
          const id = 'ct-' + i;
          CTDom.insertTranslation(block.element, allTranslations[i], id);
          injectedCount++;
        }
      });

      console.log(`[Chrome Translate] Injected ${injectedCount}/${blocks.length} translations`);

      if (injectedCount === 0) {
        CTFloatingButton.showError('翻譯失敗 — 請檢查網路連線或重新整理頁面');
      } else {
        this._translated = true;
        CTFloatingButton.setState('done', `翻譯完成 (${injectedCount} 段)`);
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
        // If extension context is invalidated, stop processing
        if (e.message && e.message.includes('Extension context invalidated')) {
          throw e;
        }
        // Mark failed items as null — they just won't show translation
      }

      onBatchDone();
    }
  },

  /**
   * Remove all translations and reset state.
   */
  removeTranslations() {
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
