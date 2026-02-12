/* Chrome Translate — DOM Utilities (V2: Text Node Level Traversal) */
'use strict';

const CTDom = {
  MIN_TEXT_LENGTH: 2,

  /**
   * Check if a node should be skipped from translation.
   * Uses W3C standards only — no CSS class/ID heuristics.
   */
  _isNoTranslateNode(node) {
    if (!node || !node.getAttribute) return false;
    // HTML5 standard: translate="no"
    if (node.getAttribute('translate') === 'no') return true;
    // Google convention: class="notranslate"
    if (node.classList && node.classList.contains('notranslate')) return true;
    // Explicit contenteditable (not inherited — avoids skipping entire page)
    if (node.getAttribute('contenteditable') === 'true') return true;
    // Our own injected elements (Strategy A: data attribute)
    if (node.hasAttribute(CT.ATTR_CT_INJECTED)) return true;
    // Already translated parent
    if (node.hasAttribute(CT.ATTR_TRANSLATED)) return true;
    return false;
  },

  /**
   * Check if an element is inside a navigation context.
   * Uses semantic HTML only: <nav> tag or role="navigation".
   */
  _isInNavContext(el) {
    let current = el;
    for (let i = 0; i < 6 && current; i++) {
      if (!current.tagName) break;
      if (current.tagName === 'NAV') return true;
      const role = current.getAttribute && current.getAttribute('role');
      if (role === 'navigation' || role === 'menubar') return true;
      current = current.parentElement;
    }
    return false;
  },

  /**
   * Post-filter: decide whether a text block should be translated.
   * Text-level filters only — no CSS class/ID heuristics (Strategy B).
   */
  _shouldTranslate(element, text) {
    if (!element) return false;

    // Rule 0: Skip visually hidden / off-screen elements
    try {
      const rect = element.getBoundingClientRect();
      if (rect.width < 1 && rect.height < 1) return false;
      if (rect.right < -500 || rect.left > window.innerWidth + 500) return false;
    } catch (e) { /* ignore */ }

    // Rule 1: Skip numbers-only text
    if (CT.NUMBERS_ONLY_PATTERN.test(text)) return false;

    // Rule 2: Skip standalone timestamp patterns
    if (CT.TIMESTAMP_PATTERN.test(text)) return false;

    // Rule 3: Skip short non-heading text
    const tag = element.tagName;
    const isHeading = tag === 'H1' || tag === 'H2' || tag === 'H3' ||
      tag === 'H4' || tag === 'H5' || tag === 'H6';
    if (!isHeading && text.length < CT.MIN_TRANSLATE_LENGTH) return false;

    // Rule 4: Skip text that is > 50% CJK characters
    const cjkMatches = text.match(CT.CJK_PATTERN);
    if (cjkMatches && cjkMatches.length / text.length > 0.5) return false;

    return true;
  },

  /**
   * Extract translatable text pieces using Text Node level traversal.
   * - Collects text nodes (nodeType===3) and groups them by block boundaries.
   * - Inline elements (a, span, strong, etc.) are traversed into without breaking pieces.
   * - Block elements (div, p, h1, etc.) break pieces at their boundaries.
   * - Returns pieces[]: { nodes: [textNode...], parentElement: Element }
   */
  extractPieces(root = document.body) {
    const pieces = [];
    let currentPiece = null;
    let currentCharCount = 0;

    function startNewPiece() {
      if (currentPiece && currentPiece.nodes.length > 0) {
        pieces.push(currentPiece);
      }
      currentPiece = { nodes: [], parentElement: null, isTranslated: false };
      currentCharCount = 0;
    }

    startNewPiece();

    function walk(node, blockAncestor) {
      // Text node — collect it
      if (node.nodeType === 3) {
        const text = node.textContent;
        if (text && text.trim().length > 0) {
          currentPiece.nodes.push(node);
          if (!currentPiece.parentElement) {
            currentPiece.parentElement = blockAncestor;
          }
          currentCharCount += text.length;
          if (currentCharCount >= CT.PIECE_MAX_CHARS) {
            startNewPiece();
          }
        }
        return;
      }

      // Only process element nodes
      if (node.nodeType !== 1) return;

      const tag = node.tagName;
      if (!tag) return;

      // Skip entirely: script, style, code, pre, etc.
      if (CT.SKIP_TAGS.has(tag)) return;

      // Skip notranslate / contentEditable / translate="no"
      if (CTDom._isNoTranslateNode(node)) return;

      // Skip our own injected elements (Strategy A: data attribute)
      if (node.hasAttribute && node.hasAttribute(CT.ATTR_CT_INJECTED)) return;

      const isInline = CT.INLINE_TAGS.has(tag);

      if (!isInline) {
        // Block element: break piece before entering, update ancestor
        startNewPiece();
        blockAncestor = node;
      }

      // Recurse into children
      for (const child of node.childNodes) {
        walk(child, blockAncestor);
      }

      if (!isInline) {
        // Block element: break piece after leaving
        startNewPiece();
      }
    }

    walk(root, root);
    startNewPiece(); // flush last piece

    // Filter: skip short, timestamp, CJK-majority, etc.
    const filtered = pieces.filter(piece => {
      const text = CTDom.getPieceText(piece).trim();
      if (text.length < CTDom.MIN_TEXT_LENGTH) return false;
      if (piece.parentElement && piece.parentElement.hasAttribute &&
        piece.parentElement.hasAttribute(CT.ATTR_TRANSLATED)) return false;
      return CTDom._shouldTranslate(piece.parentElement, text);
    });

    console.log('[Chrome Translate] Found', pieces.length, 'pieces,', filtered.length, 'after filtering');
    return filtered;
  },

  /**
   * Get concatenated text content from a piece's text nodes.
   */
  getPieceText(piece) {
    return piece.nodes.map(n => n.textContent).join('');
  },

  /**
   * Get individual text node contents as an array (for HTML-aware translation).
   */
  getPieceTextArray(piece) {
    return piece.nodes.map(n => n.textContent);
  },

  /**
   * Insert translated text for a piece.
   * Accepts either:
   *   - perNodeTranslations: string[] (one translation per text node, preserves structure)
   *   - translatedText: string       (concatenated fallback)
   */
  insertTranslation(piece, translatedTextOrArray, id) {
    const parent = piece.parentElement;
    if (!parent) return;

    // Remove existing translation for this parent if any
    const existingId = parent.getAttribute(CT.ATTR_TRANSLATED);
    if (existingId) {
      const sel = `.${CT.CLS_TRANSLATED}[${CT.ATTR_CT_ID}="${existingId}"], .${CT.CLS_TRANSLATED_INLINE}[${CT.ATTR_CT_ID}="${existingId}"]`;
      const existing = document.querySelector(sel);
      if (existing) existing.remove();
    }

    // Detect if inline display is needed (nav/flex/grid contexts)
    const isNav = CTDom._isInNavContext(parent);
    let parentDisplay = '';
    try { parentDisplay = window.getComputedStyle(parent.parentElement).display; } catch (e) { }
    const useInline = isNav || parentDisplay.includes('flex') || parentDisplay.includes('grid');

    const el = document.createElement('span');
    el.className = useInline ? CT.CLS_TRANSLATED_INLINE : CT.CLS_TRANSLATED;
    el.setAttribute(CT.ATTR_CT_ID, id);
    el.setAttribute(CT.ATTR_CT_INJECTED, 'true');

    // Per-node translation: clone parent structure and fill in text
    if (Array.isArray(translatedTextOrArray)) {
      try {
        el.innerHTML = CTDom._buildPerNodeHTML(parent, translatedTextOrArray);
      } catch (e) {
        el.textContent = translatedTextOrArray.join('');
      }
    } else {
      // Fallback: plain text
      try {
        el.innerHTML = CTDom._buildTranslatedHTML(parent, translatedTextOrArray);
      } catch (e) {
        el.textContent = translatedTextOrArray;
      }
    }

    parent.setAttribute(CT.ATTR_TRANSLATED, id);

    // Copy full computed styles from the original element
    try {
      const computed = window.getComputedStyle(parent);
      el.style.setProperty('color', computed.color, 'important');
      el.style.setProperty('font-size', computed.fontSize, 'important');
      el.style.setProperty('font-weight', computed.fontWeight, 'important');
      el.style.setProperty('font-family', computed.fontFamily, 'important');
      el.style.setProperty('line-height', computed.lineHeight, 'important');
      el.style.setProperty('letter-spacing', computed.letterSpacing, 'important');
      el.style.setProperty('text-align', computed.textAlign, 'important');
    } catch (e) { /* ignore */ }

    // Always append inside the parent element
    parent.appendChild(el);

    return el;
  },

  /**
   * Build translated HTML with per-text-node translations.
   * Clones the parent's structure, replaces each text node with its translation.
   * This precisely preserves <a>, <strong>, <em>, etc.
   */
  _buildPerNodeHTML(parent, perNodeTranslations) {
    const clone = parent.cloneNode(true);

    // Remove any ct-injected elements from the clone
    clone.querySelectorAll(`[${CT.ATTR_CT_INJECTED}]`).forEach(n => n.remove());

    // Collect meaningful text nodes in the clone (matching extractPieces order)
    const textNodes = [];
    const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT, null);
    while (walker.nextNode()) {
      if (walker.currentNode.textContent.trim().length > 0) {
        textNodes.push(walker.currentNode);
      }
    }

    // Replace each text node with its per-node translation
    const translations = perNodeTranslations;
    for (let i = 0; i < textNodes.length && i < translations.length; i++) {
      if (translations[i]) {
        textNodes[i].textContent = translations[i];
      }
    }

    // Handle case where translation has fewer/more nodes than original
    // Extra translations: append to last text node
    if (translations.length > textNodes.length && textNodes.length > 0) {
      const extra = translations.slice(textNodes.length).filter(Boolean).join(' ');
      if (extra) {
        textNodes[textNodes.length - 1].textContent += ' ' + extra;
      }
    }

    return clone.innerHTML;
  },

  /**
   * Fallback: build translated HTML from a single concatenated string.
   * Clones parent structure and replaces all text with the translated string.
   */
  _buildTranslatedHTML(parent, translatedText) {
    const clone = parent.cloneNode(true);
    clone.querySelectorAll(`[${CT.ATTR_CT_INJECTED}]`).forEach(n => n.remove());
    clone.textContent = translatedText;
    return clone.innerHTML;
  },

  /**
   * Remove translation for a single parent element.
   */
  removeTranslation(parentElement) {
    const id = parentElement.getAttribute(CT.ATTR_TRANSLATED);
    if (!id) return;
    const sel = `.${CT.CLS_TRANSLATED}[${CT.ATTR_CT_ID}="${id}"], .${CT.CLS_TRANSLATED_INLINE}[${CT.ATTR_CT_ID}="${id}"]`;
    const existing = document.querySelector(sel);
    if (existing) existing.remove();
    parentElement.removeAttribute(CT.ATTR_TRANSLATED);
  },

  /**
   * Remove all translations from the page.
   */
  removeAllTranslations() {
    document.querySelectorAll(`.${CT.CLS_TRANSLATED}, .${CT.CLS_TRANSLATED_INLINE}`).forEach(el => el.remove());
    document.querySelectorAll(`[${CT.ATTR_TRANSLATED}]`).forEach(el => {
      el.removeAttribute(CT.ATTR_TRANSLATED);
    });
  },

  /**
   * Batch texts into groups respecting max texts and max chars per request.
   */
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
