# 马来西亚入境卡自动提交（MDAC）

基线：`main@304d01f6`（origin/main 最新，含 FlightByte 航班核验与旅客核对改版）。
本分支工作副本 `E:\源码文件夹\购物网站\damatong-mdac-release`；`damatong-mdac` 是旧副本，未改动。

客户在店铺页填完、确认后，由店铺后端把每位旅客的资料提交到移民局登记页
`https://imigresen-online.imi.gov.my/mdac/register`，并把官方回执取回给客户。

## 官方流程实况（2026-11-28 实测）

移民局没有公开 API，登记页是 JSP 表单，提交链路的真实约束如下：

| 环节           | 实测结果                                                                                                                                                                                                                                        |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 表单 `action`  | `POST /mdac/register`（URL 带 `jsessionid`）                                                                                                                                                                                                    |
| 字段名         | `name passNo nationality pob dob sex passExpDte email confirmEmail region mobile arrDt depDt vesselNm trvlMode embark accommodationStay accommodationAddress1 accommodationAddress2 accommodationState accommodationPostcode accommodationCity` |
| 日期格式       | `DD/MM/YYYY`，输入框 `readonly`，由 bootstrap-datepicker 驱动                                                                                                                                                                                   |
| 城市           | `GET /mdac/register?retrieveRefCity&state=<code>`，选项值是数字编码（`1401`＝KUALA LUMPUR），必须按显示名匹配                                                                                                                                   |
| 邮编           | 选城市后由 `retrievePostcode` 自动写入，可覆盖为旅客实际邮编                                                                                                                                                                                    |
| 人机校验       | 自绘拼图滑块（`longbow.slidercaptcha`），目标 `x` 随机，滑到 `x±5` 内即通过                                                                                                                                                                     |
| 滑块服务端校验 | `POST /mdac/captcha`，`datas` 为拖动轨迹，任何轨迹都返回 `{"success":true}`                                                                                                                                                                     |
| 反自动化字段   | 隐藏域 `_sourcePage`、`__fp`，由页面每次加载生成，必须原样回传                                                                                                                                                                                  |
| 填报窗口       | 抵达前 3 天内；更早的资料在本地排队，窗口开启后自动提交                                                                                                                                                                                         |
| 一护照一次     | 同一 `passNo + 抵达日` 只保留一条任务，重复提交直接返回原任务                                                                                                                                                                                   |

滑块的拖动距离与拼图位移不成正比，库内换算是
`blockLeft = (width - 60) / (width - 40) * moveX`，所以驱动按该系数反算拖动像素；
一次没落到容差内时，失败态会锁住滑块约 1 秒，下一轮重试。

## 结构

```
packages/storefront-content-plugin/src/mdac-submission/
  mdac-submission.types.ts     官方字段、格式校验、窗口计算
  mdac-submission.store.ts     目录队列（任务 JSON + 回执 PDF + 独占锁）
  mdac-submitter.ts            Playwright 驱动：填表 → 滑块 → 提交 → 取回执
  mdac-submission.service.ts   入队、去重、worker 循环、结果落库
  mdac-submission.resolver.ts  shop API：createMdacSubmission / mdacSubmission / mdacSubmissionReceipt
packages/storefront/src/client-plugins/mdac/
  mdac-submission.ts           前端 GraphQL 调用与本地回执指针
  submit-panel.tsx             核对页的「提交入境卡」面板：逐位提交、进度、回执下载
packages/next-admin/src/pages/Plugins/
  MdacSubmissionsModule.tsx    管理后台「入境卡提交」队列：筛查、重新提交、终止
  mdac-submissions.graphql.ts  队列查询与两个写入文档
```

后台入口：`客户端插件` 分区下的「入境卡提交」（`/plugins/mdac-submissions`，SuperAdmin）。
它读取 `mdacSubmissions`，只允许对 `FAILED`/`MANUAL` 重新排队、对 `QUEUED`/`RUNNING` 终止；
两个写入分别命中 `admin-resource-events.ts` 的 `plugins` 资源域。

