/* Chrome Translate — YouTube Subtitle Preprocessor */
/* Merges ASR fragments into complete sentences for better translation & sync */
'use strict';

const CTYouTubePreprocessor = {
  // ─── Configuration ─────────────────────────────────────
  PAUSE_THRESHOLD: 300,       // ms gap to trigger sentence break
  MAX_SENTENCE_CHARS: 80,     // max chars before forced break (~1-2 subtitle lines)
  MAX_FRAGMENTS: 12,          // max fragments before forced break

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
  },

  // ─── AI Segmentation Support ──────────────────────────────

  /**
   * Build a character-offset index from raw ASR fragments.
   * Joins all fragment text into a single string and tracks each fragment's
   * character position range for mapping Google Translate segments back to timestamps.
   *
   * @param {Array<{startMs: number, durationMs: number, text: string}>} rawEvents
   * @returns {{joinedText: string, fragments: Array<{text: string, startMs: number, endMs: number, charStart: number, charEnd: number}>}}
   */
  buildFragmentIndex(rawEvents) {
    const fragments = [];
    let joinedText = '';

    for (const event of rawEvents) {
      const text = (event.text || '').trim();
      if (!text) continue;

      const startMs = event.startMs || 0;
      const endMs = startMs + (event.durationMs || 0);

      if (joinedText.length > 0) {
        const lastChar = joinedText[joinedText.length - 1];
        const firstChar = text[0];
        if (!this._CJK_RANGE.test(lastChar) && !this._CJK_RANGE.test(firstChar)) {
          joinedText += ' ';
        }
      }

      const charStart = joinedText.length;
      joinedText += text;
      const charEnd = joinedText.length;

      fragments.push({ text, startMs, endMs, charStart, charEnd });
    }

    return { joinedText, fragments };
  },

  /**
   * Split fragment index into chunks for Google Translate requests.
   * Prefers splitting at large pause gaps (>1s) to keep semantic coherence.
   * Each chunk stays under maxChars characters.
   *
   * @param {{joinedText: string, fragments: Array}} fragmentIndex
   * @param {number} [maxChars=4000]
   * @returns {Array<{text: string, charStart: number, charEnd: number, fragmentStartIdx: number, fragmentEndIdx: number}>}
   */
  splitIntoChunks(fragmentIndex, maxChars) {
    maxChars = maxChars || 4000;
    const PAUSE_SPLIT = 1000; // ms — prefer splitting at >1s pauses
    const { joinedText, fragments } = fragmentIndex;

    if (fragments.length === 0) return [];

    if (joinedText.length <= maxChars) {
      return [{
        text: joinedText,
        charStart: 0,
        charEnd: joinedText.length,
        fragmentStartIdx: 0,
        fragmentEndIdx: fragments.length - 1
      }];
    }

    const chunks = [];
    let chunkStart = 0;

    while (chunkStart < fragments.length) {
      // Find the furthest fragment that fits within maxChars
      let fitEnd = chunkStart;
      const baseChar = fragments[chunkStart].charStart;

      for (let i = chunkStart; i < fragments.length; i++) {
        if (fragments[i].charEnd - baseChar > maxChars && i > chunkStart) break;
        fitEnd = i;
      }

      // Within range, find the best pause-gap split point
      let bestSplit = fitEnd;
      let maxGap = 0;

      for (let i = chunkStart + 1; i <= fitEnd; i++) {
        const gap = fragments[i].startMs - fragments[i - 1].endMs;
        if (gap >= PAUSE_SPLIT && gap > maxGap) {
          // Only split if first part has enough content (>30%)
          const partChars = fragments[i - 1].charEnd - baseChar;
          if (partChars >= maxChars * 0.3 || partChars >= 500) {
            maxGap = gap;
            bestSplit = i - 1;
          }
        }
      }

      const startFrag = fragments[chunkStart];
      const endFrag = fragments[bestSplit];
      chunks.push({
        text: joinedText.substring(startFrag.charStart, endFrag.charEnd),
        charStart: startFrag.charStart,
        charEnd: endFrag.charEnd,
        fragmentStartIdx: chunkStart,
        fragmentEndIdx: bestSplit
      });

      chunkStart = bestSplit + 1;
    }

    return chunks;
  },

  /**
   * Map Google Translate segments back to word-level timestamps.
   * For each segment's original text, finds matching character range
   * in the joined text, then determines overlapping fragments for timing.
   *
   * @param {Array<{translated: string, original: string}>} segments
   * @param {{joinedText: string, fragments: Array}} fragmentIndex
   * @param {number} chunkCharStart - Character offset of this chunk in the full joinedText
   * @returns {Array<{text: string, translation: string, startMs: number, endMs: number}>}
   */
  mapSegmentsToTimestamps(segments, fragmentIndex, chunkCharStart) {
    const { joinedText, fragments } = fragmentIndex;
    const sentences = [];
    let searchFrom = chunkCharStart;

    for (const seg of segments) {
      if (!seg.original && !seg.translated) continue;

      const original = seg.original || '';
      const translated = seg.translated || '';

      // Find this segment's position in the joined text
      let matchStart = -1;
      let matchEnd = -1;

      // Strategy 1: exact substring match
      const exactIdx = joinedText.indexOf(original, searchFrom);
      if (exactIdx >= 0) {
        matchStart = exactIdx;
        matchEnd = exactIdx + original.length;
      }

      // Strategy 2: case-insensitive
      if (matchStart < 0) {
        const lowerJoined = joinedText.toLowerCase();
        const lowerOrig = original.toLowerCase();
        const ciIdx = lowerJoined.indexOf(lowerOrig, searchFrom);
        if (ciIdx >= 0) {
          matchStart = ciIdx;
          matchEnd = ciIdx + original.length;
        }
      }

      // Strategy 3: strip punctuation Google may have added
      if (matchStart < 0) {
        const stripped = original.replace(/[.,!?;:'"()\u3002\uFF01\uFF1F]/g, '').trim();
        if (stripped.length > 0) {
          const strippedIdx = joinedText.toLowerCase().indexOf(stripped.toLowerCase(), searchFrom);
          if (strippedIdx >= 0) {
            matchStart = strippedIdx;
            matchEnd = strippedIdx + stripped.length;
          }
        }
      }

      // Strategy 4: proportional fallback
      if (matchStart < 0) {
        matchStart = searchFrom;
        const ratio = original.length / Math.max(1, joinedText.length);
        matchEnd = Math.min(joinedText.length, matchStart + Math.max(1, Math.round(ratio * joinedText.length)));
      }

      // Find overlapping fragments → timestamps
      let startMs = -1;
      let endMs = -1;
      let fragmentText = '';

      for (const frag of fragments) {
        if (frag.charEnd > matchStart && frag.charStart < matchEnd) {
          if (startMs < 0) startMs = frag.startMs;
          endMs = frag.endMs;
          fragmentText = fragmentText ? this._joinText(fragmentText, frag.text) : frag.text;
        }
      }

      if (startMs >= 0 && fragmentText) {
        sentences.push({
          text: fragmentText,
          translation: translated,
          startMs: startMs,
          endMs: endMs
        });
      }

      if (matchEnd > searchFrom) searchFrom = matchEnd;
    }

    return sentences;
  }
};
