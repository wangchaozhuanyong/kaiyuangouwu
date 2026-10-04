# 管理后台短字段横排修复

状态：代码完成、本地验证完成。未推送、未运行远端 CI、未合并、未部署或写入生产数据。

## 改动

截图中的“查找卡密 SKU”已变为左标题、右输入框；查询数量与搜索区垂直居中。后台短字段统一使用 AdminField，不再由各页面强制纵排。已接入 119 个字段组件调用以及设置分组字段，覆盖 59 个已有生产 TSX 文件；另新增一个公共组件。

- 按字段自身可用宽度判断：达到 20rem 时横排，不足时纵排；适用于多列表单、弹窗和手机，避免只看浏览器宽度导致挤压。
- 标题列最多 9rem，长标题自然换行。说明、校验错误跟随控件。
- 文本域、文件上传和明确标记的复杂编辑区保留纵排。既有复选框、分页、已横排的工具栏保持其语义布局。
- 设置页 Field / FieldGroup、商城装修 Field、推广字段、扩展字段与可配置操作字段使用同一套规则。商品、库存、采购、订单、售后、客户、营销、店铺、插件等模块的重复短字段已接入。
- 去掉设置字段固定预留的标题高度，新增布局约束并接入现有 check:feedback 检查，拦截重新写成上下两行的短字段。

## 验证

| 检查                     | 结果                                                                        |
| ------------------------ | --------------------------------------------------------------------------- |
| 现有反馈、加载及交互门禁 | 通过，286 个生产源文件、276 个写入映射                                      |
| 定向单元测试             | 90 个不同测试通过；第二组包含公共规则的必要重跑，未把重复测试累计为新增覆盖 |
| Admin 构建               | TypeScript、Vite、生产路径与显示本地化检查通过                              |
| 新布局夹具类型检查       | 通过                                                                        |
| 浏览器合成验收           | 64 个场景通过；1440 / 1024 / 390，深浅主题、触控、供货商及分类弹窗          |
| 字段边界                 | 500 / 320 / 280 宽度、长英文标题、说明、错误、文本域、上传及复杂字段通过    |
| 输入交互                 | 标签点击聚焦、输入草稿、下拉选择、中文搜索及回车提交通过                    |
| 业务控件属性对比         | 378 个既有控件的非样式属性及回调与改动前一致                                |
| Scoped Oxlint            | 0 错误；15 条导出兼容性警告与改动前基线相同                                 |

浏览器使用项目已有 Apollo 合成数据夹具，拒绝业务写入；不代表生产页面或真实业务验收。分类页夹具缺少公共模板列表导致的渲染错误已补充为空数组；新增夹具使用明确的 React 导入。未修改生产接口或业务逻辑解决夹具问题。

构建保留已有的大 chunk 提示，未更改依赖、构建门限或业务接口。生产用户自定义长内容及未逐一打开的动态插件状态仍需上线后验证。

## 本地证据

- packages/next-admin/tmp/admin-inline-fields-20261004/local-receipt.json
- packages/next-admin/tmp/admin-inline-fields-20261004/build.log
- packages/next-admin/tmp/admin-inline-fields-20261004/tests.log
- packages/next-admin/tmp/admin-inline-fields-20261004/extra-tests.log
- packages/next-admin/e2e/admin-layout/results/inline-fields/receipt.json
- packages/next-admin/e2e/admin-layout/results/inline-fields/cardpool-1440-light.png

## 文件清单

