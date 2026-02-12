/* Chrome Translate — YouTube Subtitle Interceptor */
/* Runs in MAIN world — NO chrome.* API access */
/* Communicates with content script via window.postMessage */
'use strict';

(function() {
  // KEEP IN SYNC with CT.MSG_YT_SUBTITLES in utils/constants.js
  const CT_MSG_TYPE = 'CT_SUBTITLES_RAW';
  const TIMEDTEXT_PATTERN = /\/api\/timedtext/;
  const TIMEDTEXT_PATTERN_ALT = /timedtext/;

  // ─── Patch fetch ─────────────────────────────────────────

  const originalFetch = window.fetch;

  window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);

    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';

      if (TIMEDTEXT_PATTERN.test(url) || TIMEDTEXT_PATTERN_ALT.test(url)) {
        // Clone the response so we don't consume the original
        const clone = response.clone();
        processTimedTextResponse(clone, url).catch(() => {});
      }
    } catch (e) {
      // Silent fail — don't break YouTube
    }

    return response;
  };

  // ─── Patch XMLHttpRequest ────────────────────────────────

  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this._ctUrl = typeof url === 'string' ? url : url?.toString() || '';
    return originalXHROpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function(...args) {
    if (this._ctUrl && (TIMEDTEXT_PATTERN.test(this._ctUrl) || TIMEDTEXT_PATTERN_ALT.test(this._ctUrl))) {
      this.addEventListener('load', function() {
        try {
          if (this.responseText) {
            processTimedTextXHR(this.responseText, this._ctUrl);
          }
        } catch (e) {
          // Silent fail
        }
      });
    }
    return originalXHRSend.apply(this, args);
  };

  // ─── Process subtitle responses ──────────────────────────

  async function processTimedTextResponse(response, url) {
    console.log('[CT Interceptor] Processing timedtext response:', url);
    const contentType = response.headers.get('content-type') || '';
    let data;

    if (contentType.includes('json') || url.includes('fmt=json3') || url.includes('fmt=srv3')) {
      data = await response.json();
    } else {
      const text = await response.text();
      // Try to parse as JSON first
      try {
        data = JSON.parse(text);
      } catch {
        // Might be XML format — parse it
        data = parseXMLSubtitles(text);
      }
    }

    if (data) {
      const subtitles = normalizeSubtitles(data, url);
      if (subtitles && subtitles.length > 0) {
        console.log('[CT Interceptor] Normalized subtitles:', subtitles.length);
        postSubtitles(subtitles, url);
      } else {
        console.log('[CT Interceptor] No subtitles found after normalization');
      }
    } else {
      console.log('[CT Interceptor] Failed to parse subtitle data');
    }
  }

  function processTimedTextXHR(responseText, url) {
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      data = parseXMLSubtitles(responseText);
    }

    if (data) {
      const subtitles = normalizeSubtitles(data, url);
      if (subtitles && subtitles.length > 0) {
        postSubtitles(subtitles, url);
      }
    }
  }

  // ─── Parse XML subtitle format ───────────────────────────

  function parseXMLSubtitles(xmlText) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlText, 'text/xml');
      const textNodes = doc.querySelectorAll('text');

      if (textNodes.length === 0) return null;

      return {
        _xmlParsed: true,
        events: Array.from(textNodes).map(node => ({
          tStartMs: Math.round(parseFloat(node.getAttribute('start') || '0') * 1000),
          dDurationMs: Math.round(parseFloat(node.getAttribute('dur') || '0') * 1000),
          segs: [{ utf8: node.textContent || '' }]
        }))
      };
    } catch {
      return null;
    }
  }

  // ─── Normalize to common format ──────────────────────────

  function normalizeSubtitles(data, url) {
    if (!data) return null;

    // JSON3 format (most common)
    if (data.events) {
      return data.events
        .filter(e => e.segs && e.segs.length > 0)
        .map(e => ({
          startMs: e.tStartMs || 0,
          durationMs: e.dDurationMs || 0,
          text: e.segs.map(s => s.utf8 || '').join('').trim()
        }))
        .filter(s => s.text.length > 0);
    }

    return null;
  }

  // ─── Post to content script ──────────────────────────────

  function postSubtitles(subtitles, url) {
    // Extract language from URL params
    const urlObj = new URL(url, window.location.origin);
    const lang = urlObj.searchParams.get('lang') || urlObj.searchParams.get('tlang') || 'unknown';

    console.log('[CT Interceptor] Posting subtitles:', subtitles.length, 'items, language:', lang);

    document.dispatchEvent(new CustomEvent('CT_SUBTITLES_READY', {
      detail: {
        subtitles: subtitles,
        language: lang,
        videoId: urlObj.searchParams.get('v') || extractVideoId(),
        timestamp: Date.now()
      }
    }));
  }

  function extractVideoId() {
    const match = window.location.href.match(/[?&]v=([^&]+)/);
    return match ? match[1] : '';
  }

  // Signal that interceptor is ready
  document.dispatchEvent(new CustomEvent('CT_INTERCEPTOR_READY'));
})();
