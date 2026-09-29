# 服务与政策入口及阅读页修复

## 问题与修改

- 页脚“服务与政策”原来只有 `strong` 文本，没有点击行为。现为按钮，调用原有内容导航打开隐私政策，作为两份政策的总入口；隐私政策和使用条款各自的直接入口继续保留。
- 文件切换原来使用默认 push 导航，每次切换增加一条历史。现仅替换当前法律页面记录，当前文件重复点击不导航，保留进入前的来源页。
- 手机法律页面原来叠加导航标题、填色按钮、正文顶距和经营主体卡片顶距。现使用共享阅读表面、44px 下划线切换、紧凑经营信息和自然正文；保留商家摘要、正文换行、联系邮箱和跨店内容过滤。页尾去除重复文件名。
- 桌面保留文件导航和阅读区分栏，缩减正文卡片的内边距。法律文案、后台字段和接口均未修改。

## 文件

- `packages/storefront/src/storefront-ui/page-shell.tsx`
- `packages/storefront/src/route-pages/legal-route-page.tsx`
- `packages/storefront/src/pages/legal-page.tsx`
- `packages/storefront/src/styles/home-showcase.css`
- `packages/storefront/src/styles/subpage-content.css`
- `packages/storefront/src/styles/desktop-pages.css`
- `packages/storefront/DESKTOP_SKIN_DESIGN_CONTRACT.md`

## 实际检查

- 浏览器使用实际客户端组件与只读合成账户；中文隐私正文来自用户截图，其余文本明确为本地布局样本。没有生产写入或法律文案发布。
- 390px 中文、320px 英文、深色和东方皮肤、1440px 桌面及未发布空状态共六组页面记录；无页面横向溢出，长邮箱可换行。
- 从账户页点击总入口打开隐私政策；连续切换六次并重复点击当前项后，历史长度始终保持进入时的 3 条。页面返回键及浏览器返回均一次回到 `/account`；直接访问政策页后返回首页。
- `node scripts/lint-check.mjs` 对三个变更 TSX 文件通过。
- `bun run --cwd packages/storefront build` 通过，包含类型检查、客户端与独立 2FA 构建。
- `git diff --check` 通过；未新增或运行测试套件。
- 截图、浏览器操作记录和日志：`artifacts/legal-reading-20260928/`。

## 来源与状态

登记键 `legal-reading`；工作区 `.codex-worktrees/logistics-redesign-20260928`，分支 `feat/logistics-redesign-20260928`，修改前 HEAD `491b86ff3ad25e947fce517b0a19ab89d96cd950`，本地预览端口 5199。本次提交固定实现，登记记录保存其 SHA。

发布整理（2026-09-30）：从原独立提交 `e82f39db` 仅移植法律页入口、导航历史及共享阅读布局到 `414a1c85` 基线，保留已合入的服务卡片契约，未纳入旧物流分支其他改动。原六组页面记录仍只证明旧提交的本地视觉状态；本候选须按最新基线完成定向检查，PR、部署及线上验收另记。
