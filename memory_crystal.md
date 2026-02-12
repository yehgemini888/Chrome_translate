# Chrome Translate — Memory Crystal
> Snapshot Date: 2026-02-12 | Version: 2.1 (DOM Engine V2 Refactor)

## 💎 Project Context
高性能、輕量級的 Chrome 網頁翻譯擴充功能，旨在替代沉浸式翻譯。
採用 **Google Translate Free API** (gtx) 作為後端，無需 API Key。

## 🧠 Critical Architectural Decisions (V2 Engine)

### 1. In-Place Text Node Replacement (The "React Fix")
這是 V2 引擎最關鍵的架構變更。
- **問題**：原本使用 `appendChild` 在段落後插入翻譯 `<span>`。React/Vue 等框架在 re-render 時會偵測到 DOM 結構異常（unknown child），進而移除我們的翻譯元素，導致「捲動後翻譯消失」。
- **解法**：模仿 Immersive Translate，直接**替換**原始 Text Node。
  ```javascript
  // 原本 DOM: [textNode]
  // 替換後:   <span>[textNode][translationSpan]</span>
  ```
- **結果**：對 React 而言，原本的 text node 只是被替換了，結構仍在掌控中。實測證明能完美存活於 Yahoo Finance 等虛擬滾動 (Virtual Scrolling) 網站。

### 2. Session Caching Strategy
避免捲動回原本已翻譯的區域時重新呼叫 API。
- 使用 `chrome.storage.session` 儲存翻譯結果。
- Key: `djb2` hash of text content.
- 捲回時：DOM 可能被重建 -> 再次觸發翻譯 -> 命中 Cache -> 直接顯示 (Zero API Cost)。

### 3. DOM Traversal V2 (Text Node Level)
- **V1**：Extract Block `innerText` -> 導致 HTML tag 被合併翻譯、連結遺失、版面錯亂。
- **V2**：Extract `Text Node` (`nodeType===3`) -> 依 index 還原翻譯。
  - 保留所有 `<a>`, `<em>`, `<strong>` 結構。
  - 支援 `notranslate` class、`translate="no"`、`contentEditable`。

## 📂 Key File Map
- `utils/dom-utils.js`: **核心引擎**。包含 `extractPieces` (遍歷) 與 `insertTranslation` (注入)。
- `content/translator.js`: **流程控制**。整合 DOM 工具與 API 請求。
- `background/service-worker.js`: **API 代理**。處理 Google Translate 請求與快取。
- `libs/google-translate-client.js`: **API 客戶端**。封裝 gtx endpoint 邏輯。

## ✅ Current Status
- **Web Page Translation**: 100% Working. Tested on BBC (Static), Yahoo Finance (SPA/React), Hacker News.
- **YouTube Translation**: Basic implementation done (Intercept API). Needs further verification.
- **UI**: Floating button, Simple Popup.

## 🚀 Next Steps
1. **YouTube 深入測試**：驗證雙語字幕在各種播放情境下的穩定性。
2. **Options 頁面**：新增更多設定（如 API 切換、樣式自訂）。
3. **PDF 支援**：研究 PDF.js 整合。