- docs/ADMIN_INLINE_FIELDS_AUDIT_20261004.md
- packages/next-admin/AGENTS.md
- packages/next-admin/LOADING_REFRESH_INTERACTION_STANDARD.md
- packages/next-admin/e2e/admin-layout/field-layout-fixture.tsx
- packages/next-admin/e2e/admin-layout/fixture.tsx
- packages/next-admin/e2e/admin-layout/verify-fields.mjs
- packages/next-admin/scripts/audit-admin-interaction.mjs
- packages/next-admin/scripts/audit-admin-interaction.spec.mjs
- packages/next-admin/src/components/AdminField.tsx
- packages/next-admin/src/components/ConfigurableOperationFields.tsx
- packages/next-admin/src/components/ConfirmDialog.tsx
- packages/next-admin/src/components/SensitiveActionDialog.tsx
- packages/next-admin/src/custom-fields/DynamicCustomFieldsForm.tsx
- packages/next-admin/src/index.css
- packages/next-admin/src/pages/Auth/ProfileModule.tsx
- packages/next-admin/src/pages/Auth/TwoFactorSecurityCard.tsx
- packages/next-admin/src/pages/Catalog/AssetsModule.tsx
- packages/next-admin/src/pages/Catalog/CatalogBulkChannelAction.tsx
- packages/next-admin/src/pages/Catalog/CatalogExportAction.tsx
- packages/next-admin/src/pages/Catalog/CatalogModule.tsx
- packages/next-admin/src/pages/Catalog/CatalogOperationsBlocks.tsx
- packages/next-admin/src/pages/Catalog/CategoriesModule.tsx
- packages/next-admin/src/pages/Catalog/InventoryControlModule.tsx
- packages/next-admin/src/pages/Catalog/InventoryWarehouseModule.tsx
- packages/next-admin/src/pages/Catalog/PlatformSupplyDialog.tsx
- packages/next-admin/src/pages/Catalog/ProductAutoCardSetupPanel.tsx
- packages/next-admin/src/pages/Catalog/ProductBasicTab.tsx
- packages/next-admin/src/pages/Catalog/ProductEditorSidebar.tsx
- packages/next-admin/src/pages/Catalog/PurchaseOrdersModule.tsx
- packages/next-admin/src/pages/Catalog/QuickCreateOptionGroupModal.tsx
- packages/next-admin/src/pages/Catalog/StoreOfferDialog.tsx
- packages/next-admin/src/pages/Catalog/SuppliersModule.tsx
- packages/next-admin/src/pages/Catalog/import/CatalogImportDialog.tsx
- packages/next-admin/src/pages/Customers/CustomersModule.tsx
- packages/next-admin/src/pages/Marketing/GenericPromotionsPanel.tsx
- packages/next-admin/src/pages/Marketing/MarketingAttributionPanel.tsx
- packages/next-admin/src/pages/Marketing/promotion-actions.tsx
- packages/next-admin/src/pages/Marketing/promotion-reports.tsx
- packages/next-admin/src/pages/Marketing/promotion-ui.tsx
- packages/next-admin/src/pages/Marketing/referral-ui.tsx
- packages/next-admin/src/pages/Plugins/AiImageAccessModule.tsx
- packages/next-admin/src/pages/Plugins/AiImageSettingsModule.tsx
- packages/next-admin/src/pages/Plugins/ClientPluginsModule.tsx
- packages/next-admin/src/pages/Plugins/IcloudRelayModule.tsx
- packages/next-admin/src/pages/Plugins/TwoFactorCodesModule.tsx
- packages/next-admin/src/pages/Sales/AfterSalesModule.tsx
- packages/next-admin/src/pages/Sales/CardPoolModule.tsx
- packages/next-admin/src/pages/Sales/ManualDigitalDeliveryModule.tsx
- packages/next-admin/src/pages/Sales/OrderOperationsBlock.tsx
- packages/next-admin/src/pages/Sales/OrderProfitExpensePanel.tsx
- packages/next-admin/src/pages/Sales/OrderWorkflowEditor.tsx
- packages/next-admin/src/pages/Sales/ProfitReportModule.tsx
- packages/next-admin/src/pages/Sales/SalesModule.tsx
- packages/next-admin/src/pages/Settings/MyStoreFields.tsx
- packages/next-admin/src/pages/Settings/PaymentShippingManager.tsx
- packages/next-admin/src/pages/Settings/RolesModule.tsx
- packages/next-admin/src/pages/Settings/StoreFinancePanel.tsx
- packages/next-admin/src/pages/Settings/SystemOpsModule.tsx
- packages/next-admin/src/pages/Settings/TelegramNotificationsPanel.tsx
- packages/next-admin/src/pages/Settings/TranslationsModule.tsx
- packages/next-admin/src/pages/Settings/UsdtPaymentManagementModule.tsx
- packages/next-admin/src/pages/Settings/UsdtPaymentSetupPanel.tsx
- packages/next-admin/src/pages/Settings/settings-ui.tsx
- packages/next-admin/src/pages/Storefront/BusinessServicesCopyModule.tsx
- packages/next-admin/src/pages/Storefront/StorefrontAccountRecommendationsPanel.tsx
- packages/next-admin/src/pages/Storefront/StorefrontAuthSettingsPanel.tsx
- packages/next-admin/src/pages/Storefront/StorefrontContentModule.tsx
- packages/next-admin/src/pages/Storefront/StorefrontModule.tsx
- packages/next-admin/src/pages/Storefront/storefront-editor-controls.tsx
