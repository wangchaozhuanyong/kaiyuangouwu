# 分享海报 V2 素材与发布

五款通用模板保持原稳定 ID；极光芯核是指定店铺的自定义模板。六张背景均为 1080×1920 PNG，不包含店名、网址、文案或二维码。图案已限制在 x=656、y=635、宽352、高450 的区域，文字与二维码由客户端生成。

原设计与生成来源：工作区 `planning/default-store-ai-energy-assets-20260905/poster-template-system-plan/`。这里采用其 `backgrounds/` 最终素材，未采用早期棋盘格草稿。历史图片不删除。

## 运行

在仓库根运行；凭据只使用已有环境变量 `SUPERADMIN_USERNAME`、`SUPERADMIN_PASSWORD`、`VENDURE_API_ORIGIN`，不要放入命令或日志。

```sh
bun run --cwd packages/store-management-plugin build
node packages/dev-server/scripts/sync-referral-posters.mjs --validate
```

生产发布必须先安装独立门禁引导版本，再通过 `Production Runtime Artifact` 选择 `referral_posters=primary` 或 `both-stores`。作用域由发布器按域名 Shop API 解析真实 Channel，AI 仅归主店。候选 API 启动前只读检查旧接口、全部店铺及资源；启动后再次预演并核验新接口，然后导入和独立验证，成功才切换客户端。

本地或其他店铺的人工初始化通过环境变量指定 `REFERRAL_POSTER_CHANNEL_CODES`、可选 `REFERRAL_POSTER_AI_CHANNEL_CODE`；它们与生产 `REFERRAL_POSTER_SCOPE` 互斥。默认没有目标，不会猜测当前店铺。写入前设置 `REFERRAL_POSTER_BACKUP_FILE` 为新的私有备份路径；同名文件不可覆盖。

```sh
node packages/dev-server/scripts/sync-referral-posters.mjs --dry-run
node packages/dev-server/scripts/sync-referral-posters.mjs --apply --allow-remote
node packages/dev-server/scripts/sync-referral-posters.mjs --verify
```

## 数据与默认选择

- 五款通用模板使用现有 `StorefrontContentBlock`：稳定 code 为 `referral-poster-<模板ID小写及连字符>`，type=CUSTOM，settings.purpose=referral-system-poster。内容块保持 disabled，避免出现在首页装修区域；海报显隐由本店 `ReferralProgramConfig.posterTemplates` 控制。
- 通用 copy/design/Asset 从服务端返回。重复发布保留本店原文案和已有设计配置，只更新版本化背景绑定。新店需要在开店内容初始化时运行本发布器才能获得六张素材中的五款通用背景；未初始化时服务端返回中性纯色排版。
- AI 素材仅发布到 `REFERRAL_POSTER_AI_CHANNEL_CODE` 指定店铺，以版本化 Asset 识别同一次导入，重复运行不再创建同一素材的模板。模板首次导入保持隐藏，不抢现有默认；在后台明确开启后进入本店可选列表。
- 修改通用模板文案请点击“基于此款创建本店模板”。内容、背景、开关和默认项均属于当前店铺，不覆盖其他店铺。
- 关闭最后一款时默认项为空。重新开启时恢复有效默认。显示域名来自当前分享地址，品牌来自本店配置，二维码来自当前用户的本店邀请链接。背景不得烘焙这些动态内容。

## 失败与恢复

每个店铺的五个系统绑定通过现有内容批次接口原子提交，携带全部区块的 `expectedUpdatedAt`。重复导入复用哈希一致的素材，保留店铺文案、设计、显隐和默认项；没有实际变更时不重复写内容。

写后逐一验证 Admin API 和中英文 Shop API 的图片 ID、全量广告文案、颜色、开关与默认项。语言验证同时设置 `languageCode` 查询参数和 `language-code` 请求头。公开域名必须解析回正确店铺。新 AI 模板保存完整双语文案后核验，首次保持隐藏。

失败时按逆序恢复已确认的内容绑定，并移除本次新建的配置；历史图片和既有模板不删除。内容批次的响应丢失时，按本次独有的写入标记回查已提交区块后恢复；检测到其他管理员的并发修改时停止覆盖，并报告备份路径供恢复。两个店铺以及内容与自定义模板之间不是同一个数据库事务，但受控补偿和回读保证失败有明确恢复结果。

线上导入和真实用户扫码仍须在部署后验收，离线素材校验与本地测试不能代替线上证据。
