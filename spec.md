# Chrome Translate — Technical Specification
> Version: 1.0 MVP | Last Updated: 2026-02-11

## 1. Project Overview

| Item | Detail |
|------|--------|
| **Name** | Chrome Translate (沉浸式翻譯替代方案) |
| **Goal** | 自製 Chrome 擴充功能，替代付費沉浸式翻譯訂閱 |
| **MVP Scope** | 網頁雙語翻譯 + YouTube 雙語字幕 + DeepL API |
| **Target User** | 開發者本人（輕量使用） |
| **Target Language** | 繁體中文 (ZH-HANT) |

## 2. Tech Stack

| Layer | Choice | Reason |
|-------|--------|--------|
| Platform | Chrome Extension Manifest V3 | V2 已棄用 |
| Language | JavaScript (ES6+) | 無需編譯，快速迭代 |
| Build | 無 (No Build Step) | MVP 最簡化，chrome://extensions 直接載入 |
| Translation API | DeepL Free API | 免費 50 萬字元/月 |
| Storage | Chrome Storage API (session + local) | API Key 持久存；翻譯快取 session 存 |
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
│   └── service-worker.js            # 背景服務：API 代理、訊息路由
├── content/
│   ├── content.js                   # 內容腳本主入口（ISOLATED world）
│   ├── translator.js                # 網頁翻譯引擎
│   ├── youtube.js                   # YouTube 雙語字幕渲染
│   ├── youtube-interceptor.js       # YouTube 字幕攔截（MAIN world）
│   ├── floating-button.js           # 懸浮翻譯按鈕
│   └── content.css                  # 注入頁面樣式
├── popup/
│   ├── popup.html                   # 彈出視窗 HTML
│   ├── popup.js                     # 彈出邏輯
│   └── popup.css                    # 彈出樣式
├── libs/
│   └── deepl-client.js              # DeepL API 封裝
└── utils/
    ├── constants.js                 # 全域常數
    ├── storage.js                   # Chrome Storage 封裝
    └── dom-utils.js                 # DOM 遍歷工具
