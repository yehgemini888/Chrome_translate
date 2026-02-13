# Chrome Translate — Technical Specification
> Version: 2.1 | Last Updated: 2026-02-12

## 1. Project Overview

**notranslate 標準支援：**

| Item | Detail |
|------|--------|
| **Name** | Chrome Translate (沉浸式翻譯替代方案) |
| **Goal** | 自製 Chrome 擴充功能，替代付費沉浸式翻譯訂閱 |
| **MVP Scope** | 網頁雙語翻譯 + YouTube 雙語字幕 |
| **Target User** | 開發者本人（輕量使用） |
| **Target Language** | 繁體中文 (`zh-TW`) |

## 2. Tech Stack

| Layer | Choice | Reason |
|-------|--------|--------|
| Platform | Chrome Extension Manifest V3 | V2 已棄用 |
| Language | JavaScript (ES6+) | 無需編譯，快速迭代 |
| Build | 無 (No Build Step) | MVP 最簡化，chrome://extensions 直接載入 |
| Translation API | **Google Translate (免費端點)** | 免費無限額度，無需 API Key |
| Storage | Chrome Storage API (session + local) | 設定 local 存；翻譯快取 session 存 |
| Icons | SVG/PNG 自製 | 簡約風格 |

## 3. Architecture

### 3.1 Directory Structure

```
chrome-translate/
├── manifest.json                    # MV3 擴充功能設定
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── background/
│   └── service-worker.js            # 背景服務：API 代理、訊息路由、翻譯快取
├── content/
│   ├── content.js                   # 內容腳本主入口（ISOLATED world）
│   ├── translator.js                # 網頁翻譯引擎（批次翻譯 + DOM 注入）
│   ├── youtube.js                   # YouTube 雙語字幕渲染 (V4 Hybrid)
│   ├── youtube-interceptor.js       # YouTube 字幕攔截（MAIN world）
│   ├── youtube-player-button.js     # YouTube 播放器控制按鈕
│   ├── floating-button.js           # 懸浮翻譯按鈕（網頁翻譯用）
│   └── content.css                  # 注入頁面樣式
├── popup/
│   ├── popup.html                   # 彈出視窗 HTML (含字幕樣式設定)
│   ├── popup.js                     # 彈出邏輯
│   └── popup.css                    # 彈出樣式
├── libs/
│   ├── google-translate-client.js   # Google Translate 免費 API 封裝
│   └── deepl-client.js              # DeepL API 封裝（保留備用）
├── utils/
│   ├── constants.js                 # 全域常數 (新增字幕樣式 Key)
│   ├── storage.js                   # Chrome Storage 封裝 (保留備用)
│   └── dom-utils.js                 # DOM 工具
├── spec.md                          # 本規格文件
└── active_plan.md                   # 任務進度追蹤
```

### 3.2 Manifest V3 Content Script 載入策略

```jsonc
// manifest.json content_scripts 設定
"content_scripts": [
  {
    "matches": ["<all_urls>"],
    "js": [
      "utils/constants.js",
      "utils/dom-utils.js",
      "content/floating-button.js",
      "content/translator.js",
      "content/youtube.js",
      "content/youtube-player-button.js",
      "content/content.js"
    ],
    "css": ["content/content.css"],
    "run_at": "document_idle"
  },
  {
    "matches": ["*://*.youtube.com/*"],
    "js": ["content/youtube-interceptor.js"],
    "world": "MAIN",
    "run_at": "document_start"
  }
]
```

### 3.3 模組通訊架構 (YouTube V4)

```
┌─────────────────────────────────────────────────────────┐
│                    YouTube (HOST)                       │
│                                                         │
│  ┌───────────────────┐    CustomEvent (ready)           │
│  │ youtube-           │ ──────────────────────┐         │
│  │ interceptor.js     │    (MAIN world)       │         │
│  │ (攔截 TimedText)   │                       ▼         │
│  └───────────────────┘              ┌─────────────────┐ │
│                                     │  youtube.js     │ │
│  ┌───────────────────┐              │  (ISOLATED)     │ │
│  │ youtube-player-   │◄────────────►│  - Overlay UI   │ │
│  │ button.js (Menu)  │   calls      │  - Sync Engine  │ │
│  └───────────────────┘              └────────┬────────┘ │
└──────────────────────────────────────────────┼──────────┘
```

## 4. Core Features Detail

### 4.1 網頁雙語翻譯
(詳見 V2 引擎說明，採用 Text Node 級別遍歷與 In-Place Replacement 策略)

### 4.2 YouTube 雙語字幕 (Architecture V4)

**設計哲學：混合式同步 (Hybrid Sync)**
- **原理**：保留 YouTube 原生字幕功能，但將其容器設為 `opacity: 0`。我們直接讀取 DOM 中的 `.ytp-caption-segment` 獲取當前畫面顯示的文字，並結合 `video.currentTime` 與攔截到的完整字幕資料進行精確對齊。
- **優點**：完美的時機同步（由 YouTube 決定何時換行），且不干擾 YouTube 原生佈局。

**核心組件：**
1. **Interceptor (MAIN world)**: 攔截 `/api/timedtext`，解析後透過 `CustomEvent` 傳給內容腳本。
2. **Sync Engine (youtube.js)**: 
   - 建立 `originalText -> translatedText` 對照表。
   - 使用 `MutationObserver` 監聽原生字幕 DOM 變化。
   - 使用 `timeupdate` 事件作為主動同步保險。
3. **Overlay Renderer**: 在播放器上方建立 `#ct-yt-overlay`，渲染雙語文字。
4. **Player UI (youtube-player-button.js)**: 在 YouTube 工具列插入按鈕，提供快速切換模式（雙語/原文/譯文）與開關。

**樣式自定義：**
- 支援譯文縮放比例 (0.8x - 2.0x)。
- 支援譯文顏色自訂（預設：白色、金黃、淺藍、淺綠）。

### 4.9 Translation Engine V2 — Text Node 級別遍歷
(詳見 V2 說明)

## 5. Key Interfaces

### 5.3 Chrome Storage Schema

```javascript
// chrome.storage.local
{
  'ct_target_lang': 'zh-TW',
  'ct_enabled': true,
  'ct_yt_sub_scale': 1.2,      // YouTube 字幕縮放
  'ct_yt_sub_color': '#ffd700'  // YouTube 字幕顏色
}
```

## 6. Key Decisions Log

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 13 | **YouTube V4** | **Hybrid Overlay** | 解決原生 DOM 被 YouTube 重繪導致翻譯消失的問題 |
| 14 | **UI 整合** | **Player Button** | 提供與 YouTube 原生體驗一致的控制方式 |
| 15 | **通訊方式** | **CustomEvent** | 替代 postMessage，更穩定且避免與網頁既有訊息混淆 |
