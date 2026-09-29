# 智能服务卡片单行副标题及间距

- 用户要求：副标题预留一行，缩小服务卡片上下留白。
- 修改文件：`packages/storefront/src/styles/service-entries.css`；同步 `DESKTOP_SKIN_DESIGN_CONTRACT.md`。业务代码、接口和文案未改动。
- 2FA、邮件查询、AI 工坊副标题改为单行、省略溢出文字，完整文字仍在 DOM 中。手机内边距改为 `12px 16px`，按钮上间距 `10px`，卡片间距 `10px`；桌面相应收紧。保留颜色、边框、图标和至少 44px 高的操作区。
- 同样本观察：手机卡片由 172px 缩至 133px，桌面由 200px 缩至 154px；手机副标题 21px、桌面 22px。390px 中文、320px 英文、1440px 桌面和深色 390px 均无横向溢出。优惠券和客服辅助卡片的说明换行及高度保持原值。
- 实际检查：客户端截图和计算样式；`bun run --cwd packages/storefront build` 通过（类型检查、客户端及独立 2FA 构建）；`git diff --check` 通过。未新增或运行测试套件。
- 记录目录：`artifacts/service-card-density-20260928/`。实际客户端使用合成只读服务配置，截图不代表线上服务配置。
- 来源：已有 `service-cards` 设计的样式与渲染代码在本次修改前一致；本次仅调整间距和副标题。工作区 `.codex-worktrees/logistics-redesign-20260928`，分支 `feat/logistics-redesign-20260928`，修改前 HEAD `e82f39dbb3d7ec13d8b86eb6785179429cb3cec1`，预览端口 5199。新登记键 `service-card-density`。
- 发布整理（2026-09-30）：从原独立提交 `751b9287` 仅移植服务卡片样式和本节设计契约到当前已发布基线 `cc8cae6e`。原分支的其他布局与政策页改动未纳入；原有合成页面观察仍仅证明旧提交的视觉状态。本候选需按最新基线完成定向构建及 PR 检查，合入和线上验收另记。
