/* Chrome Translate — YouTube Player Button */
'use strict';

const CTYouTubeButton = {
  _button: null,
  _dropdown: null,
  _observer: null,
  _isDropdownOpen: false,
  _closeDropdownBound: null,

  /**
   * Initialize YouTube player button.
   */
  init() {
    this._startPlayerObserver();
  },

  /**
   * Clean up button and observers.
   */
  destroy() {
    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
    }
    if (this._button) {
      this._button.remove();
      this._button = null;
    }
    if (this._dropdown) {
      this._dropdown.remove();
      this._dropdown = null;
    }
    if (this._closeDropdownBound) {
      document.removeEventListener('click', this._closeDropdownBound, true);
      this._closeDropdownBound = null;
    }
  },

  /**
   * Update button state and tooltip.
   */
  setState(state, tooltip) {
    if (!this._button) return;
    this._button.className = 'ytp-button ct-yt-button ' + state;
    this._button.setAttribute('aria-label', tooltip || 'Chrome Translate');
  },

  /**
   * Start observing player for controls injection.
   */
  _startPlayerObserver() {
    const observeControls = () => {
      const controls = document.querySelector('.ytp-right-controls');
      if (!controls) {
        setTimeout(observeControls, 500);
        return;
      }

      // Initial injection
      if (!controls.querySelector('.ct-yt-button')) {
        this._injectButton();
      }

      // Watch for player recreation (SPA navigation, quality changes, etc.)
      this._observer = new MutationObserver(() => {
        const controls = document.querySelector('.ytp-right-controls');
        if (controls && !controls.querySelector('.ct-yt-button')) {
          this._injectButton();
        }
      });

      const player = document.querySelector('#movie_player');
      if (player) {
        this._observer.observe(player, { childList: true, subtree: true });
      }
    };

    observeControls();
  },

  /**
   * Inject button into YouTube player controls.
   */
  _injectButton() {
    const controls = document.querySelector('.ytp-right-controls');
    if (!controls) return;

    this._button = this._createButton();

    // Insert before fullscreen button (last control)
    const fullscreenBtn = controls.querySelector('.ytp-fullscreen-button');
    if (fullscreenBtn) {
      fullscreenBtn.parentNode.insertBefore(this._button, fullscreenBtn);
    } else {
      controls.appendChild(this._button);
    }
  },

  /**
   * Create button element.
   */
  _createButton() {
    const btn = document.createElement('button');
    btn.className = 'ytp-button ct-yt-button';
    btn.setAttribute('aria-label', 'Chrome Translate');
    btn.setAttribute('data-ct-injected', 'true');

    // Globe icon for translation
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" width="100%" height="100%">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
      </svg>
    `;

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._toggleDropdown();
    });

    return btn;
  },

  /**
   * Create dropdown menu.
   */
  _createDropdown() {
    const dropdown = document.createElement('div');
    dropdown.className = 'ct-yt-dropdown';
    dropdown.setAttribute('data-ct-injected', 'true');

    dropdown.innerHTML = `
      <div class="ct-yt-dropdown-header">Chrome Translate</div>

      <div class="ct-yt-dropdown-item active" data-action="toggle-translation">
        <span class="ct-yt-dropdown-icon">🌐</span>
        <span class="ct-yt-dropdown-label">啟用字幕翻譯</span>
        <span class="ct-yt-dropdown-toggle"></span>
      </div>

      <div class="ct-yt-dropdown-separator"></div>

      <div class="ct-yt-dropdown-item" data-action="show-bilingual">
        <span class="ct-yt-dropdown-icon">🔁</span>
        <span class="ct-yt-dropdown-label">雙語字幕</span>
      </div>

      <div class="ct-yt-dropdown-item" data-action="show-original">
        <span class="ct-yt-dropdown-icon">📝</span>
        <span class="ct-yt-dropdown-label">僅顯示原文</span>
      </div>

      <div class="ct-yt-dropdown-item" data-action="show-translation">
        <span class="ct-yt-dropdown-icon">🔤</span>
        <span class="ct-yt-dropdown-label">僅顯示譯文</span>
      </div>

      <div class="ct-yt-dropdown-separator"></div>

      <div class="ct-yt-dropdown-item" data-action="refresh">
        <span class="ct-yt-dropdown-icon">🔄</span>
        <span class="ct-yt-dropdown-label">重新翻譯</span>
      </div>

      <div class="ct-yt-dropdown-separator"></div>

      <div class="ct-yt-dropdown-item ct-yt-size-row">
        <span class="ct-yt-dropdown-icon">🔤</span>
        <span class="ct-yt-dropdown-label">譯文大小</span>
        <span class="ct-yt-size-controls">
          <button class="ct-yt-size-btn" data-action="size-down">A-</button>
          <span class="ct-yt-size-value">1.0x</span>
          <button class="ct-yt-size-btn" data-action="size-up">A+</button>
        </span>
      </div>

      <div class="ct-yt-dropdown-item ct-yt-color-row">
        <span class="ct-yt-dropdown-icon">🎨</span>
        <span class="ct-yt-dropdown-label">譯文顏色</span>
        <span class="ct-yt-color-controls">
          <button class="ct-yt-color-dot active" data-action="color" data-color="#ffffff" style="background:#ffffff" title="白色"></button>
          <button class="ct-yt-color-dot" data-action="color" data-color="#ffd700" style="background:#ffd700" title="金黃色"></button>
          <button class="ct-yt-color-dot" data-action="color" data-color="#7dd3fc" style="background:#7dd3fc" title="淺藍色"></button>
          <button class="ct-yt-color-dot" data-action="color" data-color="#86efac" style="background:#86efac" title="淺綠色"></button>
        </span>
      </div>
    `;

    // Add click handlers for menu items
    dropdown.querySelectorAll('[data-action]').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = item.dataset.action;
        const color = item.dataset.color;
        if (action === 'color' && color) {
          this._handleColorChange(color);
        } else {
          this._handleDropdownAction(action);
        }
      });
    });

    // Load current style settings into dropdown
    this._loadCurrentStyle(dropdown);

    return dropdown;
  },

  /**
   * Toggle dropdown open/close.
   */
  _toggleDropdown() {
    if (this._isDropdownOpen) {
      this._closeDropdown();
    } else {
      this._openDropdown();
    }
  },

  /**
   * Open dropdown menu.
   */
  _openDropdown() {
    if (!this._dropdown) {
      this._dropdown = this._createDropdown();
      document.body.appendChild(this._dropdown);
    }

    // Position dropdown above button
    const buttonRect = this._button.getBoundingClientRect();
    this._dropdown.style.right = `${window.innerWidth - buttonRect.right}px`;
    this._dropdown.style.bottom = `${window.innerHeight - buttonRect.top + 8}px`;

    this._dropdown.classList.add('ct-yt-dropdown-open');
    this._isDropdownOpen = true;

    // Close on outside click (after a small delay to avoid immediate closing)
    setTimeout(() => {
      this._closeDropdownBound = () => this._closeDropdown();
      document.addEventListener('click', this._closeDropdownBound, true);
    }, 0);
  },

  /**
   * Close dropdown menu.
   */
  _closeDropdown() {
    if (this._dropdown) {
      this._dropdown.classList.remove('ct-yt-dropdown-open');
      this._isDropdownOpen = false;
      if (this._closeDropdownBound) {
        document.removeEventListener('click', this._closeDropdownBound, true);
        this._closeDropdownBound = null;
      }
    }
  },

  /**
   * Handle dropdown menu item clicks.
   */
  _handleDropdownAction(action) {
    switch (action) {
      case 'toggle-translation':
        const enabled = CTYouTube.toggleEnabled();
        this._updateToggleState(enabled);
        break;

      case 'show-original':
        CTYouTube.setDisplayMode('original');
        this._updateModeIndicator('original');
        break;

      case 'show-translation':
        CTYouTube.setDisplayMode('translation');
        this._updateModeIndicator('translation');
        break;

      case 'show-bilingual':
        CTYouTube.setDisplayMode('bilingual');
        this._updateModeIndicator('bilingual');
        break;

      case 'refresh':
        this.setState('translating', '重新翻譯中...');
        CTYouTube.refreshTranslation();
        setTimeout(() => {
          this.setState('idle', 'Chrome Translate');
        }, 2000);
        break;

      case 'size-up':
        this._adjustSize(0.1);
        return;
      case 'size-down':
        this._adjustSize(-0.1);
        return;
    }

    this._closeDropdown();
  },

  /**
   * Update toggle switch state.
   */
  _updateToggleState(enabled) {
    if (!this._dropdown) return;
    const toggleItem = this._dropdown.querySelector('[data-action="toggle-translation"]');
    if (toggleItem) {
      if (enabled) {
        toggleItem.classList.add('active');
      } else {
        toggleItem.classList.remove('active');
      }
    }
  },

  /**
   * Update mode indicator (visual feedback for selected mode).
   */
  _updateModeIndicator(mode) {
    if (!this._dropdown) return;

    // Remove active class from all mode items
    const modeItems = this._dropdown.querySelectorAll('[data-action^="show-"]');
    modeItems.forEach(item => item.classList.remove('ct-yt-mode-active'));

    // Add active class to selected mode
    const selectedItem = this._dropdown.querySelector(`[data-action="show-${mode}"]`);
    if (selectedItem) {
      selectedItem.classList.add('ct-yt-mode-active');
    }
  },

  /**
   * Load current style settings into dropdown UI.
   */
  async _loadCurrentStyle(dropdown) {
    const result = await chrome.storage.local.get([CT.STORAGE_YT_SUB_SCALE, CT.STORAGE_YT_SUB_COLOR]);
    const scale = result[CT.STORAGE_YT_SUB_SCALE] || 1.0;
    const color = (result[CT.STORAGE_YT_SUB_COLOR] || '#ffffff').toLowerCase();

    const sizeValue = dropdown.querySelector('.ct-yt-size-value');
    if (sizeValue) sizeValue.textContent = scale.toFixed(1) + 'x';

    dropdown.querySelectorAll('.ct-yt-color-dot').forEach(dot => {
      dot.classList.toggle('active', dot.dataset.color.toLowerCase() === color);
    });
  },

  /**
   * Adjust subtitle font size up or down.
   */
  async _adjustSize(delta) {
    const result = await chrome.storage.local.get(CT.STORAGE_YT_SUB_SCALE);
    let scale = result[CT.STORAGE_YT_SUB_SCALE] || 1.0;
    scale = Math.round((scale + delta) * 10) / 10;
    scale = Math.max(0.5, Math.min(2.5, scale));

    await chrome.storage.local.set({ [CT.STORAGE_YT_SUB_SCALE]: scale });

    // Update dropdown display
    if (this._dropdown) {
      const sizeValue = this._dropdown.querySelector('.ct-yt-size-value');
      if (sizeValue) sizeValue.textContent = scale.toFixed(1) + 'x';
    }
  },

  /**
   * Handle color change from dropdown.
   */
  async _handleColorChange(color) {
    await chrome.storage.local.set({ [CT.STORAGE_YT_SUB_COLOR]: color });

    // Update active state in dropdown
    if (this._dropdown) {
      this._dropdown.querySelectorAll('.ct-yt-color-dot').forEach(dot => {
        dot.classList.toggle('active', dot.dataset.color === color);
      });
    }
  }
};
