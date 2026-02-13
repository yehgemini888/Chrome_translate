# Chrome Translate — Memory Crystal
> Snapshot Date: 2026-02-12 | Version: 2.3 (YouTube Architecture V4)

## 💎 Project Context
高性能、輕量級的 Chrome 網頁翻譯擴充功能。
採用 **Google Translate Free API** (gtx)。
V2.3 核心更新：**YouTube 字幕引擎 V4**，解決同步與持久性問題。

## 🧠 Critical Architectural Decisions

### 1. YouTube Hybrid Sync (V4)
- **問題**：YouTube 原生字幕 DOM 經常被其內部邏輯重繪，導致我們注入的翻譯行隨機消失或重複出現。
- **解法**：
  - 將原生字幕容器設為 `opacity: 0`（保持活動，但不顯示）。
  - 建立獨立的 `#ct-yt-overlay` 置於播放器頂層。
  - **雙重同步**：`MutationObserver` 監聽原生字幕文字變化 + `timeupdate` 主動對齊攔截到的完整字幕資料。
- **結果**：繼承了 YouTube 原生的換行時機，同時擁有完全受控的雙語渲染。

### 2. Player-Integrated Controls
- 在 YouTube 控制列（`.ytp-right-controls`）插入 `CTYouTubeButton`。
- 提供內置選單，無需開啟擴充功能 Popup 即可切換字幕模式。

### 3. Subtitle Customization
- **Storage Schema**: 新增 `ct_yt_sub_scale` 與 `ct_yt_sub_color`。
- **CSS Variable**: 利用 JS 算好字體大小與顏色後動態更新 Overlay 樣式。

### 4. Communication: CustomEvent Over postMessage
- 攔截器 (MAIN world) 與內容腳本 (ISOLATED) 改用 `CustomEvent` 通訊。
- 減少與網頁既有 `message` 事件的衝突，提高傳輸穩定性。

## 📂 Key File Map
- `utils/dom-utils.js`: 網頁翻譯核心。
- `content/youtube.js`: **YouTube V4 引擎**。包含 Overlay 邏輯與同步引擎。
- `content/youtube-player-button.js`: YouTube 播放器內置按鈕與選單。
- `content/youtube-interceptor.js`: 字幕攔截邏輯。
- `popup/popup.js`: 全域設定與字幕樣式預覽。

## ✅ Current Status
- **Web Page Translation**: 穩定，採 Text Node 替換策略。
- **YouTube Translation**: **全新 V4 架構**。支援雙語/原文/譯文切換、樣式自訂。
- **MutationObserver**: 已解決網頁與 YouTube 的無限迴圈問題。

## 🚀 Next Steps
1. **多影片測試**：驗證在不同解析度、全螢幕切換下的 Overlay 適應性。
2. **自動翻譯模式**：使用者可設定特定網站或影片自動開啟翻譯。
3. **智慧分段優化**：對於長段落字幕，進一步優化翻譯切分。
