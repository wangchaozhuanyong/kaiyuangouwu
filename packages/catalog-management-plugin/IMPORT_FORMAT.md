# 商品导入格式

模板由 `src/dashboard/catalog-import-template.ts` 统一生成，next-admin 和 Vendure Dashboard 共用。CSV、Excel 和 Numbers 均使用相同的字段映射和行校验规则。

| 表格字段 | 规则 |
| --- | --- |
| 导入商店 | 每行必填目标商店标识；模板下载时预填当前渠道 code。兼容旧表头“门店”“门店编码”。值必须精确匹配当前渠道 code 或 ID，不按品牌展示名模糊匹配，不自动切换渠道。一份文件只导入当前商店，混合商店请分文件处理。 |
| 商品类型 | 每行必填“虚拟货品”或“实物”。兼容“虚拟商品”“实物商品”及 `digital` / `physical`。不根据名称、库存或门店默认值猜测。 |
| 一级分类 | 新建商品必填主分类；兼容旧列名“分类”“商品分类”。已有 SKU 的维护行允许留空以保留当前分类。 |
| 二级分类 | 可空。填写时必须同时填写一级分类。空白表示只属于一级分类，更新时也移除原导入二级分类，无需启用通用空白清除模式。 |
| SKU | 维护已有商品时保留稳定 SKU，以免因名称或分类改变而失去唯一匹配依据。 |

分类名不能包含 `>`，层级必须分列填写。同名二级分类按父分类区分，空白不会新建“默认”“无”或空名称的二级分类。

导出表保留“导入商店”（导出请求的当前渠道标识）、“商品类型”“一级分类”“二级分类”。导入分类标记优先于用于展示的已排序集合名称，避免一级分类覆盖真实完整路径。商品类型写入现有 Product.fulfillmentType，并由既有履约事件处理器同步 SKU。仅虚拟或仅实物门店遇到不兼容类型会报错，需要先明确调整门店经营模式。

导入规则按分类属性归类，不再给每个分类不断追加商品 ID；已有分类中的其他筛选和手工归属规则会保留。商品变更导致的全分类重算在批量导入期间延后，结束或异常后恢复并重新排队。进度仅在整数百分比改变时写入。行事务失败不会把回滚后的商品 ID 或应用时间保留在执行缓存中。

旧模板需要补充“导入商店”和“商品类型”列并逐行填好。已有待执行任务保存的是旧数据快照，不能通过替换下载模板改变它们；历史缺少商店或类型的未执行行会被阻止。商店范围在执行前再次校验，不能通过风险确认绕过。已导错类型的商品应先导出，保留 SKU，补正确类型和分类，再生成差异预览后确认导入。

## 系统默认渠道的范围

Vendure 的 `ChannelService.assignToCurrentChannel()` 会同时关联目标渠道与系统默认渠道；默认渠道是系统总目录。框架禁止通过常规商品移除接口解除默认渠道关联。关联不代表复制了一份商品记录，普通渠道仍按各自关联查询。

本次仅明确导入目标与校验范围，并修正后台默认渠道的范围说明；没有删除默认渠道关联、修改默认 Shop API 查询或清理线上数据。测试核验 A 店导入只新增一份商品，B 店 Admin/Shop API 无该商品，默认渠道 Admin/Shop API 保留汇总行为。如果业务要求默认顾客网站也是独立营业商店，需要确认实际域名所绑定的渠道和希望的商品范围，另行完成店铺隔离设计与验收，不能以隐藏后台列表冒充完成。

## 多店共享与批量分配

同一商品仍可共享到多个店铺；导入商店列不会取消已有分配。批量店铺弹窗通过专用只读查询展示当前用户有权查看的全部关联店铺，并显示目标店铺的“已在 / 未在”状态。普通店铺上下文也能查看管理员有权管理的其他店铺，不依赖核心 Product.channels 在非默认渠道只返回当前渠道的限制。

分配时只选择未分配的商品，移除时只选择已分配商品；切换操作、目标店铺、搜索或筛选会清空选择。执行前重新查询关联，跳过状态已变化的商品；执行后再次查询验证实际结果。价格系数只用于新增分配，已有店铺价格不会因重复选择而被重新计算。系统默认渠道标明自动关联并禁止常规移除，与现有后端约束一致。

新增查询只读现有关系，没有新增数据库字段，也没有修改商品共享、默认渠道自动关联或店铺域名绑定规则。只读权限范围由现有会话渠道权限限制；没有权限的店铺不在结果中出现。

## 验证命令

在仓库根目录运行：

```sh
bun install --frozen-lockfile --linker=hoisted
bun run build:core-common
bun run --cwd packages/testing build
bun run --cwd packages/content-translation-plugin build
bun run --cwd packages/catalog-management-plugin test
bun run --cwd packages/catalog-management-plugin check-types
bun run --cwd packages/catalog-management-plugin build
bunx --no-install tsc -p packages/catalog-management-plugin/e2e/tsconfig.json --noEmit
bunx --no-install vitest run --config e2e-common/vitest.config.mts packages/catalog-management-plugin/e2e/catalog-import-classification.e2e-spec.ts --maxWorkers=1
bun run --cwd packages/next-admin build
node scripts/lint-check.mjs
bun run check:architecture-debt
```

集成测试使用临时 SQL.js 数据库和 127.0.0.1 测试浏览器入口，复用真实履约事件处理器；检查 Admin/Shop API、类型同步、分类移动、回导幂等、回滚、模板下载及桌面/390px 布局。不会连接生产环境。
