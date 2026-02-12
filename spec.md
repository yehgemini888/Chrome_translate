# Chrome Translate — Technical Specification
> Version: 1.1 | Last Updated: 2026-02-11

## 1. Project Overview

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

> **API 變更紀錄：** 原計劃使用 DeepL Free API，但因 DeepL 帳號註冊問題，改用 Google Translate 免費端點（`translate.googleapis.com`）。DeepL client 保留於 `libs/deepl-client.js` 供未來切換。

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
│   ├── youtube.js                   # YouTube 雙語字幕渲染
│   ├── youtube-interceptor.js       # YouTube 字幕攔截（MAIN world）
│   ├── floating-button.js           # 懸浮翻譯按鈕（4 狀態 SVG 圖示）
│   └── content.css                  # 注入頁面樣式（雙語顯示 + 按鈕）
├── popup/
│   ├── popup.html                   # 彈出視窗 HTML
│   ├── popup.js                     # 彈出邏輯（啟用/停用、語言選擇）
│   └── popup.css                    # 彈出樣式
├── libs/
│   ├── google-translate-client.js   # Google Translate 免費 API 封裝（主要使用）
│   └── deepl-client.js              # DeepL API 封裝（保留備用）
├── utils/
│   ├── constants.js                 # 全域常數
│   ├── storage.js                   # Chrome Storage 封裝（未使用，保留備用）
│   └── dom-utils.js                 # DOM 遍歷工具（遞迴下降演算法）
├── spec.md                          # 本規格文件
└── active_plan.md                   # 任務進度追蹤
```

### 3.2 Manifest V3 Content Script 載入策略

無 Build Step 下，利用 MV3 content_scripts 的多檔案注入特性：同一組 js 陣列中的檔案共享 ISOLATED world 執行環境，前面載入的檔案其全域變數可被後面的檔案存取。

```jsonc
// manifest.json content_scripts 設定
"content_scripts": [
  {
    "matches": ["<all_urls>"],
    "js": [
      "utils/constants.js",         // 1) 常數定義（CT 物件）
      "utils/dom-utils.js",         // 2) DOM 遍歷工具（CTDom 物件）
      "content/floating-button.js", // 3) 懸浮按鈕（CTFloatingButton 物件）
      "content/translator.js",      // 4) 翻譯引擎（CTTranslator 物件）
      "content/youtube.js",         // 5) YouTube 字幕渲染（CTYouTube 物件）
      "content/content.js"          // 6) 主入口（最後載入，整合所有模組）
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

> **注意：** `utils/storage.js` 已從 manifest 移除（dead code），目前設定直接使用 `chrome.storage` API。

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
                                    ┌─────────────────────┐
                                    │ service-worker.js    │
                                    │ (Background)         │
                                    │ - google-translate   │
                                    │ - session cache      │
                                    │ - message router     │
                                    └──────────┬──────────┘
                                               │
                                          fetch (HTTPS)
                                               │
                                               ▼
                                    ┌─────────────────────┐
                                    │ Google Translate     │
                                    │ (Free gtx endpoint)  │
                                    │ translate.googleapis │
                                    └─────────────────────┘
```

### 3.4 資料流

#### 網頁翻譯流程

```
User clicks 懸浮按鈕
  → content.js 觸發 CTTranslator.translatePage()
  → dom-utils.js 遞迴下降遍歷 DOM，萃取「葉節點文字區塊」
  → 分批打包文字（每批 ≤ 20 段, ≤ 4000 字元）
  → chrome.runtime.sendMessage({ type: 'TRANSLATE', texts: [...] })
  → service-worker.js 接收
    → 查 session cache（djb2 hash key），命中直接回傳
    → 未命中 → GoogleTranslateClient.translate() 逐條翻譯（5 併發）
    → 結果存入 session cache
  → 回傳翻譯結果給 content script
  → translator.js 在每個原文區塊下方插入 <span class="ct-translated">
  → 套用 content.css 雙語樣式
```

#### YouTube 字幕翻譯流程

```
YouTube 頁面載入
  → youtube-interceptor.js (MAIN world) 在 document_start 攔截 fetch + XHR
  → 偵測到 /api/timedtext 回應 → 解析 JSON3 / XML 字幕格式
  → window.postMessage({ type: 'CT_SUBTITLES_RAW', payload: subtitleData })
  → youtube.js (ISOLATED world) 接收字幕資料
  → 萃取所有字幕文字，批次送 background 翻譯
  → 建立翻譯對照表 Map(originalText → translatedText)
  → MutationObserver 監聽 .ytp-caption-window-container
  → 字幕顯示時，查對照表插入翻譯行 <span class="ct-yt-translated">
```

## 4. Core Features Detail

### 4.1 網頁雙語翻譯

**觸發方式：** 點擊右下角懸浮按鈕

**DOM 遍歷策略 — 遞迴下降演算法：**

核心函式：`CTDom.extractTextBlocks(root)`

```
walk(element):
  1. 跳過 SKIP_TAGS (script, style, svg, iframe, etc.)
  2. 跳過 className 含 'ct-' 的自身元素
  3. 呼叫 _hasBlockDescendant(element):
     - 遍歷所有子元素
     - 若子元素為 BLOCK_ELEMENT_TAGS 且含文字 → return true
     - 若子元素為 inline (a, span, em...) 但含子元素 → 遞迴檢查
     - 這解決了 <a><h3>...</h3><p>...</p></a> 等現代 HTML 模式
  4. 若有 block 後代 → CONTAINER → 遞迴 walk 所有子元素
  5. 若無 block 後代 → LEAF → 擷取 innerText，加入翻譯佇列
```

**關鍵設計：穿透 inline 包裝元素**
現代網頁常用 `<a>` 包裹整個卡片（含 `<h3>` + `<p>`），舊版只檢查直接子元素是否為 block，會將整個卡片視為一個文字區塊。新版 `_hasBlockDescendant()` 遞迴穿透 inline 包裝元素，正確拆分成個別段落。

**雙語顯示：**
- 在原文區塊後方插入 `<span class="ct-translated" data-ct-id="xxx">`
- 使用 `<span>` 而非 `<div>`，減少對頁面佈局的影響
- 特殊處理：`<td>`, `<th>`, `<li>` 等元素使用 `appendChild` 而非 `insertAdjacentElement`，避免破壞表格/列表結構
- 譯文樣式：淺灰色 (#999)、繼承字體大小、`display: block`
- 深色模式支援：`prefers-color-scheme: dark` 時調整為 #888

**批次翻譯：**
- 每批最多 20 個文字段落
- 每批文字總長度不超過 4,000 字元
- 內容腳本端 2 個併發批次
- Service Worker 端每批內 5 個併發 Google Translate 請求
- 顯示翻譯進度（懸浮按鈕 tooltip）

### 4.2 YouTube 雙語字幕

**字幕攔截 (youtube-interceptor.js, MAIN world)：**
- 在 `document_start` 階段 monkey-patch `window.fetch` 和 `XMLHttpRequest`
- 偵測 URL 包含 `/api/timedtext` 的回應
- 支援 JSON3 和 XML 兩種字幕格式解析
- clone() response → 解析字幕 → 透過 window.postMessage 傳遞
- 原始 response 不受影響（不破壞 YouTube 正常功能）

**雙語字幕渲染 (youtube.js, ISOLATED world)：**
- 監聽 `window.message` 事件接收字幕資料
- 批次翻譯所有字幕文字
- 建立 Map: `originalText → translatedText`
- 使用 MutationObserver 監聽 `.ytp-caption-window-container`
- 字幕出現時，在下方新增翻譯行 `<span class="ct-yt-translated">`
- YouTube SPA 導航（`yt-navigate-finish` 事件）時清除舊資料、等待新字幕

### 4.3 Google Translate Client

**端點：** `GET https://translate.googleapis.com/translate_a/single`

**參數：**
```
?client=gtx       # 免費端點識別
&sl=auto           # 來源語言（自動偵測）
&tl=zh-TW          # 目標語言
&dt=t              # 翻譯資料類型
&q={text}          # 待翻譯文字（URL encoded）
```

**翻譯策略：逐條翻譯 + 併發控制**

> **變更紀錄：** 原版使用分隔符號 (`\n▁\n`) 合併多段文字為一個請求再拆分。實測發現 Google Translate 會改變或移除分隔符號，導致拆分失敗、翻譯結果全部為空。改為逐條獨立請求 + 5 併發控制，可靠性大幅提升。

**回應格式：**
```javascript
// data[0] = [[translatedSegment, originalSegment, ...], ...]
// data[2] = detected source language
const fullTranslation = data[0]
  .filter(seg => seg && seg[0])
  .map(seg => seg[0])
  .join('');
```

**錯誤處理：**
| HTTP Status | 意義 | 處理方式 |
|-------------|------|----------|
| 429 | 請求過於頻繁 | 等待 1 秒後自動重試 1 次 |
| 其他非 200 | 伺服器錯誤 | 該條翻譯標記失敗，不影響其他 |

### 4.4 懸浮按鈕

**外觀：**
- 固定在頁面右下角 (position: fixed, right: 20px, bottom: 20px)
- 圓形 48x48px，藍色背景 (#4A90D9)
- SVG 圖示（每個狀態不同圖示）
- z-index: 2147483647（最高層級）
- `event.stopPropagation()` 防止宿主頁面的事件處理器操作 SVG 元素

**狀態：**
| 狀態 | 顏色 | 圖示 | 行為 |
|------|------|------|------|
| idle | 藍色 #4A90D9 | 地球 | 點擊 → 開始翻譯 |
| translating | 橙色 #F5A623 | 旋轉載入 | 顯示進度 (x/y)，點擊 → 取消 |
| done | 綠色 #7ED321 | 打勾 | 點擊 → 移除翻譯（恢復原文） |
| error | 紅色 #D0021B | 驚嘆號 | 顯示錯誤訊息 tooltip，4 秒後自動消失 |

### 4.5 Popup 設定

**介面內容（Google Translate 版本）：**
- 翻譯開關（全域啟用/停用）
- 目標語言選擇（預設 繁體中文 `zh-TW`）
- 使用說明提示

> **變更紀錄：** 從 DeepL 切換到 Google Translate 後，移除了 API Key 輸入、驗證、用量顯示等功能，大幅簡化 Popup。

### 4.6 翻譯快取 (Session Cache)

**策略：** `chrome.storage.session`
- Key 格式：`cache:{djb2_hash}` (djb2 hash 轉 base36)
- Value：翻譯結果字串
- 生命週期：瀏覽器 session（關閉清除）
- 翻譯前先查快取，命中則跳過 API 呼叫
- 僅快取非空翻譯結果

### 4.7 Extension Context Invalidated 防護

Content script 啟動時檢查 `chrome.runtime.id` 是否有效。翻譯過程中若偵測到 "Extension context invalidated" 錯誤，立即停止所有批次處理，顯示中文提示：「擴充功能已更新，請重新整理頁面 (Ctrl+R)」。

### 4.8 語言代碼自動遷移

Content script 啟動時檢查 `chrome.storage.local` 中的目標語言設定。若偵測到舊版 DeepL 格式的語言代碼（`ZH-HANT`, `ZH-HANS`, `ZH`），自動遷移為 Google Translate 格式（`zh-TW`, `zh-CN`）。

### 4.9 Translation Engine V2 — Text Node 級別遍歷

> **變更紀錄：** V1 使用 Element 級別遍歷（`innerText`），導致 HTML tag 被合併翻譯、版面破壞。V2 改為 Text Node 級別遍歷，參考 Immersive Translate 架構。

**核心資料結構 — Piece：**

```javascript
{
  isTranslated: false,
  parentElement: <Element>,  // 段落所屬的最近 block 父元素
  nodes: [textNode1, ...],   // text node 陣列 (nodeType===3)
  originalTexts: ['...']     // 翻譯前的原始文字備份
}
```

**遍歷演算法 — `extractPieces(root)`：**

```
getAllNodes(node):
  1. nodeType===1 (Element) 或 nodeType===11 (Shadow DOM):
     - 若為 SKIP_TAGS / notranslate / contentEditable → 切割段落，return
     - 若為 INLINE_IGNORE_TAGS (BR, CODE, KBD) → 切割段落，return
     - 遍歷 childNodes:
       - 子節點非 INLINE_TAGS → 切割段落 → 遞迴 → 切割段落
       - 子節點為 INLINE_TAGS → 直接遞迴（不切割）
  2. nodeType===3 (Text Node):
     - textContent.trim() 非空 → 加入當前 piece.nodes[]
     - 段落字符累計超過 PIECE_MAX_CHARS → 強制切割新段落
```

**翻譯注入策略：**

```
翻譯前：備份所有 text nodes 的 textContent → piece.originalTexts[]
翻譯後：
  1. 每個 piece 的 text nodes 依 index 寫回翻譯結果
  2. 在 piece.parentElement 後方插入 <span class="ct-translated"> 翻譯行
  3. 原文結構 (strong, a, em 等) 完整保留不受影響
恢復：從 originalTexts[] 恢復 text nodes 的 textContent
```

**notranslate 標準支援：**
- `class="notranslate"` — 跳過翻譯
- `translate="no"` — HTML 標準翻譯控制屬性
- `contentEditable` — 可編輯區域跳過

### 4.10 動態內容翻譯（MutationObserver）

翻譯完成後啟動 MutationObserver 監聽 DOM 變更：
- 監聽 `{ childList: true, subtree: true }`
- 新增的 block 節點加入翻譯佇列
- 每 2 秒批次處理佇列中的新節點
- 頁面不可見時（`visibilitychange`）暫停監聽
- 避免重複翻譯已處理的節點

## 5. Key Interfaces

### 5.1 Message Protocol (Content ↔ Background)

```javascript
// Content → Background: 翻譯請求
{
  type: 'TRANSLATE',
  payload: {
    texts: ['Hello', 'World'],   // 待翻譯文字陣列
    targetLang: 'zh-TW'          // 目標語言（Google Translate 格式）
  }
}

// Background → Content: 翻譯結果（成功）
{
  type: 'TRANSLATE_RESULT',
  payload: {
    translations: ['你好', '世界'],
    sourceLang: 'en',
    fromCache: false
  }
}

// Background → Content: 翻譯結果（失敗）
{
  type: 'TRANSLATE_RESULT',
  error: { message: '...', code: 'RATE_LIMITED' }
}
```

### 5.2 YouTube Interceptor ↔ Content Script

```javascript
// youtube-interceptor.js (MAIN) → youtube.js (ISOLATED)
window.postMessage({
  type: 'CT_SUBTITLES_RAW',
  payload: {
    subtitles: [
      { startMs: 1000, durationMs: 2500, text: 'Hello world' }
    ],
    videoId: 'dQw4w9WgXcQ',
    language: 'en'
  }
}, '*');
```

### 5.3 Chrome Storage Schema

```javascript
// chrome.storage.local（持久存儲）
{
  'ct_target_lang': 'zh-TW',    // Google Translate 語言代碼
  'ct_enabled': true
}

// chrome.storage.session（翻譯快取，session 生命週期）
{
  'cache:1a2b3c': '你好世界',
  'cache:4d5e6f': '這是翻譯結果'
}
```

## 6. Key Decisions Log

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | YouTube 字幕策略 | 攔截 TimedText API | 批次翻譯，品質更好 |
| 2 | 雙語顯示方式 | 原文下方 `<span>` | 最自然的閱讀體驗，不破壞佈局 |
| 3 | 翻譯快取 | Session 快取 (djb2 hash) | 平衡效能與儲存空間 |
| 4 | Build 工具 | 無 | MVP 簡化，直接載入開發 |
| 5 | MV3 Content Script | 多檔案共享 ISOLATED world | 無 build step 下的模組化方案 |
| 6 | **翻譯 API** | **Google Translate (free gtx)** | DeepL 註冊失敗，Google 免費無限額度 |
| 7 | **DOM 遍歷** | **遞迴下降 + _hasBlockDescendant** | TreeWalker 漏抓太多；穿透 inline 包裝精準拆分 |
| 8 | **批次策略** | **逐條翻譯 + 5 併發** | 分隔符號合併法不可靠，Google 會改變分隔符號 |
| 9 | **翻譯元素** | **`<span>` 非 `<div>`** | 減少對表格/列表佈局的影響 |
| 10 | **事件隔離** | **stopPropagation on button** | 防止宿主頁面 JS 操作 SVG 子元素報錯 |
| 11 | **DOM 遍歷 V2** | **Text Node 級別遍歷** | Element 級 innerText 會吃 HTML tag；Text Node 級保留 DOM 結構 |
| 12 | **動態內容** | **MutationObserver + 2s 佇列** | SPA 頁面切換後新內容需要自動翻譯 |

## 7. Known Issues & Workarounds

| # | Issue | Root Cause | Fix |
|---|-------|-----------|-----|
| 1 | Service Worker 顯示「無法使用」 | `importScripts` 路徑需相對於 SW 檔案位置 | 使用 `../utils/constants.js` 而非 `utils/constants.js` |
| 2 | 懸浮按鈕不出現 | content.js 引用已刪除的 `CT.STORAGE_API_KEY` | 移除該引用 |
| 3 | HN 頁面排版跑掉 | `<div>` 插在 `<td>` 後面破壞表格結構 | 表格/列表內改用 `appendChild`，元素改用 `<span>` |
| 4 | `el.className.split is not a function` | 宿主頁面 JS 存取 SVG 元素的 className (SVGAnimatedString) | Button click 加 `event.stopPropagation()` |
| 5 | 翻譯覆蓋率低（與沉浸式翻譯差距大） | TreeWalker 找錯文字區塊父元素 | 重寫為遞迴下降演算法 |
| 6 | DOM 重寫後按鈕沒反應 | `getComputedStyle` 對每個元素太慢/報錯 | 移除 visibility check，改用 try-catch |
| 7 | 翻譯結果全部為空（按鈕綠色但 0 段） | 分隔符號 `\n▁\n` 被 Google 改變導致拆分失敗 | 改為逐條獨立翻譯請求 |
| 8 | `<a>` 包裹 `<h3>`+`<p>` 未正確拆分 | 只檢查直接子元素是否為 block | 新增 `_hasBlockDescendant()` 遞迴穿透 inline |
| 9 | Extension context invalidated | 重新載入擴充功能後舊 content script 失效 | 啟動時檢查 runtime.id + 錯誤提示刷新頁面 |
| 10 | `postMessage` 垃圾錯誤訊息 | 網站廣告追蹤腳本的 data:text/html iframe | 非本擴充功能問題，可忽略 |
| 11 | **HTML tag 被翻譯出來** | Element 級 innerText 取出包含子元素的文字合併送翻譯 | **改用 Text Node 遍歷，只翻譯純文字節點** |
| 12 | **翻譯後版面跑掉** | afterend 插入 span 在 table/flex 佈局中破壞結構 | **改用段落後插入翻譯行 + text node 原地替換** |

## 8. Future Expansion (Post-MVP)

- [ ] 其他影片平台支援（Vimeo、B站）
- [ ] 其他翻譯引擎選項（DeepL、ChatGPT、Gemini）
- [ ] PDF / ePub 文件翻譯
- [ ] 劃詞翻譯 / 懸停翻譯
- [ ] Options 頁面（進階設定）
- [ ] 白名單/黑名單網站管理
- [ ] 快捷鍵支援（Ctrl+Shift+T 觸發翻譯）
- [ ] 翻譯品質微調（排除已是目標語言的段落）
- [ ] 自動翻譯模式（頁面載入後自動翻譯）
- [ ] 智慧容器偵測（文字密度分析，自動聚焦文章正文）
- [ ] Viewport 感知的懶翻譯（只翻譯可見區域）
- [ ] 網站特殊規則系統（per-site selector/container 配置）
