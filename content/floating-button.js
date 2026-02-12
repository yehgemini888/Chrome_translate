/* Chrome Translate — Floating Button Component */
'use strict';

const CTFloatingButton = {
  _btn: null,
  _state: 'idle', // idle | translating | done | error
  _onClick: null,

  // SVG icons for each state
  _icons: {
    idle: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
    translating: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>`,
    done: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    error: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`
  },

  /**
   * Create and inject the floating button into the page.
   * @param {Function} onClick - Callback when button is clicked.
   */
  create(onClick) {
    if (this._btn) return;

    this._onClick = onClick;
    this._btn = document.createElement('button');
    this._btn.className = CT.CLS_FLOAT_BTN;
    this._btn.setAttribute(CT.ATTR_CT_INJECTED, 'true');
    this._btn.title = 'Chrome Translate — 點擊翻譯';
    this._btn.innerHTML = this._icons.idle;
    // Stop propagation to prevent host page handlers from hitting our SVG elements
    this._btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._handleClick();
    });

    document.body.appendChild(this._btn);
  },

  /**
   * Remove the floating button from the page.
   */
  destroy() {
    if (this._btn) {
      this._btn.remove();
      this._btn = null;
      this._state = 'idle';
    }
  },

  /**
   * Set button state.
   * @param {'idle'|'translating'|'done'|'error'} state
   * @param {string} [tooltip] - Optional tooltip text
   */
  setState(state, tooltip) {
    if (!this._btn) return;

    // Remove all state classes
    this._btn.classList.remove('translating', 'done', 'error');

    this._state = state;
    this._btn.innerHTML = this._icons[state] || this._icons.idle;

    if (state !== 'idle') {
      this._btn.classList.add(state);
    }

    if (tooltip) {
      this._btn.title = tooltip;
    } else {
      const titles = {
        idle: 'Chrome Translate — 點擊翻譯',
        translating: '翻譯中...',
        done: '翻譯完成 — 點擊移除翻譯',
        error: '翻譯失敗 — 點擊查看'
      };
      this._btn.title = titles[state] || '';
    }
  },

  /**
   * Get current state.
   */
  getState() {
    return this._state;
  },

  /**
   * Show progress on the button (during translation).
   * @param {number} current
   * @param {number} total
   */
  setProgress(current, total) {
    if (!this._btn || this._state !== 'translating') return;
    this._btn.title = `翻譯中... (${current}/${total})`;
  },

  _handleClick() {
    if (this._onClick) {
      this._onClick(this._state);
    }
  },

  /**
   * Show a temporary error message near the button.
   * @param {string} message
   */
  showError(message) {
    this.setState('error', message);

    // Create a tooltip-like message
    const tip = document.createElement('div');
    tip.style.cssText = `
      position: fixed; right: 76px; bottom: 28px;
      background: #D0021B; color: #fff; padding: 8px 12px;
      border-radius: 6px; font-size: 13px; z-index: 2147483647;
      max-width: 260px; box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    `;
    tip.textContent = message;
    tip.setAttribute(CT.ATTR_CT_INJECTED, 'true');
    document.body.appendChild(tip);

    setTimeout(() => {
      tip.remove();
      if (this._state === 'error') this.setState('idle');
    }, 4000);
  }
};
