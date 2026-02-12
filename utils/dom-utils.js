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
        piece.parentElement.hasAttribute(CT.ATTR_TRANSLATED)) {
        // Verify the translation span still exists in the DOM
        const tid = piece.parentElement.getAttribute(CT.ATTR_TRANSLATED);
        const spanExists = piece.parentElement.querySelector(`[${CT.ATTR_CT_ID}="${tid}"]`);
        if (spanExists) return false; // genuinely translated, skip
        // Span was removed by site re-render — clear stale marker, allow re-translation
        piece.parentElement.removeAttribute(CT.ATTR_TRANSLATED);
      }
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
   * Insert translated text using in-place replacement (Immersive Translate style).
   * Replaces original text nodes with <font> elements containing the translation.
   * This survives framework re-renders because it modifies existing nodes
   * rather than appending "foreign" elements that React/Vue might remove.
   */
  insertTranslation(piece, translatedTextOrArray, id) {
    // If we've already translated this piece via in-place replacement, skip
    // (Check if any node in the piece is no longer connected or has been replaced)
    if (piece.nodes.some(n => !n.isConnected)) return;

    // Use <font> tag like Immersive Translate (or specific style wrapper)
    // We'll use <font> as a container for the translated text to sit "in place" of the original text node.

    // 1. Prepare translations array
    let translations = [];
    if (Array.isArray(translatedTextOrArray)) {
      translations = translatedTextOrArray;
    } else {
      // Fallback: if string, try to distribute or just put on first node
      // But for robust implementation, we should have array.
      // If single string, we might just put it on the last node or first?
      // Simple strategy: assign to first node, clear others? No, that loses structure.
      // Better: if scalar, assign to last text node (often the main one)
      translations = new Array(piece.nodes.length).fill('');
      if (piece.nodes.length > 0) {
        translations[piece.nodes.length - 1] = translatedTextOrArray;
      }
    }

    // 2. Mark parent as translated
    if (piece.parentElement) {
      piece.parentElement.setAttribute(CT.ATTR_TRANSLATED, id);
    }

    // 3. Replace each text node
    piece.nodes.forEach((node, i) => {
      const translation = translations[i];
      if (!translation || !translation.trim()) return;

      // Create replacement font element
      const font = document.createElement('font');
      font.className = CT.CLS_TRANSLATED; // Reuse class for styling
      font.setAttribute(CT.ATTR_CT_ID, id);
      font.setAttribute(CT.ATTR_CT_INJECTED, 'true');

      // Styling: Immersive Translate uses specific styles.
      // We'll apply our visual style here.
      // Make it block-like if needed, or inline-block?
      // Actually, for in-place, usually we want to KEEP the original text node?
      // Wait, Immersive Translate REPLACES the node but keeps original text inside?
      // Let's look at Immersive's code again: 
      // fontNode.textContent = node.textContent (if keeping original)
      // But for translation display, we want to SHOW the translation.
      // Immersive Translate shows Dual Language. 
      // It wraps original in <font> AND adds translation?
      // Re-reading step 528: encapsulateTextNode puts original text in fontNode, replaces node.
      // THEN it updates fontNode.textContent = result (translated).
      // So it is REPLACING original text.

      // OUR GOAL: Dual Language (Bilingual).
      // We want to KEEP original text and ADD translation.
      // Immersive Translate does:
      // node.replaceWith(fontNode) -> fontNode contains ORIGINAL text.
      // Then it appends translation?
      // No, looking at Step 528: 
      // nodes[j].textContent = result;
      // It seems to overwrite?!

      // Ah, Immersive Translate has "isShowDualLanguage" config.
      // If true, `encapsulateTextNode` sets style (indent, underline etc).
      // It replaces `node` with `fontNode` (which has `textContent = node.textContent` initially).
      // THEN `translateResults` sets `nodes[j].textContent = result`.
      // This implies it OVERWRITES original text if `result` is just translation.
      // UNLESS `result` contains "Original + Translation".

      // Let's stick to OUR visual design: Original Text (untouched) + Translation (new line).
      // But we can't appendChild to parent (React kills it).
      // We must insert the translation relative to the text node.
      // `node.parentNode.insertBefore(translationNode, node.nextSibling)`?
      // React reconciliation MIGHT tolerate this if it's a text node sibling?
      // OR we replace `node` with `Fragment` or `<span>` containing `[Original, <br>, Translation]`.
      // Replacing the text node is the safest bet.

      const wrapper = document.createElement('span');
      // Style wrapper to be transparent/inline
      // wrapper.style.all = 'inherit'; // risky

      // 1. Original text
      const originalText = document.createTextNode(node.textContent);
      wrapper.appendChild(originalText);

      // 2. Spacer/Line break
      // wrapper.appendChild(document.createElement('br'));

      // 3. Translation
      const transNode = document.createElement('span');

      // smart class selection
      const isNav = CTDom._isInNavContext(piece.parentElement);
      let parentDisplay = '';
      try { parentDisplay = window.getComputedStyle(piece.parentElement).display; } catch (e) { }
      const useInline = isNav || parentDisplay.includes('flex') || parentDisplay.includes('grid');

      transNode.className = useInline ? CT.CLS_TRANSLATED_INLINE : CT.CLS_TRANSLATED;
      transNode.setAttribute(CT.ATTR_CT_ID, id);
      transNode.setAttribute(CT.ATTR_CT_INJECTED, 'true');
      transNode.textContent = ' ' + translation; // Add space separator

      // Apply styles to look native
      try {
        const computed = window.getComputedStyle(piece.parentElement);
        transNode.style.fontSize = computed.fontSize;
        transNode.style.fontWeight = computed.fontWeight;
        // transNode.style.color = computed.color; // Keep inherited or use CSS

        // Copy other relevant typographic styles
        transNode.style.lineHeight = computed.lineHeight;
        transNode.style.letterSpacing = computed.letterSpacing;
      } catch (e) { }

      wrapper.appendChild(transNode);

      // Replace original text node with our wrapper
      node.replaceWith(wrapper);

      // Store reference to restore later?
      // We can use the ID to find and restore.
    });
  },

  /**
   * Remove translation for a single parent element (In-Place Strategy).
   * Finds injected wrappers and restores original text nodes.
   */
  removeTranslation(parentElement) {
    const id = parentElement.getAttribute(CT.ATTR_TRANSLATED);
    if (!id) return;

    // Find all injected wrappers with this ID
    const injected = parentElement.querySelectorAll(`[${CT.ATTR_CT_ID}="${id}"]`);
    injected.forEach(el => {
      // Logic: el is the <span class="ct-translated"> translation node.
      // Its parent is the wrapper <span> we created.
      // The wrapper contains [OriginalTextNode, TranslationSpan].
      // We want to remove TranslationSpan.

      const wrapper = el.parentElement;
      if (wrapper && wrapper.childNodes.length >= 1) {
        // We want to unwrap: keep the original text node, remove wrapper.
        // The first child should be the original text node (cloned or same).
        const originalValues = [];
        wrapper.childNodes.forEach(c => {
          if (c !== el && !c.hasAttribute?.(CT.ATTR_CT_INJECTED)) {
            originalValues.push(c);
          }
        });

        // Restore original nodes into the main DOM
        originalValues.forEach(ov => {
          wrapper.parentNode.insertBefore(ov, wrapper);
        });

        // Remove the wrapper
        wrapper.remove();
      } else {
        // Fallback just remove translation element
        el.remove();
      }
    });

    parentElement.removeAttribute(CT.ATTR_TRANSLATED);
  },

  /**
   * Remove all translations from the page.
   */
  removeAllTranslations() {
    // Safer: iterate all marked parents
    document.querySelectorAll(`[${CT.ATTR_TRANSLATED}]`).forEach(el => {
      CTDom.removeTranslation(el);
    });
    // Fallback cleanup
    document.querySelectorAll(`.${CT.CLS_TRANSLATED}, .${CT.CLS_TRANSLATED_INLINE}`).forEach(el => el.remove());
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
