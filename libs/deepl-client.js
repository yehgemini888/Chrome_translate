/* Chrome Translate — DeepL API Client */
'use strict';

const DeepLClient = {
  /**
   * Translate an array of texts via DeepL Free API.
   * @param {string} apiKey - DeepL API key
   * @param {string[]} texts - Array of texts to translate
   * @param {string} targetLang - Target language code (e.g. 'ZH-HANT')
   * @returns {Promise<{translations: string[], sourceLang: string}>}
   */
  async translate(apiKey, texts, targetLang) {
    if (!apiKey) throw new DeepLError('API Key 未設定', 'NO_KEY');
    if (!texts.length) return { translations: [], sourceLang: '' };

    const body = new URLSearchParams();
    texts.forEach(t => body.append('text', t));
    body.append('target_lang', targetLang);

    const data = await this._request(apiKey, CT.DEEPL_API_URL, body);

    return {
      translations: data.translations.map(t => t.text),
      sourceLang: data.translations[0]?.detected_source_language || ''
    };
  },

  /**
   * Validate API key and get usage info.
   * @param {string} apiKey
   * @returns {Promise<{valid: boolean, usage: {character_count: number, character_limit: number}}>}
   */
  async getUsage(apiKey) {
    if (!apiKey) return { valid: false, usage: null };

    try {
      const data = await this._request(apiKey, CT.DEEPL_USAGE_URL, null, 'GET');
      return {
        valid: true,
        usage: {
          character_count: data.character_count,
          character_limit: data.character_limit
        }
      };
    } catch (e) {
      if (e.code === 'AUTH_FAILED') {
        return { valid: false, usage: null };
      }
      throw e;
    }
  },

  /**
   * Internal: make a request to DeepL API with retry logic.
   */
  async _request(apiKey, url, body, method = 'POST', retries = 3) {
    let lastError;

    for (let attempt = 0; attempt < retries; attempt++) {
      if (attempt > 0) {
        // Exponential backoff: 1s, 2s, 4s
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
      }

      try {
        const options = {
          method,
          headers: {
            'Authorization': `DeepL-Auth-Key ${apiKey}`
          }
        };

        if (method === 'POST' && body) {
          options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
          options.body = body.toString();
        }

        const response = await fetch(url, options);

        if (response.ok) {
          return await response.json();
        }

        // Handle specific error codes
        switch (response.status) {
          case 403:
            throw new DeepLError('API Key 無效，請檢查設定', 'AUTH_FAILED');
          case 456:
            throw new DeepLError('本月翻譯額度已用盡 (500,000 字元)', 'QUOTA_EXCEEDED');
          case 429:
            // Rate limited — retry with backoff
            lastError = new DeepLError('請求過於頻繁，稍後重試', 'RATE_LIMITED');
            continue;
          default:
            if (response.status >= 500) {
              lastError = new DeepLError(`DeepL 伺服器錯誤 (${response.status})`, 'SERVER_ERROR');
              continue;
            }
            throw new DeepLError(`DeepL API 錯誤: ${response.status}`, 'API_ERROR');
        }
      } catch (e) {
        if (e instanceof DeepLError) throw e;
        lastError = new DeepLError(`網路錯誤: ${e.message}`, 'NETWORK_ERROR');
      }
    }

    throw lastError;
  }
};

/**
 * Custom error class for DeepL API errors.
 */
class DeepLError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'DeepLError';
    this.code = code;
  }
}
