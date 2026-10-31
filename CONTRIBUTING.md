# 贡献指南

## 开发

```bash
cd tools
npm install
npm test
```

字体夹具 `tools/fixtures/cxsecret-ceramic.ttf` 不随公开仓库分发；缺少它时，`test-cxsecret.js` 会跳过字体解码用例，其余测试继续执行。

## 提交前

- 不要提交 `.env`、Cookie、Token、账号密码或真实课程私有数据；
- 新增解析规则时，请使用脱敏 DOM 夹具；
- 保持 `manifest.json` 权限最小化；
- 修改题库身份、保存门禁或 frame 关联逻辑时，补充对应测试；
- 运行 `npm test`。

## 代码风格

- 使用原生 JavaScript，不引入运行时框架；
- 解析规则与数据层保持分离；
- 不把完整 URL 的 query/hash 写入题库；
- 未验证数据必须显式标记，不能伪装成已验证。