```

### 3.2 Manifest V3 Content Script 載入策略

無 Build Step 下，利用 MV3 content_scripts 的多檔案注入特性：同一組 js 陣列中的檔案共享 ISOLATED world 執行環境，前面載入的檔案其全域變數可被後面的檔案存取。

```jsonc
// manifest.json content_scripts 設定
"content_scripts": [
  {
    "matches": ["<all_urls>"],
    "js": [
      "utils/constants.js",      // 1) 常數定義
      "utils/storage.js",        // 2) Storage 封裝
      "utils/dom-utils.js",      // 3) DOM 工具
      "content/floating-button.js", // 4) 懸浮按鈕
      "content/translator.js",   // 5) 翻譯引擎
      "content/youtube.js",      // 6) YouTube 字幕渲染
      "content/content.js"       // 7) 主入口（最後載入）
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

### 3.3 模組通訊架構

```
┌─────────────────────────────────────────────────────────┐
│                    Web Page (HOST)                       │
│                                                         │
│  ┌───────────────────┐    window.postMessage            │
│  │ youtube-           │ ──────────────────────┐         │
│  │ interceptor.js     │    (MAIN world)       │         │
│  │ (攔截 TimedText)   │                       ▼         │
│  └───────────────────┘              ┌─────────────────┐ │
│                                     │  content.js     │ │
│  ┌───────────────────┐              │  (ISOLATED)     │ │
│  │ floating-button.js│◄────────────►│  - translator   │ │
│  │ (UI 懸浮按鈕)     │   calls      │  - youtube      │ │
│  └───────────────────┘              │  - dom-utils    │ │
│                                     └────────┬────────┘ │
└──────────────────────────────────────────────┼──────────┘
                                               │
                          chrome.runtime.sendMessage
                                               │
                                               ▼
                                    ┌─────────────────┐
                                    │ service-worker   │
                                    │ (Background)     │
                                    │ - deepl-client   │
                                    │ - message router │
                                    └─────────────────┘
                                               │
                                          HTTPS API
                                               │
                                               ▼
                                    ┌─────────────────┐
                                    │ DeepL Free API   │
                                    │ api-free.deepl   │
                                    └─────────────────┘
```

### 3.4 資料流

#### 網頁翻譯流程

```
User clicks 懸浮按鈕
  → content.js 觸發翻譯
  → translator.js 遍歷 DOM，萃取文字區塊
  → 分批打包文字（每批 ≤ 50 段, ≤ 5000 字元）
  → chrome.runtime.sendMessage({ type: 'TRANSLATE', texts: [...] })
  → service-worker.js 接收，呼叫 DeepL API
  → 回傳翻譯結果
  → translator.js 在每個原文區塊下方插入譯文元素
  → 套用 content.css 雙語樣式
```

#### YouTube 字幕翻譯流程

```
YouTube 頁面載入
  → youtube-interceptor.js (MAIN world) 在 document_start 攔截 fetch
  → 偵測到 /api/timedtext 回應 → 擷取 JSON3 字幕資料
  → window.postMessage({ type: 'CT_SUBTITLES_RAW', payload: subtitleData })
  → youtube.js (ISOLATED world) 接收字幕資料
  → 萃取所有字幕文字，批次送 background 翻譯
  → 建立翻譯對照表 { timestamp → translatedText }
  → MutationObserver 監聽 .ytp-caption-segment 變化
  → 字幕顯示時，查對照表插入翻譯行
```

## 4. Core Features Detail

### 4.1 網頁雙語翻譯

**觸發方式：** 點擊右下角懸浮按鈕

**DOM 遍歷策略：**
- 使用 TreeWalker API 遍歷 `document.body`
- 篩選 `SHOW_TEXT` 節點
- 向上找到最近的區塊級父元素（p, h1-h6, li, td, th, blockquote, div 含直接文字）
- 去重：同一個區塊級父元素只翻譯一次
- 跳過：script, style, noscript, code, pre, textarea, input, [contenteditable]
- 跳過：已翻譯的元素（檢查 `data-ct-translated` 屬性）

**雙語顯示：**
- 在原文區塊元素後方插入 `<div class="ct-translated" data-ct-id="xxx">`
- 譯文樣式：較淺灰色、略小字體、左側藍色邊線標記
- 支援切換顯示/隱藏譯文

**批次翻譯：**
- 每批最多 50 個文字段落
- 每批文字總長度不超過 5,000 字元（DeepL 單次限制）
- 並行發送多批請求（最多 3 個並行）
- 顯示翻譯進度（懸浮按鈕上的進度指示）

### 4.2 YouTube 雙語字幕

**字幕攔截 (youtube-interceptor.js, MAIN world)：**
- 在 `document_start` 階段 monkey-patch `window.fetch`
- 偵測 URL 包含 `/api/timedtext` 的回應
- clone() response → 讀取 JSON → 透過 window.postMessage 傳遞
- 原始 response 不受影響（不破壞 YouTube 正常功能）

**YouTube JSON3 字幕格式：**
```json
{
  "events": [
    {
      "tStartMs": 1000,
      "dDurationMs": 2500,
      "segs": [{ "utf8": "Hello world" }]
    }
  ]
}
```

**雙語字幕渲染 (youtube.js, ISOLATED world)：**
- 監聽 `window.message` 事件接收字幕資料
- 批次翻譯所有字幕文字
- 建立 Map: `tStartMs → translatedText`
- 使用 MutationObserver 監聽 `.ytp-caption-window-container`
- 字幕出現時，在下方新增翻譯行 `<span class="ct-yt-translated">`
- YouTube SPA 導航（換影片）時重新攔截

**SPA 導航處理：**
- 監聽 `yt-navigate-finish` 事件
- 清除舊的翻譯對照表
- 等待新影片的字幕載入

### 4.3 DeepL API Client

**端點：** `POST https://api-free.deepl.com/v2/translate`

**認證：** `Authorization: DeepL-Auth-Key {USER_API_KEY}`

**請求格式：**
```json
{
  "text": ["Hello", "World"],
  "target_lang": "ZH-HANT",
  "source_lang": null
}
```
- `source_lang` 設為 null，讓 DeepL 自動偵測來源語言
- `text` 陣列支援批次翻譯（每次最多 50 條）

**回應格式：**
```json
{
  "translations": [
    { "detected_source_language": "EN", "text": "你好" },
    { "detected_source_language": "EN", "text": "世界" }
  ]
}
```

**錯誤處理：**
| HTTP Status | 意義 | 處理方式 |
|-------------|------|----------|
| 403 | API Key 無效 | 提示用戶檢查 Key |
| 429 | 請求過於頻繁 | 指數退避重試（max 3 次） |
| 456 | 額度用盡 | 提示用戶額度已滿 |
| 5xx | 伺服器錯誤 | 重試 1 次後報錯 |

### 4.4 懸浮按鈕

**外觀：**
- 固定在頁面右下角 (position: fixed)
- 圓形 48x48px，藍色背景 (#4A90D9)
- 顯示翻譯圖示（地球/語言圖示）
- z-index: 2147483647（最高層級）

**狀態：**
| 狀態 | 外觀 | 行為 |
|------|------|------|
| idle | 藍色圓形 | 點擊 → 開始翻譯 |
| translating | 旋轉動畫 | 顯示進度，點擊 → 取消 |
| done | 綠色打勾 | 點擊 → 移除翻譯（恢復原文） |
| error | 紅色驚嘆號 | 點擊 → 顯示錯誤訊息 |

**YouTube 頁面：**
- 懸浮按鈕在 YouTube 上功能改為「翻譯字幕」
- 若字幕已自動攔截翻譯，按鈕顯示 done 狀態
- 額外支援手動觸發：若自動攔截失敗，可手動觸發字幕翻譯

### 4.5 Popup 設定

**介面內容：**
- DeepL API Key 輸入欄位（密碼遮蔽，可切換顯示）
- API Key 驗證按鈕（呼叫 DeepL /v2/usage 端點檢查）
- 翻譯開關（全域啟用/停用）
- 目標語言選擇（預設 繁體中文 ZH-HANT）
- 當前頁面翻譯狀態顯示
- 本月 API 用量顯示（字元數 / 500,000）

### 4.6 翻譯快取 (Session Cache)

**策略：** `chrome.storage.session`
- Key 格式：`cache:{md5_hash_of_source_text}`
- Value：翻譯結果字串
- 生命週期：瀏覽器 session（關閉清除）
- 翻譯前先查快取，命中則跳過 API 呼叫
- 簡化實作：使用簡單 hash 函式（非密碼學用途，djb2 即可）

## 5. Key Interfaces

### 5.1 Message Protocol (Content ↔ Background)

```javascript
// Content → Background: 翻譯請求
{
  type: 'TRANSLATE',
  payload: {
    texts: ['Hello', 'World'],     // 待翻譯文字陣列
    targetLang: 'ZH-HANT'          // 目標語言
  }
}

// Background → Content: 翻譯結果
{
  type: 'TRANSLATE_RESULT',
  payload: {
    translations: ['你好', '世界'],
    sourceLang: 'EN'
  }
}

// Content → Background: 驗證 API Key
{
  type: 'VALIDATE_API_KEY',
  payload: { apiKey: '...' }
}

// Background → Content: 驗證結果
{
  type: 'VALIDATE_API_KEY_RESULT',
  payload: {
    valid: true,
    usage: { character_count: 12345, character_limit: 500000 }
  }
}

// Content → Background: 查詢用量
{
  type: 'GET_USAGE',
  payload: {}
}
```

### 5.2 YouTube Interceptor ↔ Content Script

```javascript
// youtube-interceptor.js (MAIN) → youtube.js (ISOLATED)
window.postMessage({
  type: 'CT_SUBTITLES_RAW',
  payload: {
    events: [
      { tStartMs: 1000, dDurationMs: 2500, segs: [{ utf8: 'Hello' }] }
    ],
    language: 'en'    // 原始字幕語言
  }
}, '*');
```

### 5.3 Chrome Storage Schema

```javascript
// chrome.storage.local（持久存儲）
{
  'ct_api_key': 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
  'ct_target_lang': 'ZH-HANT',
  'ct_enabled': true
}

// chrome.storage.session（翻譯快取，session 生命週期）
{
  'cache:a1b2c3d4': '你好世界',
  'cache:e5f6g7h8': '這是翻譯結果'
}
```

## 6. Key Decisions Log

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | YouTube 字幕策略 | 攔截 TimedText API | 批次翻譯節省 API 額度，品質更好 |
| 2 | 雙語顯示方式 | 原文下方 | 最自然的閱讀體驗，與沉浸式翻譯一致 |
| 3 | 翻譯快取 | Session 快取 | 平衡額度節省與儲存空間 |
| 4 | Build 工具 | 無 | MVP 簡化，直接載入開發 |
| 5 | 語言 | JavaScript ES6+ | 無需編譯步驟 |
| 6 | MV3 Content Script | 多檔案共享 ISOLATED world | 無 build step 下的模組化方案 |

## 7. Future Expansion (Post-MVP)

- [ ] 其他影片平台支援（Vimeo、B站）
- [ ] 其他翻譯引擎（ChatGPT、Gemini、Google Translate）
- [ ] PDF / ePub 文件翻譯
- [ ] 劃詞翻譯 / 懸停翻譯
- [ ] 圖片 OCR 翻譯
- [ ] Options 頁面（進階設定）
- [ ] 白名單/黑名單網站管理
- [ ] 快捷鍵支援
