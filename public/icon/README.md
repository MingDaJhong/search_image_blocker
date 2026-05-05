# 圖示資料夾

## 檔案

- `icon.svg` — 來源 SVG（要改 icon 設計就改這個）
- `build.py` — 從 SVG 派生五個尺寸 PNG 的腳本
- `{16,32,48,96,128}.png` — build 出來的成品，WXT 自動掛進 manifest

## 重新生成

```bash
python3 public/icon/build.py
```

需要 Pillow（`pip3 install --user Pillow`）跟 macOS 內建的 `qlmanage`。

## 為什麼小尺寸要特別處理

SVG 的 stroke-width=5 在 viewBox 128 下，輸出到 16x16 只有 0.6 物理像素 — 比一個像素還細，會糊成淡色。

`build.py` 對 16/32px 自動做三件事：

1. **加粗線條**：stroke-width 抬高到至少 1.6 物理像素的等效值（16px 約 12.8 viewBox 單位）
2. **放大太陽**：原本 r=10 太小，乘 1.6 倍並往中心移
3. **移除 mountainMask**：原 SVG 用 mask 在山脈上挖出與紅斜線對齊的縫隙；小尺寸下這個縫隙變成大破洞，山脈直接斷開

48/96/128px 直接用原始 SVG 渲染，不動。

## 改設計時

改完 `gemini-svg.svg` 後直接 `python3 public/icon/build.py`。

如果原 SVG 結構變了（例如太陽座標、mountainMask id 改了），`build.py` 裡面 `enlarge_sun` 跟 `remove_mountain_mask` 的 regex 也要跟著調整。

## 換檔名了？

`build.py` 寫死讀 `icon.svg`。要換不同檔名（例如 `icon-v2.svg`），改 `build.py` 第 23 行的 `SRC` 變數即可。
