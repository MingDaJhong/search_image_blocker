# 圖示資料夾

請放置以下尺寸的 PNG 圖示：

- icon-16.png
- icon-32.png
- icon-48.png
- icon-96.png
- icon-128.png

可以使用 https://favicon.io/ 或 Figma 自製。
完成後請在 `wxt.config.ts` 的 manifest 中加入：

```ts
icons: {
  16: 'icon/icon-16.png',
  32: 'icon/icon-32.png',
  48: 'icon/icon-48.png',
  96: 'icon/icon-96.png',
  128: 'icon/icon-128.png',
},
action: {
  default_icon: {
    16: 'icon/icon-16.png',
    32: 'icon/icon-32.png',
    48: 'icon/icon-48.png',
  },
},
```
