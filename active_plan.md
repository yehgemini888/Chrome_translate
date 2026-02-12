# Chrome Translate — Active Plan
> Version: 1.1 | Last Updated: 2026-02-11

**Overall Progress:** MVP 完成，網頁翻譯已驗證可用 (BBC 168/188 段)

---

## Phase 1: Foundation ✅

- [x] Task 01: Project Scaffolding
  > manifest.json、目錄結構、icon 佔位檔。chrome://extensions 載入成功。

- [x] Task 02: Core Utilities
  > `constants.js`（CT 全域常數）、`storage.js`（保留備用）、`dom-utils.js`（DOM 遍歷工具）。

- [x] Task 03: DeepL API Client → 已替換
  > 原 `libs/deepl-client.js` 保留備用。改用 Google Translate 免費端點。

- [x] Task 04: Background Service Worker
  > `service-worker.js`：訊息路由、翻譯 API 代理、session cache (djb2 hash)。

## Phase 2: Web Page Translation ✅

- [x] Task 05: Floating Button Component
  > `floating-button.js`：4 狀態 SVG 按鈕 (idle/translating/done/error)、stopPropagation 防護。

- [x] Task 06: Web Page Translation Engine
  > `translator.js`：DOM 遍歷、分批翻譯（2 併發批次）、雙語顯示注入、進度追蹤。
  > `content.css`：雙語樣式 + 深色模式支援。

## Phase 3: YouTube Translation ✅

- [x] Task 07: YouTube Subtitle Interception
  > `youtube-interceptor.js` (MAIN world)：monkey-patch fetch + XHR、JSON3/XML 字幕格式解析。

- [x] Task 08: YouTube Dual Subtitle Rendering
  > `youtube.js` (ISOLATED world)：字幕翻譯、MutationObserver 渲染、SPA 導航處理。

## Phase 4: UI & Integration ✅

- [x] Task 09: Popup Settings UI
  > 簡化版：啟用/停用開關、目標語言選擇。（移除 DeepL API Key 相關功能）

- [x] Task 10: Content Script Entry Point
  > `content.js`：YouTube/Web 模式偵測、模組初始化、runtime.id 檢查、語言代碼遷移。

- [x] Task 11: Integration Review
  > 修復 popup 常數引用、dead code 移除、importScripts 路徑。

---

## Phase 5: Bug Fixes & Iterations ✅

以下為 MVP 交付後的除錯與迭代紀錄：

- [x] Fix 01: Service Worker 路徑修復
  > **問題：** SW 顯示「無法使用」。Integration review 誤將 `../utils/constants.js` 改為 `utils/constants.js`。
  > **修復：** 恢復相對路徑 `../utils/constants.js`（相對於 background/ 目錄）。

- [x] Fix 02: 移除已刪除的 STORAGE_API_KEY 引用
  > **問題：** 切換到 Google Translate 後，content.js 仍引用已刪除的 `CT.STORAGE_API_KEY`，導致按鈕不出現。
  > **修復：** 移除 content.js 中對 `CT.STORAGE_API_KEY` 的引用。

- [x] Fix 03: 表格佈局破壞 + SVG className 錯誤
  > **問題：** HN 頁面 (1) `<div>` 插在 `<td>` 後破壞表格 (2) 宿主頁面 JS 存取 SVG className 報錯。
  > **修復：** (1) 表格/列表內用 `appendChild`，元素改用 `<span>` (2) Button click 加 `stopPropagation()`。

- [x] Fix 04: API 從 DeepL 切換為 Google Translate
  > **問題：** DeepL 帳號註冊失敗。
  > **修復：** 新增 `google-translate-client.js`、更新 constants（語言代碼 ZH-HANT → zh-TW）、簡化 popup、更新 manifest host_permissions。

- [x] Fix 05: DOM 遍歷演算法重寫（第一次）
  > **問題：** TreeWalker 方式翻譯覆蓋率極低，與沉浸式翻譯差距很大。
  > **修復：** 改為遞迴下降演算法，找「葉節點文字元素」（無 block 子元素的元素）。

- [x] Fix 06: 移除 getComputedStyle 可見性檢查
  > **問題：** DOM 重寫後按鈕沒反應，因 getComputedStyle 對每個元素呼叫太慢且會報錯。
  > **修復：** 移除 visibility check，改用 per-element try-catch。

- [x] Fix 07: Extension context invalidated 防護
  > **問題：** 重新載入擴充功能後，舊 content script 呼叫 `chrome.runtime.sendMessage` 失敗。
  > **修復：** (1) 啟動時檢查 `chrome.runtime.id` (2) 翻譯錯誤偵測到此訊息時停止並提示刷新。

- [x] Fix 08: Google Translate 批次策略修復
  > **問題：** 分隔符號 `\n▁\n` 合併翻譯後被 Google 改變，拆分失敗導致翻譯結果全空。
  > **修復：** 改為逐條獨立翻譯請求 + 5 併發控制。可靠性大幅提升。

- [x] Fix 09: DOM 遍歷 — 穿透 inline 包裝元素
  > **問題：** BBC 等網站用 `<a>` 包裹 `<h3>`+`<p>`，只檢查直接子元素漏掉 block 後代。
  > **修復：** 新增 `_hasBlockDescendant()` 遞迴穿透 inline 元素（a, span, em, strong 等）。

- [x] Fix 10: 語言代碼自動遷移
  > **問題：** 舊版儲存的 DeepL 語言代碼 `ZH-HANT` 不相容 Google Translate。
  > **修復：** content.js 啟動時偵測並自動遷移為 `zh-TW`。

---

## 驗證結果

| 測試項目 | 結果 | 備註 |
|----------|------|------|
| chrome://extensions 載入 | ✅ 通過 | Service Worker 狀態正常 |
| 懸浮按鈕顯示 | ✅ 通過 | 右下角藍色圓形按鈕 |
| BBC News 網頁翻譯 | ✅ 通過 | 168/188 段翻譯成功，覆蓋率 89% |
| 翻譯品質（與沉浸式翻譯對比） | ✅ 接近 | 標題、描述、內文均有翻譯 |
| Hacker News 翻譯 | ✅ 通過 | 表格佈局不再破壞 |
| YouTube 雙語字幕 | ⬜ 待測 | 尚未實際測試 |
| Popup 設定 | ⬜ 待測 | 啟用/停用、語言切換 |

---

## 待辦事項 (Post-MVP)

- [ ] 測試 YouTube 雙語字幕功能
- [ ] 測試 Popup 設定（啟用/停用切換、語言選擇）
- [ ] 排除已是目標語言的段落（避免中文翻中文）
- [ ] 提升翻譯覆蓋率（處理剩餘 20/188 未翻譯的區塊）
- [ ] 考慮自動翻譯模式（頁面載入後自動翻譯）
- [ ] 考慮 DeepL API 作為可選翻譯引擎

---

> **Memory Crystal:** v1.1.0 已 git commit (`92ec329`)。21 檔案、2371 行。可直接 chrome://extensions 載入使用。
