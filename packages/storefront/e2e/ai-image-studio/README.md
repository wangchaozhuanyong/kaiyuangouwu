# AI 图片工坊与真实本地 API 验收

此夹具使用真实工坊组件、ShopApi、登录、GraphQL、MySQL 和私有文件接口。后端来自图片插件的隔离 E2E，只有外部模型响应被模拟；生成图是测试 PNG，不代表真实模型效果。

外层页面属于测试夹具。身份通过 ShopApi 的真实登录及同一认证传输查询获取；隔离后端没有安装完整结账扩展，因此身份查询不附加无关订单字段。不会访问生产，也不会写入真实模型凭证。

在 `packages/image-generation-plugin` 运行其现有 `test:e2e` 命令，显式设置 `E2E_IMAGE_STUDIO_BROWSER=1` 启用。数据库使用该包现有 E2E 配置。该开关只影响测试，示例见该包 `e2e/.env.example`。未启用时浏览器用例跳过，其余后端回归照常执行。

本轮 MySQL 在 127.0.0.1:13370，完整命令与输出目录见项目内 `reports/ai-image-studio-audit-20260913/CLOSURE-RESULT.md`。测试启动 Vite 5186 端口并在 finally 中关闭 Vite 和 Chromium；端口被其他服务占用时直接失败，不接管或终止其他服务。临时文件路径必须通过 TMPDIR 指定到本项目内。

流程包括真实登录和身份读取、上传、付费优化、服务端字数预算、生图、钱包刷新、私有下载、再次创作后编辑与第二次生成，以及手机宽度检查。数据库进一步断言两次图费及一次优化费、冻结金额归零、参考图复用与编辑内容持久化。

## 完整主站入口的补充验证

从仓库根目录执行 `node packages/storefront/e2e/ai-image-studio/verify-shell.mjs`。脚本使用真正的 `main.tsx`、Router、App、StorefrontShell 和 ShopApi，覆盖服务入口、未登录提示和登录页、账户读取失败/重试、费用反馈，以及桌面和手机宽度。GraphQL 数据和登录状态全部在本地模拟；不提交真实登录、上传、生图或付款，不访问生产或供应商。它补充上方真实 API 测试，不能替代真实后端或原照片效果验证。

脚本独占本地 Vite 5187，未知 GraphQL 操作和外部请求会令验证失败；finally 关闭 Vite 与 Chromium。结果、截图、日志均归项目内 `reports/ai-image-studio-audit-20260913/`，最新报告为 `SHELL-RESULT.md`。不会修改业务源代码、项目依赖或生产配置。
