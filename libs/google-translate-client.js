/* Chrome Translate — Google Translate Client (Free API) */
'use strict';

const GoogleTranslateClient = {
  /**
   * Translate an array of texts via Google Translate free endpoint.
   * Batch mode: joins texts with \n separator, sends as single POST request.
   * Falls back to individual requests if batch parsing fails.
   *
   * @param {string[]} texts - Array of texts to translate
   * @param {string} targetLang - Target language code (e.g. 'zh-TW')
   * @returns {Promise<{translations: string[], sourceLang: string}>}
   */
  async translate(texts, targetLang) {
    if (!texts.length) return { translations: [], sourceLang: '' };

    // ── Batch mode: join with \n, single HTTP request ──
    // Reduces N individual requests to 1, avoiding Google rate limiting.
    const cleanTexts = texts.map(t => t.replace(/\n/g, ' ').trim());

    try {
      const joined = cleanTexts.join('\n');
      const result = await this._translateBatch(joined, targetLang);
      const lines = result.text.split('\n');
      const translations = new Array(texts.length).fill('');

      for (let i = 0; i < Math.min(lines.length, texts.length); i++) {
        translations[i] = lines[i].trim();
      }

      // Check: if too few lines returned, some translations may be empty.
      // This is acceptable graceful degradation vs 429 errors.
      return { translations, sourceLang: result.sourceLang };
    } catch (e) {
      console.warn('[Google Translate] Batch failed, falling back to individual:', e.message);
    }

    // ── Fallback: individual requests with reduced concurrency ──
    const MAX_CONCURRENT = 3;
    const translations = new Array(texts.length).fill('');
    let sourceLang = '';

    const queue = texts.map((text, i) => ({ text, index: i }));
    const workers = [];

    for (let i = 0; i < Math.min(MAX_CONCURRENT, queue.length); i++) {
      workers.push(this._processQueue(queue, translations, targetLang, (lang) => {
        if (!sourceLang && lang) sourceLang = lang;
      }));
    }

    await Promise.all(workers);
    return { translations, sourceLang };
  },

  /**
   * Batch translate joined text via POST (avoids URL length limits).
   * @param {string} joinedText - Texts joined by \n
   * @param {string} targetLang
   * @returns {Promise<{text: string, sourceLang: string}>}
   */
  async _translateBatch(joinedText, targetLang) {
    const params = new URLSearchParams({
      client: 'gtx',
      sl: 'auto',
      tl: targetLang,
      dt: 't',
      q: joinedText
    });

    let response = await fetch(CT.GOOGLE_TRANSLATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    if (!response.ok) {
      if (response.status === 429) {
        await new Promise(r => setTimeout(r, 2000));
        response = await fetch(CT.GOOGLE_TRANSLATE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString()
        });
        if (!response.ok) {
          throw new TranslateError('Google 翻譯請求過於頻繁', 'RATE_LIMITED');
        }
      } else {
        throw new TranslateError(`Google 翻譯錯誤: ${response.status}`, 'API_ERROR');
      }
    }

    const data = await response.json();
    return this._parseResponse(data);
  },

  /**
   * Worker that pulls items from a shared queue and translates them.
   * Used as fallback when batch translation fails.
   */
  async _processQueue(queue, results, targetLang, onLang) {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) return;

      try {
        const result = await this.translateSingle(item.text, targetLang);
        results[item.index] = result.text;
        onLang(result.sourceLang);
      } catch (e) {
        console.error('[Google Translate] Failed to translate text:', item.text.substring(0, 50), e.message);
        results[item.index] = ''; // Leave empty on failure
      }
    }
  },

  /**
   * Translate a single text via Google Translate free endpoint.
   * @param {string} text
   * @param {string} targetLang
   * @returns {Promise<{text: string, sourceLang: string}>}
   */
  async translateSingle(text, targetLang) {
    const params = new URLSearchParams({
      client: 'gtx',
      sl: 'auto',
      tl: targetLang,
      dt: 't',
      q: text
    });

    const url = CT.GOOGLE_TRANSLATE_URL + '?' + params.toString();

    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 429) {
        // Rate limited — wait and retry once
        await new Promise(r => setTimeout(r, 1000));
        const retry = await fetch(url);
        if (!retry.ok) {
          throw new TranslateError('Google 翻譯請求過於頻繁', 'RATE_LIMITED');
        }
        const retryData = await retry.json();
        return this._parseResponse(retryData);
      }
      throw new TranslateError(`Google 翻譯錯誤: ${response.status}`, 'API_ERROR');
    }

    const data = await response.json();
    return this._parseResponse(data);
  },

  /**
   * Translate text and return Google's sentence-level segmentation.
   * Unlike translate(), this preserves the original text per segment
   * from Google's response, enabling AI-based sentence boundary detection.
   *
   * @param {string} text - Full text to translate (one chunk, <=4000 chars)
   * @param {string} targetLang - Target language code
   * @returns {Promise<{segments: Array<{translated: string, original: string}>, sourceLang: string}>}
   */
  async translateWithSegments(text, targetLang) {
    const params = new URLSearchParams({
      client: 'gtx',
      sl: 'auto',
      tl: targetLang,
      dt: 't',
      q: text
    });

    let response = await fetch(CT.GOOGLE_TRANSLATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    if (!response.ok) {
      if (response.status === 429) {
        await new Promise(r => setTimeout(r, 2000));
        response = await fetch(CT.GOOGLE_TRANSLATE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString()
        });
        if (!response.ok) {
          throw new TranslateError('Google 翻譯請求過於頻繁', 'RATE_LIMITED');
        }
      } else {
        throw new TranslateError(`Google 翻譯錯誤: ${response.status}`, 'API_ERROR');
      }
    }

    const data = await response.json();
    return this._parseSegmentedResponse(data);
  },

  /**
   * Translate text nodes as HTML using <a i=N> markers (Immersive Translate technique).
   * Google's format=html endpoint preserves <a> tag positions in the translation,
   * so we can map translations back to individual text nodes (preserving links, bold, etc.).
   *
   * @param {string[]} textNodesContent - Array of text node contents within one piece
   * @param {string} targetLang - Target language code
   * @returns {Promise<{translations: string[], sourceLang: string}>}
   */
  async translateHTML(textNodesContent, targetLang) {
    if (!textNodesContent.length) return { translations: [], sourceLang: '' };

    // If only one text node, use simple translation (no need for markers)
    if (textNodesContent.length === 1) {
      const result = await this.translateSingle(textNodesContent[0], targetLang);
      return { translations: [result.text], sourceLang: result.sourceLang };
    }

    // Build HTML with indexed <a> tags (same technique as Immersive Translate)
    // Escape HTML entities in text, then wrap each node's text in <a i=N>
    const escaped = textNodesContent.map(t => this._escapeHTML(t));
    const tagged = escaped.map((text, i) => `<a i=${i}>${text}</a>`);
    const htmlPayload = `<pre>${tagged.join('')}</pre>`;

    // Use the HTML-aware Google Translate endpoint
    const url = CT.GOOGLE_TRANSLATE_HTML_URL;
    const body = `q=${encodeURIComponent(htmlPayload)}&sl=auto&tl=${targetLang}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });

    if (!response.ok) {
      if (response.status === 429) {
        await new Promise(r => setTimeout(r, 1000));
        const retry = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body
        });
        if (!retry.ok) {
          throw new TranslateError('Google 翻譯請求過於頻繁', 'RATE_LIMITED');
        }
        return this._parseHTMLResponse(await retry.json(), textNodesContent.length);
      }
      throw new TranslateError(`Google 翻譯錯誤: ${response.status}`, 'API_ERROR');
    }

    const data = await response.json();
    return this._parseHTMLResponse(data, textNodesContent.length);
  },

  /**
   * Parse response from the format=html Google Translate endpoint.
   * The response contains <b>translated</b><i>original</i> pairs and <a i=N> markers.
   */
  _parseHTMLResponse(data, nodeCount) {
    let result = '';
    let sourceLang = '';

    // Response format: string or [string, lang] or [[string, lang], ...]
    if (typeof data === 'string') {
      result = data;
    } else if (Array.isArray(data)) {
      if (typeof data[0] === 'string') {
        result = data[0];
        sourceLang = data[1] || '';
      } else if (Array.isArray(data[0])) {
        result = data[0][0] || '';
        sourceLang = data[0][1] || '';
      }
    }

    // Strip <pre> wrapper
    if (result.indexOf('<pre') !== -1) {
      result = result.replace('</pre>', '');
      const idx = result.indexOf('>');
      result = result.slice(idx + 1);
    }

    // Extract translated sentences from <b> tags (Google wraps translations in <b>)
    // and ignore original text in <i> tags
    const sentences = [];
    let pos = 0;
    while (true) {
      const bStart = result.indexOf('<b>', pos);
      if (bStart === -1) break;
      const iStart = result.indexOf('<i>', bStart);
      if (iStart === -1) {
        sentences.push(result.slice(bStart + 3));
        break;
      } else {
        sentences.push(result.slice(bStart + 3, iStart));
      }
      pos = iStart;
    }

    const merged = sentences.length > 0 ? sentences.join(' ') : result;
    const cleaned = merged.replace(/<\/b>/g, '');

    // Parse <a i=N> tags to extract per-node translations
    const translations = new Array(nodeCount).fill('');

    // Match all <a i=N>text</a> segments, handling text outside tags
    const tagRegex = /(<a\si=[0-9]+>)([^<>]*(?=<\/a>))*/g;
    let lastEnd = 0;
    const segments = [];

    for (const m of cleaned.matchAll(tagRegex)) {
      const fullText = m[0];
      const aTag = m[1];
      const insideText = m[2] || '';
      const mPos = m.index;

      // Text before this tag belongs to the nearest <a> tag
      if (mPos > lastEnd) {
        const outsideText = cleaned.slice(lastEnd, mPos).replace(/<\/a>/g, '');
        segments.push({ tag: aTag, text: outsideText + insideText });
      } else {
        segments.push({ tag: aTag, text: insideText });
      }
      lastEnd = mPos + fullText.length;
    }

    // Trailing text after the last tag
    if (segments.length > 0) {
      const trailing = cleaned.slice(lastEnd).replace(/<\/a>/g, '');
      if (trailing.trim()) {
        segments[segments.length - 1].text += trailing;
      }
    }

    // Map segments to node indices
    for (const seg of segments) {
      const idxMatch = seg.tag.match(/[0-9]+(?=>)/);
      if (idxMatch) {
        const idx = parseInt(idxMatch[0]);
        if (idx >= 0 && idx < nodeCount) {
          if (translations[idx]) {
            translations[idx] += ' ' + this._unescapeHTML(seg.text);
          } else {
            translations[idx] = this._unescapeHTML(seg.text);
          }
        }
      }
    }

    // Fallback: if no tags were parsed, use the whole result for node 0
    if (segments.length === 0) {
      translations[0] = this._unescapeHTML(cleaned);
    }

    return { translations, sourceLang };
  },

  /**
   * Parse Google Translate API response (plain text mode).
   */
  _parseResponse(data) {
    let translated = '';
    if (data && data[0]) {
      translated = data[0]
        .filter(seg => seg && seg[0])
        .map(seg => seg[0])
        .join('');
    }
    const sourceLang = data[2] || '';
    return { text: translated.trim(), sourceLang };
  },

  /**
   * Parse Google Translate response preserving per-segment original text.
   * Google response: data[0] = [[translatedText, originalText, ...], ...]
   */
  _parseSegmentedResponse(data) {
    const segments = [];
    if (data && data[0]) {
      for (const seg of data[0]) {
        if (seg && (seg[0] || seg[1])) {
          segments.push({
            translated: (seg[0] || '').trim(),
            original: (seg[1] || '').trim()
          });
        }
      }
    }
    const sourceLang = data[2] || '';
    return { segments, sourceLang };
  },

  _escapeHTML(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  _unescapeHTML(str) {
    return str
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }
};

/**
 * Custom error class for translation errors.
 */
class TranslateError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'TranslateError';
    this.code = code;
  }
}
