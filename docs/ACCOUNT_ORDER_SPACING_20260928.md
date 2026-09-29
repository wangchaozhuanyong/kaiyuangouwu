# 手机订单中心间距

- 用户要求：压缩订单图标区域过大的上下留白。
- 实现：复用已有 `0aa43b90` 的六入口布局，在当前分支保留为 `6bdfb595`；进一步去除标题底部叠加留白，标题下间距改为 4px，图标按钮最小高度由 76px 改为 60px，图标与文字相隔 4px，文字行允许自然增高。
- 文件：`src/styles/account-catalog-surfaces.css`；已有六入口改动还包含 `src/pages/account-page.tsx` 的手机短标签。同步 `DESKTOP_SKIN_DESIGN_CONTRACT.md`。
- 范围：仅手机账户订单中心；图标 24px、真实数量角标、路由和焦点显露继续沿用共享实现，最小触控宽度 44px。
- 本地页面记录：相同样本卡片高度由 157px 变为 122px。经典皮肤 390px 中文、320px 英文及深色皮肤 390px 均无页面或入口行横向溢出；每个入口高 60px，320px 时宽 45px。实际客户端使用只读合成账户 fixture，不代表线上订单数据。
- 记录目录：`artifacts/account-orders-spacing-20260928/`，包括修改前后截图、几何数据、构建日志和后台同源预览截图。
- 检查：`bun run --cwd packages/storefront build` 成功，包含类型检查及客户端／独立 2FA 构建；`git diff --check` 通过。未新增或执行测试套件。
- 设计登记键：`account-order-spacing`。工作区 `.codex-worktrees/logistics-redesign-20260928`，分支 `feat/logistics-redesign-20260928`，修改前 HEAD `af68a42c958ddee2bdc5bbd686ef5f2bc9783861`，本地预览端口 5199。
- 2026-09-30 发布整合：只提取原分支的 `6bdfb595`、`491b86ff` 对应手机订单入口改动，落在独立 `fix/account-order-release-20260930` 工作树；原始截图和观察仍是合成只读样本。当前 `main` 的账户英雄图与其他工作区未提交设计未纳入本候选。合并、部署和线上验收分别记录，不以本地样本代替。
