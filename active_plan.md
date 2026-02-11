# Chrome Translate — Active Plan
> Version: 1.0 MVP | Last Updated: 2026-02-11

**Progress:** 11/11 tasks (100%) ✅ COMPLETE

---

## Phase 1: Foundation

- [x] Task 01: Project Scaffolding ✅
  > 建立 manifest.json、目錄結構、icon 佔位檔。確保可在 chrome://extensions 載入。

- [x] Task 02: Core Utilities ✅
  > 實作 `utils/constants.js`（全域常數）、`utils/storage.js`（Chrome Storage 封裝）、`utils/dom-utils.js`（DOM 遍歷工具）。

- [x] Task 03: DeepL API Client ✅
  > 實作 `libs/deepl-client.js`，封裝 DeepL Free API 呼叫，含批次翻譯、錯誤處理、重試機制。

- [x] Task 04: Background Service Worker ✅
  > 實作 `background/service-worker.js`，處理訊息路由、API 代理呼叫、快取查詢。

## Phase 2: Web Page Translation

- [x] Task 05: Floating Button Component ✅
  > 實作 `content/floating-button.js`，頁面右下角懸浮翻譯按鈕，含 idle/translating/done/error 四種狀態。

- [x] Task 06: Web Page Translation Engine ✅
  > 實作 `content/translator.js`，DOM 遍歷萃取文字、分批翻譯、雙語顯示注入（原文下方插入譯文）、翻譯進度追蹤。搭配 `content.css` 雙語樣式。

## Phase 3: YouTube Translation

- [x] Task 07: YouTube Subtitle Interception ✅
  > 實作 `content/youtube-interceptor.js`（MAIN world），monkey-patch fetch 攔截 /api/timedtext 回應，透過 window.postMessage 傳遞字幕資料。

- [x] Task 08: YouTube Dual Subtitle Rendering ✅
  > 實作 `content/youtube.js`（ISOLATED world），接收攔截的字幕資料、批次翻譯、建立對照表、MutationObserver 監聽字幕變化並插入翻譯行。處理 YouTube SPA 導航。

## Phase 4: UI & Integration

- [x] Task 09: Popup Settings UI ✅
  > 實作 `popup/popup.html`、`popup.js`、`popup.css`。包含 API Key 輸入驗證、翻譯開關、目標語言選擇、用量顯示。

- [x] Task 10: Content Script Entry Point ✅
  > 實作 `content/content.js` 主入口，整合所有模組：偵測頁面類型（一般/YouTube）、初始化對應功能、管理生命週期。

- [x] Task 11: End-to-End Testing & Packaging ✅
  > 整合審查完成。修復 4 項問題：popup 常數引用、dead code 移除、YouTube 語言匹配泛化。

---

> ✅ All 11 tasks delivered. Extension ready for developer mode loading.
