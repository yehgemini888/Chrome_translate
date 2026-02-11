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
    console.log('[Chrome Translate] Found', blocks.length, 'text blocks');
    return blocks;
  },

  /**
   * Insert translated text below the source element.
   */
  insertTranslation(sourceElement, translatedText, id) {
    CTDom.removeTranslation(sourceElement);

    const el = document.createElement('span');
    el.className = CT.CLS_TRANSLATED;
    el.setAttribute(CT.ATTR_CT_ID, id);
    el.textContent = translatedText;

    sourceElement.setAttribute(CT.ATTR_TRANSLATED, id);

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
    const existing = document.querySelector(
      `.${CT.CLS_TRANSLATED}[${CT.ATTR_CT_ID}="${id}"]`
    );
    if (existing) existing.remove();
    sourceElement.removeAttribute(CT.ATTR_TRANSLATED);
  },

  removeAllTranslations() {
    document.querySelectorAll(`.${CT.CLS_TRANSLATED}`).forEach(el => el.remove());
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
