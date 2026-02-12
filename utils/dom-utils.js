/* Chrome Translate — DOM Utilities */
'use strict';

const CTDom = {
  MIN_TEXT_LENGTH: 2,

  BLOCK_ELEMENT_TAGS: new Set([
    'DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'LI', 'DT', 'DD', 'BLOCKQUOTE', 'FIGURE', 'FIGCAPTION',
    'ARTICLE', 'SECTION', 'ASIDE', 'MAIN', 'NAV',
    'HEADER', 'FOOTER', 'FORM', 'FIELDSET',
    'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH',
    'UL', 'OL', 'DL', 'PRE', 'ADDRESS',
    'DETAILS', 'SUMMARY', 'DIALOG'
  ]),

  /**
   * Check if an element is inside a navigation context (nav bar, menu bar, etc.).
   * Walks up max 6 ancestor levels.
   */
  _isInNavContext(el) {
    let current = el;
    for (let i = 0; i < 6 && current; i++) {
      if (!current.tagName) break;
      if (current.tagName === 'NAV') return true;
      const role = current.getAttribute && current.getAttribute('role');
      if (role === 'navigation' || role === 'menubar') return true;
      const cls = current.className;
      if (cls && typeof cls === 'string' && /\b(navbar|nav-bar|menubar|menu-bar|topbar|top-bar|main-nav|site-nav)\b/i.test(cls)) return true;
      current = current.parentElement;
    }
    return false;
  },

  /**
   * Post-filter: decide whether a text block should be translated.
   * Returns false for timestamps, numbers-only, short labels, CJK-majority text,
   * visually-hidden elements (skip links), bylines, financial data, etc.
   */
  _shouldTranslate(element, text) {
    // Rule 0: Skip visually hidden / off-screen elements (skip navigation links, sr-only)
    try {
      const rect = element.getBoundingClientRect();
      if (rect.width < 1 && rect.height < 1) return false;
      if (rect.right < -500 || rect.left > window.innerWidth + 500) return false;
    } catch (e) { /* ignore */ }

    // Rule 1: Skip <time> elements
    if (element.tagName === 'TIME') return false;

    // Rule 2: Skip elements inside logo/brand/badge/financial containers (6 ancestor levels)
    let ancestor = element;
    let inAside = false;
    let inTable = false;
    for (let i = 0; i < 6 && ancestor; i++) {
      if (!ancestor.tagName) break;
      if (ancestor.tagName === 'ASIDE') inAside = true;
      if (ancestor.tagName === 'TABLE') inTable = true;

      const cls = ancestor.className;
      if (cls && typeof cls === 'string' && CT.SKIP_CONTAINER_PATTERNS.test(cls)) return false;

      // Check element id for financial/market widgets
      if (ancestor.id && CT.SKIP_ID_PATTERNS && CT.SKIP_ID_PATTERNS.test(ancestor.id)) return false;

      // Check data-testid / data-id for financial widgets
      if (ancestor.getAttribute) {
        const testId = ancestor.getAttribute('data-testid') || ancestor.getAttribute('data-id');
        if (testId && CT.SKIP_ID_PATTERNS && CT.SKIP_ID_PATTERNS.test(testId)) return false;
      }

      ancestor = ancestor.parentElement;
    }

    // Rule 2b: Skip data tables inside sidebars (financial data, scoreboards, etc.)
    if (inAside && inTable) return false;

    // Rule 3: Skip numbers-only text
    if (CT.NUMBERS_ONLY_PATTERN.test(text)) return false;

    // Rule 4: Skip timestamp patterns
    if (CT.TIMESTAMP_PATTERN.test(text)) return false;

    // Rule 5: Skip short non-heading text (< MIN_TRANSLATE_LENGTH chars)
    const tag = element.tagName;
    const isHeading = tag === 'H1' || tag === 'H2' || tag === 'H3' ||
                      tag === 'H4' || tag === 'H5' || tag === 'H6';
    if (!isHeading && text.length < CT.MIN_TRANSLATE_LENGTH) return false;

    // Rule 6: Skip text that is > 50% CJK characters (already in target language)
    const cjkMatches = text.match(CT.CJK_PATTERN);
    if (cjkMatches && cjkMatches.length / text.length > 0.5) return false;

    // Rule 7: Skip short byline/attribution text with relative time
    // e.g. "Yahoo Finance · 3h ago", "Bloomberg · 32m ago", "Reuters · 1h ago"
    if (text.length < 80) {
      if (/\d+\s*(sec|min|hour|hr|day|week|month|year|[mhd])\w*\.?\s*ago/i.test(text)) return false;
      if (/[·•|]\s*\d+\s*[mhd]\s*$/i.test(text)) return false;
    }

    return true;
  },

  /**
   * Check if an element contains any block-level descendants with text.
   * Looks through inline wrappers (like <a>, <span>) to find nested blocks.
   */
  _hasBlockDescendant(el) {
    for (const child of el.children) {
      try {
        if (CT.SKIP_TAGS.has(child.tagName)) continue;
        if (this.BLOCK_ELEMENT_TAGS.has(child.tagName)) {
          if (child.textContent && child.textContent.trim().length > 0) return true;
        }
        // Look through inline wrappers (a, span, em, strong, etc.)
        if (!this.BLOCK_ELEMENT_TAGS.has(child.tagName) && child.children && child.children.length > 0) {
          if (this._hasBlockDescendant(child)) return true;
        }
      } catch (e) { /* skip */ }
    }
    return false;
  },

  /**
   * Extract translatable text blocks using recursive descent.
   * - Element has block descendants with text → CONTAINER → recurse
   * - Element has NO block descendants → LEAF → translate its innerText
   * Handles modern patterns like <a> wrapping <h3>+<p>.
   */
  extractTextBlocks(root = document.body) {
    const blocks = [];
    const visited = new Set();

    const walk = (el) => {
      try {
        if (!el || !el.tagName) return;
        if (CT.SKIP_TAGS.has(el.tagName)) return;
        if (visited.has(el)) return;

        // Skip our own elements
        if (el.className && typeof el.className === 'string' &&
            el.className.indexOf('ct-') !== -1) return;

        // Check if this element contains block-level descendants (even through inline wrappers)
        if (CTDom._hasBlockDescendant(el)) {
          // CONTAINER: recurse into all children
          for (const child of el.children) {
            walk(child);
          }
        } else {
          // LEAF: translate this element's text
          const text = (el.innerText || el.textContent || '').trim();
          if (text.length >= CTDom.MIN_TEXT_LENGTH) {
            visited.add(el);
            blocks.push({ element: el, text });
          }
        }
      } catch (e) {
        // Skip problematic elements silently
      }
    };

    walk(root);
    const filtered = blocks.filter(b => CTDom._shouldTranslate(b.element, b.text));
    console.log('[Chrome Translate] Found', blocks.length, 'text blocks,', filtered.length, 'after filtering');
    return filtered;
  },

  /**
   * Insert translated text below the source element.
   */
  insertTranslation(sourceElement, translatedText, id) {
    CTDom.removeTranslation(sourceElement);

    // Use inline class for nav context or short text in nav-like areas
    const useInline = CTDom._isInNavContext(sourceElement);
    const el = document.createElement('span');
    el.className = useInline ? CT.CLS_TRANSLATED_INLINE : CT.CLS_TRANSLATED;
    el.setAttribute(CT.ATTR_CT_ID, id);
    el.textContent = translatedText;

    sourceElement.setAttribute(CT.ATTR_TRANSLATED, id);

    // Copy source element's font properties so translation matches its visual style
    // (e.g. headings stay large+bold, body text stays normal size)
    try {
      const computed = window.getComputedStyle(sourceElement);
      el.style.setProperty('font-size', computed.fontSize, 'important');
      el.style.setProperty('font-weight', computed.fontWeight, 'important');
    } catch (e) { /* ignore */ }

    const tag = sourceElement.tagName;
    const parentTag = sourceElement.parentElement ? sourceElement.parentElement.tagName : '';

    if (tag === 'TD' || tag === 'TH' || tag === 'LI' ||
        tag === 'DT' || tag === 'DD' ||
        parentTag === 'TD' || parentTag === 'TH' ||
        parentTag === 'TR' || parentTag === 'TABLE' ||
        parentTag === 'TBODY') {
      sourceElement.appendChild(el);
    } else {
      sourceElement.insertAdjacentElement('afterend', el);
    }

    return el;
  },

  removeTranslation(sourceElement) {
    const id = sourceElement.getAttribute(CT.ATTR_TRANSLATED);
    if (!id) return;
    const selector = `.${CT.CLS_TRANSLATED}[${CT.ATTR_CT_ID}="${id}"], .${CT.CLS_TRANSLATED_INLINE}[${CT.ATTR_CT_ID}="${id}"]`;
    const existing = document.querySelector(selector);
    if (existing) existing.remove();
    sourceElement.removeAttribute(CT.ATTR_TRANSLATED);
  },

  removeAllTranslations() {
    document.querySelectorAll(`.${CT.CLS_TRANSLATED}, .${CT.CLS_TRANSLATED_INLINE}`).forEach(el => el.remove());
    document.querySelectorAll(`[${CT.ATTR_TRANSLATED}]`).forEach(el => {
      el.removeAttribute(CT.ATTR_TRANSLATED);
    });
  },

  batchTexts(texts) {
    const batches = [];
    let currentTexts = [];
    let currentIndices = [];
    let currentChars = 0;

    texts.forEach((text, index) => {
      if (
        currentTexts.length >= CT.BATCH_MAX_TEXTS ||
        (currentChars + text.length > CT.BATCH_MAX_CHARS && currentTexts.length > 0)
      ) {
        batches.push({ texts: currentTexts, indices: currentIndices });
        currentTexts = [];
        currentIndices = [];
        currentChars = 0;
      }
      currentTexts.push(text);
      currentIndices.push(index);
      currentChars += text.length;
    });

    if (currentTexts.length > 0) {
      batches.push({ texts: currentTexts, indices: currentIndices });
    }

    return batches;
  }
};
