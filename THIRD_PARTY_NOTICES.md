# 第三方资源说明

## Typr.js

- 文件：`content/vendor/typr.js`
- 来源：https://github.com/photopea/Typr.js
- 许可：MIT
- 许可证全文：`content/vendor/TYPR-LICENSE.txt`

Typr 仅用于解析页面内嵌 TTF 的 cmap/glyf，生成字形路径；不联网。

## cxsecret 字形映射表

- 文件：`content/vendor/cxsecret-table.js`
- 内容：字形路径 MD5 → Unicode 的映射表，共 20,906 条。
- 文件内嵌元数据：`author: wyn665817`、`license: MIT`、
  `version: 20220515.1`。
- 用途：把当前页面内嵌字体中已混淆的字形还原为真实汉字。
- 说明：该表的原始出处与再分发许可仍需使用者在再分发或商业使用前
  自行核验；本项目保留原始元数据，不对第三方数据的权利作额外保证。
- 该表不包含账号、Cookie、Token、答案或课程数据。

## 字体夹具

- 文件：`tools/fixtures/cxsecret-ceramic.ttf`
- 状态：**不随公开仓库分发**，已加入 `.gitignore`。
- 用途：仅在本地开发环境中验证字体解析和字形还原。
- 不包含账号、Cookie、Token 或答案数据。
- 缺少该文件时，公开测试会跳过字体解码用例，其余测试继续执行。
