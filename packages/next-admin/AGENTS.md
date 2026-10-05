# 管理后台专属约束

本目录规则只约束 next-admin 的所有业务页面、编辑页、弹窗、内嵌面板和扩展，继续遵守仓库根 AGENTS.md。

## 开发前与接入约束

- 开发前阅读 [统一标准](./LOADING_REFRESH_INTERACTION_STANDARD.md)，按现有页面确认路由、资源域、读取条件、写入影响、草稿与权限边界。新增功能必须沿用这套方案。
- 业务路由沿用 AppShell / TabbedOutlet 的公共页面工作区、错误恢复和离开保护；独立业务入口使用 AdminPageWorkspace。扩展面板沿用扩展宿主的加载、失败、局部重试和草稿规则，不得另建页面生命周期。
- GraphQL 读取使用 useAdminQuery / useAdminLazyQuery；非 GraphQL 读取使用 useAdminReadResource。Apollo 是唯一共享服务端数据缓存；不得用页面缓存或 localStorage 建第二份业务数据真源。表单草稿和 URL 筛选状态按其原有用途管理。
- 查询时效、阶段和资源域沿用公共 queryPolicy 与资源规则。轮询使用公共查询选项或 useActiveInterval，隐藏页面、隐藏窗口和离线时暂停；不得页面自行 setInterval 或绕过活动状态读取。
- 整页业务刷新使用 AdminButton refreshPage；明确的局部读取使用查询 refetch。不得使用 location.reload 处理业务刷新；版本恢复沿用 build-recovery。不得把 Auth 和 AppShell 的引导读取例外复制到业务代码。

## 数据状态与操作保护

- 首次加载使用 loading && !data。相同查询身份刷新保留内容，失败标明更新失败并提供重试；不得修改原始 loading 以伪造空闲。切换实体、筛选或作用域不得借用旧结果，无权限及会话失效不得继续展示旧业务内容。
- 长期编辑表单使用 useServerDraft 或已有等效的版本和 dirty 保护，并登记公共离开保护。dirty 判断必须独立于后台 loading；服务端更新不得覆盖未保存输入。发生版本冲突时明确处理草稿后才可保存。
- 新增写入根字段必须核对 runtime/admin-resource-events.ts 的 resourceDomains 映射；不同受影响资源都要覆盖。写入成功后的读取失败须独立反馈，只重试读取，不重放业务写入。提交禁用状态沿用真实 mutation loading。
- 新扩展配置与查询失败必须局部呈现，保留相邻已加载面板和未保存输入。手动刷新不应打开未启用的弹窗查询。

## 交互与设计

- 使用 AdminControls、AccessibleDialogSurface、SearchInput、PageSizeSelect 与现有主题语义变量，不在业务页另建按钮、输入框、弹窗焦点或搜索防抖实现。
- 保持一个最强主操作、清晰的次级刷新与筛选、紧凑桌面扫描布局和手机触控尺寸。控件有标签、键盘焦点、禁用及忙碌状态；动效尊重 reduced-motion。
- 搜索、筛选、短文本、数字与单选字段使用 AdminField；桌面按字段实际宽度自适应为左标题、右控件。用户确认的移动端方案规定 767px 以下标签上置，说明与错误跟随控件；平板/桌面的窄字段也自然纵排。长文本、图片、上传和复杂编辑区使用 stacked 布局；复用现有设置、扩展字段与页面 Field 组件，不再另建字段壳。
- 手机列表复用 AdminMobileList / AdminMobileSort 或有明确 data-label 的 admin-mobile-record-table；桌面和手机共用数据、选择、排序和操作回调。隐藏表头必须保留排序/全选入口，比较型表格使用 admin-comparison-scroll 与明确提示，不隐藏业务字段来掩盖溢出。
- 页面必须有首次加载、空数据、局部错误与可执行重试。不要以整页占位替换可用数据，也不要把单个面板失败扩大为整个应用不可用。

## 强制检查与完成证据

- 从本包运行 `bun run check:feedback`。现有 `bun run build` 也会先执行该检查，不新增另一套构建流程。
- 架构门禁扫描 src 的生产 JS/TS 源码及新目录，自动拦截直接 Apollo 业务读取 Hook、原生业务控件、自建 setInterval、location.reload 与缺失资源域的可解析静态 gql 写入。详情可用 `node scripts/audit-admin-interaction.mjs` 查看；普通测试目录和 spec/test 文件不作为生产页面扫描。
- 运行受影响测试；源码变化执行后台构建，交互或布局变化按影响执行对应浏览器场景。纯规则或检查工具变化使用定向规则测试。不得默认重复整包测试、后端/数据库矩阵或全仓 CI。
- 新功能按统一标准的验收矩阵选取适用场景：首次读取、刷新合并、读取失败/空数据、筛选与实体切换、隐藏/离线恢复、写入后更新、草稿冲突/离开、键盘/中文输入与手机布局。
- 业务单元夹具可模拟公共查询接口；缓存、去重、轮询和作用域隔离必须使用实际 Apollo 验证。动态拼装文档、间接 API 调用与外部扩展还需运行时契约测试，静态通过不代表行为全部正确。
- 不得关闭门禁、扩大白名单或抬高预算来通过检查。公共能力缺失时先完善公共层再接入；确有例外须明确范围、代码位置、原因和定向回归，涉及登录、权限、支付等仍按上级规则单独确认。
- 完成报告写明改动文件、实际检查与结果、未验证项，区分代码完成、本地验证、浏览器验收和生产/业务结果。本地完成不授权推送、合并、部署或真实账户写入。
