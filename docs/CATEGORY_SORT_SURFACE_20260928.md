# 手机分类排序栏底色

- 用户要求：全部／销量／最新／价格／筛选所在整行与顶部搜索框使用相同背景色。
- 实现：仅将 `home-showcase.css` 手机分类页排序栏背景改为搜索框已有的 `--control-surface`；左右延伸层继续继承背景，覆盖有侧栏和无侧栏布局。同步更新皮肤设计约定。
- 来源：工作区 `.codex-worktrees/logistics-redesign-20260928`，分支 `feat/logistics-redesign-20260928`，修改前 HEAD `9fc9d742b7d1d6ddfc966f4cd6fa536115a09f1e`；本次提交固定实现，登记键 `category-sort-surface`。
- 本地预览：`http://127.0.0.1:5199/category`，使用实际客户端组件及现有只读合成商品 fixture。截图不代表线上商品数据；未写入业务数据。
- 截图记录：`artifacts/category-sort-surface-20260928/`，包含修改前后截图及 `before-observations.json`、`after-observations.json`。390px 下三种皮肤分别记录有侧栏／无侧栏，共六种状态；搜索框、排序栏及左右延伸层的计算背景色均一致；内容宽度为 390px，排序栏保持 44px 高。
- 检查：`bun run --cwd packages/storefront build` 成功，包含类型检查、客户端及独立 2FA 构建；`git diff --check` 通过。未新增或运行测试套件。
- 2026-09-30 发布候选：上述为原工作树的本地记录；现已从最新 `main` 单独移植这一项，发布、线上验收以本候选的 PR 和运行回执为准。
