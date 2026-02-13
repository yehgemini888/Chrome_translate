/* Chrome Translate — YouTube Subtitle Preprocessor */
/* Merges ASR fragments into complete sentences for better translation & sync */
'use strict';

const CTYouTubePreprocessor = {
  // ─── Configuration ─────────────────────────────────────
  PAUSE_THRESHOLD: 400,       // ms gap to trigger sentence break
  MAX_SENTENCE_CHARS: 200,    // max chars before forced break
  MAX_FRAGMENTS: 30,          // max fragments before forced break

  // CJK character ranges (Chinese, Japanese, Korean — no space joining)
  _CJK_RANGE: /[\u4E00-\u9FFF\u3400-\u4DBF\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF\uFF00-\uFFEF]/,

  /**
   * Merge raw subtitle fragments into complete sentences.
   *
   * Segmentation rules (priority order):
   *   1. Sentence-ending punctuation (. ? ! 。！？)
   *   2. Pause gap > PAUSE_THRESHOLD between fragments
   *   3. Accumulated text length > MAX_SENTENCE_CHARS
   *   4. Fragment count > MAX_FRAGMENTS
   *
   * @param {Array<{startMs: number, durationMs: number, text: string}>} rawEvents
   * @returns {Array<{text: string, startMs: number, endMs: number}>}
   */
  mergeSentences(rawEvents) {
    if (!rawEvents || rawEvents.length === 0) return [];

    const sentences = [];
    let fragments = [];
    let accText = '';
    let sentenceStartMs = 0;
    let lastEndMs = 0;

    for (let i = 0; i < rawEvents.length; i++) {
      const event = rawEvents[i];
      const text = (event.text || '').trim();
      if (!text) continue;

      const startMs = event.startMs || 0;
      const endMs = startMs + (event.durationMs || 0);

      // ── Break check (before adding current fragment) ──
      if (fragments.length > 0) {
        const gap = startMs - lastEndMs;
        const willExceedChars = accText.length + text.length + 1 > this.MAX_SENTENCE_CHARS;
        const willExceedFrags = fragments.length >= this.MAX_FRAGMENTS;
        const hasPauseGap = gap >= this.PAUSE_THRESHOLD;

        if (hasPauseGap || willExceedChars || willExceedFrags) {
          sentences.push(this._buildSentence(accText, sentenceStartMs, lastEndMs));
          fragments = [];
          accText = '';
        }
      }

      // ── Add fragment ──
      if (fragments.length === 0) {
        sentenceStartMs = startMs;
        accText = text;
      } else {
        accText = this._joinText(accText, text);
      }
      fragments.push(event);
      lastEndMs = endMs;

      // ── Punctuation break (after adding fragment) ──
      if (this._endsWithSentencePunctuation(text)) {
        sentences.push(this._buildSentence(accText, sentenceStartMs, lastEndMs));
        fragments = [];
        accText = '';
      }
    }

    // Flush remaining fragments
    if (fragments.length > 0 && accText.trim()) {
      sentences.push(this._buildSentence(accText, sentenceStartMs, lastEndMs));
    }

    // ── Fill time gaps: extend each sentence's endMs to next sentence's startMs ──
    // This eliminates "no match" gaps in time-based lookup
    for (let i = 0; i < sentences.length - 1; i++) {
      if (sentences[i].endMs < sentences[i + 1].startMs) {
        sentences[i].endMs = sentences[i + 1].startMs;
      }
    }

    return sentences;
  },

  /**
   * Build a sentence object from accumulated data.
   */
  _buildSentence(text, startMs, endMs) {
    return {
      text: text.trim(),
      startMs: startMs,
      endMs: endMs
    };
  },

  /**
   * Join two text fragments with appropriate spacing.
   * CJK text: no space. Latin text: single space.
   */
  _joinText(existing, addition) {
    if (!existing) return addition;
    const lastChar = existing[existing.length - 1];
    const firstChar = addition[0];

    // No space between CJK characters
    if (this._CJK_RANGE.test(lastChar) || this._CJK_RANGE.test(firstChar)) {
      return existing + addition;
    }
    return existing + ' ' + addition;
  },

  /**
   * Check if text ends with sentence-ending punctuation.
   */
  _endsWithSentencePunctuation(text) {
    if (!text) return false;
    return /[.!?\u3002\uFF01\uFF1F]$/.test(text);
    //       .  !  ?  。       ！       ？
  },

  // ─── Binary Search ─────────────────────────────────────

  /**
   * Find sentence index by timestamp using binary search.
   * Used for seek recovery — repositions the sequential pointer.
   *
   * @param {Array<{startMs: number, endMs: number}>} sentences
   * @param {number} timeMs
   * @returns {number} index, or -1 if no match
   */
  findByTime(sentences, timeMs) {
    let lo = 0;
    let hi = sentences.length - 1;

    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (timeMs < sentences[mid].startMs) {
        hi = mid - 1;
      } else if (timeMs >= sentences[mid].endMs) {
        lo = mid + 1;
      } else {
        return mid;
      }
    }
    return -1;
  },

  /**
   * Find the closest sentence at or after a given timestamp.
   * Used when findByTime returns -1 (timeMs falls in a gap).
   *
   * @param {Array<{startMs: number, endMs: number}>} sentences
   * @param {number} timeMs
   * @returns {number} index, or -1 if past all sentences
   */
  findClosest(sentences, timeMs) {
    // First try exact match
    const exact = this.findByTime(sentences, timeMs);
    if (exact >= 0) return exact;

    // Find first sentence that starts after timeMs
    for (let i = 0; i < sentences.length; i++) {
      if (sentences[i].startMs >= timeMs) return i;
      if (sentences[i].endMs > timeMs) return i;
    }
    return -1;
  }
};