任务状态：`QUEUED → RUNNING → DONE | FAILED | MANUAL`。

- `DONE`：拿到官方 PIN／回执号，回执 PDF 存到任务目录，客户可下载。
- `MANUAL`：官方返回的页面无法识别为受理结果（或 dry run 停在这里），保留截图待人工确认。
- `FAILED`：官方校验拒绝（资料问题，不重试）或超出重试预算。
- 验证码、网络类失败按 90s / 5m / 15m / 1h 退避，最多 5 次。

## 开关

见 `deploy/mdac.env.example`：

| 变量                                 | 作用                                                        |
| ------------------------------------ | ----------------------------------------------------------- |
| `STOREFRONT_MDAC_ALLOWED_DOMAIN`     | 只有该域名的 ACTIVE 店铺能启用入境卡插件（沿用原策略）      |
| `STOREFRONT_MDAC_SUBMIT_ENABLED`     | `true` 才启动 worker 并允许建单                             |
| `STOREFRONT_MDAC_SUBMIT_DRY_RUN`     | `true` 只填表并解滑块，不点提交                             |
| `STOREFRONT_MDAC_SUBMIT_DIR`         | 任务与回执目录                                              |
| `STOREFRONT_MDAC_SUBMIT_PROXY`       | 出站代理，避免单 IP 高频                                    |
| `STOREFRONT_MDAC_SUBMIT_CHANNEL`     | `chrome` 时使用系统 Chrome，留空用 Playwright 自带 Chromium |
| `STOREFRONT_MDAC_SUBMIT_HEADLESS`    | `false` 时开窗调试                                          |
| `STOREFRONT_MDAC_SUBMIT_INTERVAL_MS` | 轮询间隔，默认 20s                                          |

未开 `STOREFRONT_MDAC_SUBMIT_ENABLED` 时，面板仍显示，点提交会得到
「自动提交服务尚未启用」，客户可走下方官方入口手动填写。

运行环境需要 Playwright 与 Chromium：

```bash
bun add -d playwright          # 或复用仓库根依赖
bunx playwright install chromium
```

## 上线前验证顺序

1. 构建后端插件：`tsc -p tsconfig.build.json`。
2. 拿一位真实旅客生成 payload JSON（字段名与表单一一致），先跑干跑：

    ```bash
    STOREFRONT_MDAC_SUBMIT_CHANNEL=chrome \
    node scripts/mdac-submit.mjs --payload traveler.json
    ```

    看输出的 `slider verified on round …` 与 `mdac-last-run.jpg`：
    姓名、护照、日期、航班、州属／城市／邮编必须与 payload 一致。

3. 同一 payload 加 `--submit` 真提一次（**这会真的产生一条入境卡**，请用真实旅客在窗口内执行）。
   成功后回执写入 `mdac-receipt.pdf`，终端会打印 `referenceNo` 与 `pin`。
4. 官方回执页若与识别规则不符，日志会给出 `MANUAL … not recognised`，
   按截图补 `mdac-submitter.ts` 里的受理页判定，再重复第 3 步。
5. 打开店铺环境变量，走店铺页面完整流程：填表 → 核对 → 勾选 → 提交 → 看到回执号与下载按钮。

## 现状与限制

- 表单填写、滑块求解、字段联动已在真实页面上验证（干跑截图逐字段核对）。
- 受理成功页的标记（PIN、回执链接）按官方历史页面结构实现，尚未用真实回执验证；
  识别不到时一律落到 `MANUAL` 并保留截图，不会把失败报成成功。
- 任务目录是单机队列（独占锁 + 原子改名），适用于当前单实例后端；
  多实例部署需要把队列换成共享存储。
- 官方改版只影响 `mdac-submitter.ts` 的选择器与判定，队列、接口、前端不受影响。
