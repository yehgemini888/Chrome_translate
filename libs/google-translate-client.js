/* Chrome Translate — Google Translate Client (Free API) */
'use strict';

const GoogleTranslateClient = {
  /**
   * Translate an array of texts via Google Translate free endpoint.
   * Sends individual requests per text with concurrency control for reliability.
   *
   * @param {string[]} texts - Array of texts to translate
   * @param {string} targetLang - Target language code (e.g. 'zh-TW')
   * @returns {Promise<{translations: string[], sourceLang: string}>}
   */
  async translate(texts, targetLang) {
    if (!texts.length) return { translations: [], sourceLang: '' };

    const MAX_CONCURRENT = 5;
    const translations = new Array(texts.length).fill('');
    let sourceLang = '';

    // Process texts with concurrency control
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
   * Worker that pulls items from a shared queue and translates them.
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
   * Parse Google Translate API response.
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
