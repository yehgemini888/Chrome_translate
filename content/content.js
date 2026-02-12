/* Chrome Translate — Content Script Entry Point */
'use strict';

(async function CTMain() {
  // Check if extension context is valid
  try {
    const _ = chrome.runtime.id;
    if (!_) throw new Error('No runtime ID');
  } catch (e) {
    console.warn('[Chrome Translate] Extension context invalidated. Please refresh the page.');
    return;
  }

  // Check if extension is enabled
  const settings = await chrome.storage.local.get([CT.STORAGE_ENABLED, CT.STORAGE_TARGET_LANG]);
  if (settings[CT.STORAGE_ENABLED] === false) return;

  // Migrate old DeepL language codes to Google Translate format
  const savedLang = settings[CT.STORAGE_TARGET_LANG];
  if (savedLang && (savedLang === 'ZH-HANT' || savedLang === 'ZH-HANS' || savedLang === 'ZH')) {
    const langMap = { 'ZH-HANT': 'zh-TW', 'ZH-HANS': 'zh-CN', 'ZH': 'zh-CN' };
    await chrome.storage.local.set({ [CT.STORAGE_TARGET_LANG]: langMap[savedLang] || 'zh-TW' });
    console.log('[Chrome Translate] Migrated language code:', savedLang, '→', langMap[savedLang] || 'zh-TW');
  }

  const isYouTube = window.location.hostname.includes('youtube.com');

  // Button click handler (extracted so we can reuse on SPA re-create)
  function onButtonClick(state) {
    switch (state) {
      case 'idle':
        if (isYouTube) {
          triggerYouTubeTranslation();
        } else {
          CTTranslator.translatePage();
        }
        break;

      case 'translating':
        CTTranslator.cancel();
        break;

      case 'done':
        if (!isYouTube) {
          CTTranslator.removeTranslations();
        }
        break;

      case 'error':
        CTFloatingButton.setState('idle');
        break;
    }
  }

  // Initialize floating button
  CTFloatingButton.create(onButtonClick);

  // Initialize YouTube subtitle handler if on YouTube
  if (isYouTube) {
    CTYouTube.init();
  }

  // --- SPA Navigation Detection ---
  // Sites like Yahoo Finance use pushState routing; detect page changes
  // and reset state / re-create button if the framework removed it.
  if (!isYouTube) {
    let lastUrl = location.href;

    function onSPANavigate() {
      if (location.href === lastUrl) return;
      lastUrl = location.href;

      // Reset translation state
      CTTranslator._translated = false;
      CTTranslator._isTranslating = false;

      // Wait for the new page content to render, then ensure button exists
      setTimeout(() => {
        if (!document.body.contains(CTFloatingButton._btn)) {
          CTFloatingButton._btn = null;
          CTFloatingButton._state = 'idle';
          CTFloatingButton.create(onButtonClick);
        } else {
          CTFloatingButton.setState('idle');
        }
      }, 600);
    }

    // Intercept history.pushState / replaceState
    const origPushState = history.pushState;
    history.pushState = function() {
      origPushState.apply(this, arguments);
      onSPANavigate();
    };
    const origReplaceState = history.replaceState;
    history.replaceState = function() {
      origReplaceState.apply(this, arguments);
      onSPANavigate();
    };
    window.addEventListener('popstate', onSPANavigate);
  }

  // Listen for settings changes (e.g., enabled toggle from popup)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;

    if (changes[CT.STORAGE_ENABLED]) {
      if (changes[CT.STORAGE_ENABLED].newValue === false) {
        // Disable: remove translations and button
        CTTranslator.removeTranslations();
        CTFloatingButton.destroy();
        if (isYouTube) CTYouTube.destroy();
      } else {
        // Re-enable: recreate button
        CTFloatingButton.create();
        if (isYouTube) CTYouTube.init();
      }
    }
  });

  /**
   * Manually trigger YouTube subtitle translation.
   * Used when auto-interception didn't fire (e.g., subtitles loaded before script).
   */
  async function triggerYouTubeTranslation() {
    CTFloatingButton.setState('translating', 'YouTube 字幕翻譯中...');

    try {
      // Try to get subtitles from the video element's text tracks
      const video = document.querySelector('video');
      if (!video) {
        CTFloatingButton.showError('找不到影片元素');
        return;
      }

      // Check if there are caption tracks
      const tracks = video.textTracks;
      if (tracks && tracks.length > 0) {
        for (const track of tracks) {
          if (track.kind === 'subtitles' || track.kind === 'captions') {
            // Force load the track
            track.mode = 'showing';

            // Wait for cues to load
            await new Promise(resolve => {
              if (track.cues && track.cues.length > 0) {
                resolve();
              } else {
                track.addEventListener('cuechange', resolve, { once: true });
                setTimeout(resolve, 3000); // timeout fallback
              }
            });

            if (track.cues && track.cues.length > 0) {
              const subtitles = Array.from(track.cues).map(cue => ({
                startMs: Math.round(cue.startTime * 1000),
                durationMs: Math.round((cue.endTime - cue.startTime) * 1000),
                text: cue.text || ''
              })).filter(s => s.text.trim());

              if (subtitles.length > 0) {
                CTYouTube._onSubtitlesReceived({
                  subtitles,
                  videoId: new URL(window.location.href).searchParams.get('v') || '',
                  language: track.language || 'unknown'
                });
                return;
              }
            }
          }
        }
      }

      CTFloatingButton.showError('找不到字幕，請確認影片已開啟字幕');
    } catch (e) {
      CTFloatingButton.showError('字幕擷取失敗: ' + e.message);
    }
  }

  console.log('[Chrome Translate] Content script initialized.', isYouTube ? '(YouTube mode)' : '(Web mode)');
})();
