# Chrome Translate — Active Plan
> Version: 2.0 | Last Updated: 2026-02-12

**Overall Progress:** MVP 完成。Phase 6 進行中 — DOM 引擎 V2 重寫（修復 HTML tag 翻譯 + 版面跑掉）

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
- [x] Fix 02: 移除已刪除的 STORAGE_API_KEY 引用
- [x] Fix 03: 表格佈局破壞 + SVG className 錯誤
- [x] Fix 04: API 從 DeepL 切換為 Google Translate
- [x] Fix 05: DOM 遍歷演算法重寫（第一次）
- [x] Fix 06: 移除 getComputedStyle 可見性檢查
- [x] Fix 07: Extension context invalidated 防護
- [x] Fix 08: Google Translate 批次策略修復
- [x] Fix 09: DOM 遍歷 — 穿透 inline 包裝元素
- [x] Fix 10: 語言代碼自動遷移

---

## Phase 6: Translation Engine V2 — DOM 引擎重寫 🚧

基於 Immersive Translate 原始碼分析，重寫 DOM 遍歷與翻譯注入策略。

- [ ] Task 12: Text Node 級別 DOM 遍歷重寫
  > 重寫 `dom-utils.js`：從 Element 級 `extractTextBlocks()` 改為 Text Node 級 `extractPieces()`。
  > 核心變更：收集 `nodeType===3` 的文字節點，按 block/inline 邊界分段成 pieces。

- [ ] Task 13: 翻譯注入策略重寫
  > 重寫 `dom-utils.js` + `content.css`：從 afterend span 改為段落後翻譯行。
  > 備份 `originalTexts[]`，翻譯後寫回 text node textContent，段落後插入翻譯行。

- [ ] Task 14: notranslate / contentEditable 標準支援
  > `dom-utils.js` 新增 `_isNoTranslateNode()`：支援 notranslate class、translate="no"、contentEditable。

- [ ] Task 15: Translator 適配新資料結構
  > 修改 `translator.js`：從 `extractTextBlocks()` 改用 `extractPieces()`，翻譯結果寫回 text nodes。

- [ ] Task 16: 動態內容 MutationObserver
  > 修改 `content.js`：翻譯後啟動 MutationObserver 監聽新增節點，每 2 秒批次翻譯。

- [ ] Task 17: 手動驗證 — BBC / HN / Google / GitHub 測試
  > 驗證 HTML tag 不再被翻譯、版面不跑掉、翻譯覆蓋率、恢復原文。

---

## 驗證結果

| 測試項目 | V1 結果 | V2 結果 |
|----------|---------|---------|
| chrome://extensions 載入 | ✅ 通過 | ⬜ 待測 |
| 懸浮按鈕顯示 | ✅ 通過 | ⬜ 待測 |
| BBC News 網頁翻譯 | ✅ 168/188 段 (89%) | ⬜ 待測 |
| HTML tag 不出現在翻譯文字 | ❌ 失敗 | ⬜ 待測 |
| 翻譯後版面不跑掉 | ❌ 失敗 | ⬜ 待測 |
| notranslate 標準支援 | ❌ 未實作 | ⬜ 待測 |
| Hacker News 翻譯 | ✅ 通過 | ⬜ 待測 |
| YouTube 雙語字幕 | ⬜ 待測 | ⬜ 待測 |

---

## 待辦事項 (Post-V2)

- [ ] 測試 YouTube 雙語字幕功能
- [ ] 測試 Popup 設定（啟用/停用切換、語言選擇）
- [ ] 智慧容器偵測（文字密度分析，自動聚焦文章正文）
- [ ] Viewport 感知的懶翻譯（只翻譯可見區域）
- [ ] 網站特殊規則系統（per-site 配置）
- [ ] 排除已是目標語言的段落
- [ ] 自動翻譯模式

---

> **Memory Crystal:** v1.1.0 已 git commit (`92ec329`)。21 檔案、2371 行。Phase 6 進行中。

