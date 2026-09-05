export interface FeatureHelpContent {
    purpose: string;
    requirements: readonly string[];
    example: string;
    impact?: string;
}

export const featureHelpContent = {
    'sales.profit': {
        purpose: '按当前店铺、币种和下单日期核算已结算支付、退款与商品历史成本。',
        requirements: [
            '具有订单和商品经营数据查看权限',
            '成本或实际费用缺失时先补齐；历史成本估算会单独标记',
        ],
        example: '例如：实收 100、退款 10、商品成本 40、物流成本 5、手续费 2，净利润为 43。',
        impact: '只读报表；买家支付的运费已计入实收，不重复增加。退货入库不会自动冲减商品成本。',
    },
    'sales.order-expenses': {
        purpose: '记录实际物流成本和支付手续费，用于订单利润核算，也支持表格批量导入。',
        requirements: [
            '具有订单和商品经营数据修改权限',
            '订单必须属于当前店铺和指定币种',
            '无费用时明确填写 0，缺失时留空',
        ],
        example: '例如：为订单 T-1001 填入实际物流成本 5.000 和手续费 2.000。',
        impact: '只记录核算费用，不执行扣款、退款或转账；导入前核对订单号及金额。',
    },
    'profile.login-two-factor': {
        purpose: '为当前管理员登录启用验证器二次验证，并管理备用恢复码。',
        requirements: ['使用自己的验证器完成绑定', '恢复码保存在个人安全位置，不发送给他人'],
        example: '例如：绑定验证器后，使用当前动态验证码完成启用并保存恢复码。',
        impact: '影响当前账号的登录验证方式；恢复码可用于无法访问验证器时的登录恢复。',
    },
    'catalog.auto-card': {
        purpose: '为当前商品配置自动发卡 SKU，并检查该商品的库存和最近交付结果。',
        requirements: ['先选择正确 SKU', '检查交付配置与卡密库存', '已交付的卡密不要再次导入'],
        example: '例如：选择月度套餐 SKU，补充卡密后检查最近订单的交付结果。',
        impact: '保存交付配置后影响该 SKU 的自动交付；已有订单和记录继续保留。',
    },

    'dashboard.overview': {
        purpose: '汇总当前店铺的订单、销售额、客户和待办事项，用于快速判断经营状态。',
        requirements: ['已选择要查看的店铺', '当前账号具有对应数据的查看权限'],
        example: '例如：切换到默认店铺后，查看今日成交额、新增客户和待发货订单。',
        impact: '只读统计当前店铺数据，不会修改订单或商品。',
    },
    'dashboard.customizer': {
        purpose: '调整工作台组件的显示、排序和角色预设，让不同岗位优先看到需要的信息。',
        requirements: ['选择一个角色预设或手动调整组件', '完成后保存布局'],
        example: '例如：库管将“待发货”和“库存预警”移到最前面。',
        impact: '影响当前管理员的工作台布局，不修改业务数据。',
    },
    'catalog.products': {
        purpose: '集中管理商品上下架、规格变体、价格、库存和所属分类。',
        requirements: ['先确认当前店铺', '新建或编辑时完成必填信息并保存'],
        example: '例如：搜索 SKU PRO-X5，调整售价后再检查该 SKU 的可售库存。',
        impact: '保存后可影响当前店铺前台展示与下单。',
    },
    'catalog.product-editor': {
        purpose: '录入 SPU 基础信息，并配置 SKU、价格、库存、媒体、分类和扩展属性。',
        requirements: ['至少填写商品名称等必填项', '新商品需要建立至少一个可售 SKU'],
        example: '例如：创建“Codex Pro X5”，再添加月付版与年付版两个 SKU。',
        impact: '只有点击保存后才写入后端；离开前请确认未保存内容。',
    },
    'catalog.spu-core': {
        purpose: '维护商品级别的名称、描述、缩略名和启用状态，所有 SKU 共用。',
        requirements: ['商品名称不能为空', '多语言内容需在对应语言页签填写'],
        example: '例如：将中文商品名设为“Codex Pro X5”，英文名设为“Codex Pro X5”。',
        impact: '影响整个商品 SPU，不是单个 SKU。',
    },
    'catalog.product-policy': {
        purpose: '设定商品的交付类型、退款政策与人工交付时效。',
        requirements: ['先确认商品是实物还是虚拟交付', '时效以分钟填写且不得为负数'],
        example: '例如：虚拟服务设为商家审核退款，人工交付预计 1440 分钟。',
        impact: '影响该商品的结账提示、履约和售后流程。',
    },
    'catalog.product-assets': {
        purpose: '左侧设置商品主图，右侧管理商品详情图，便于区分首图与图集用途。',
        requirements: ['素材已上传到媒体库', '主图只选一张，详情图可选多张'],
        example: '例如：左侧选用白底包装图作为主图，右侧添加功能说明与尺寸图。',
        impact: '保存后影响前台商品卡片、详情页和分享图片。',
    },
    'catalog.variant-channels': {
        purpose: '指定 SKU 可在哪些店铺销售，并为各店铺维护独立价格。',
        requirements: ['先选中要编辑的 SKU', '要分配到目标店铺时需有 Channel 权限'],
        example: '例如：同一 SKU 在 默认店铺 售 99 CNY，在 Meiyijia 售 109 CNY。',
        impact: '只影响当前 SKU 在所选店铺的可售性与定价。',
    },
    'catalog.variants': {
        purpose: '为商品维护 SKU 规格、售价、库存与实物或数字交付配置。',
        requirements: ['每个 SKU 编码必须唯一', '价格和库存需使用非负数'],
        example: '例如：建立 PRO-X5-MONTHLY，填写售价后设为数字自动交付。',
        impact: '影响买家可选规格、价格、库存和履约方式。',
    },
    'catalog.sku-custom-fields': {
        purpose: '读取后端 ProductVariant 动态字段，并按当前选中的 SKU 单独保存。',
        requirements: ['先选中要修改的 SKU', '后端已配置可见扩展字段', '填写值通过字段校验后点击保存'],
        example: '例如：为 SKU PRO-X5-001 填写包装换算数量 12，默认保质期 365 天。',
        impact: '只修改当前店铺下选中的 SKU，不改动商品主图、价格或其他 SKU。',
    },
    'catalog.facets': {
        purpose: '将商品关联到 Facet 属性标签，用于前台筛选、搜索和自动分类。',
        requirements: ['后端已创建需要的 Facet 与值', '勾选或取消后确认保存结果'],
        example: '例如：给耳机关联“类型：降噪”和“颜色：黑色”。',
        impact: '修改该商品的搜索标签和可能命中的自动分类。',
    },
    'catalog.collections': {
        purpose: '把商品手动加入一个或多个商品分类，同时保留现有自动筛选规则。',
        requirements: ['目标分类已建立', '当前账号可编辑商品与分类'],
        example: '例如：将商品同时加入“AI 工具”和“本周推荐”。',
        impact: '影响商品在前台导航、集合页和自动推荐中的展示。',
    },
    'catalog.categories': {
        purpose: '管理商品分类层级、规格选项与 Facet 属性，支撑商品组织和前台筛选。',
        requirements: ['调整层级前确认父子分类关系', '修改规则后检查命中的商品'],
        example: '例如：在“数字商品”下新建“AI 订阅”子分类。',
        impact: '可影响商品归类、前台导航和筛选结果。',
    },
    'catalog.collection-rules': {
        purpose: '用条件自动判定哪些商品应进入当前集合。',
        requirements: ['先确认筛选条件之间的逻辑', '保存后检查自动匹配结果'],
        example: '例如：将带有“品牌：Codex”的商品自动收录到品牌专区。',
        impact: '修改规则会改变当前集合的自动商品成员。',
    },
    'catalog.inventory': {
        purpose: '管理各仓库的库存水位、分配、盘点调整和库存批次。',
        requirements: ['已建立仓库并绑定可售店铺', '盘点时说明调整原因'],
        example: '例如：将 SKU PRO-X5 的东京仓现货从 20 修正为 18，原因填“盘点差异”。',
        impact: '会影响可售数量、缺货判定与订单履约。',
    },
    'catalog.assets': {
        purpose: '上传、检索和管理可供商品、分类及店铺页面使用的图片与文件素材。',
        requirements: ['文件类型和大小符合上传要求', '删除前确认素材没有被业务对象引用'],
        example: '例如：上传一张 WebP 商品图，然后在商品编辑页选为主图。',
        impact: '素材被关联后可出现在多个页面；删除可造成引用失效。',
    },
    'catalog.suppliers': {
        purpose: '维护供货商资料、采购联系方式和供货关系。',
        requirements: ['供货商名称与联系方式应可核对', '关联 SKU 前确认采购单位与换算'],
        example: '例如：建立“华东电子”供货商，并关联其供应的三个 SKU。',
        impact: '影响采购、成本和供应链记录，不直接改变前台售价。',
    },
    'sales.orders': {
        purpose: '查看并处理订单的支付、发货、虚拟交付和状态流转。',
        requirements: ['确认当前店铺与筛选条件', '变更状态前核对订单号和当前状态'],
        example: '例如：筛选“待发货”订单，核对收件地址后批量创建履约。',
        impact: '操作可改变订单状态并触发履约、通知或库存变化。',
    },
    'sales.order-items': {
        purpose: '查看订单内的商品、SKU、数量、单价和分摊金额。',
        requirements: ['订单数据已加载', '需调整商品时必须进入允许修改的订单流程'],
        example: '例如：核对 PRO-X5 购买数量为 2，并查看优惠分摊后的行小计。',
        impact: '普通查看不修改数据；在改单流程中保存会重算订单金额。',
    },
    'sales.payment': {
        purpose: '查看支付交易、方式、金额与当前状态，并执行权限内的支付操作。',
        requirements: ['核对交易号和金额', '退款或状态操作需有对应权限'],
        example: '例如：确认一笔支付已结算，再根据售后结果发起部分退款。',
        impact: '可影响订单已付金额、支付状态和对账记录。',
    },
    'sales.fulfillment': {
        purpose: '管理发货或数字交付批次，包括履约方式、物流号与交付状态。',
        requirements: ['已确认可履约数量', '实物发货时填写可追踪的物流信息'],
        example: '例如：选择两件商品，用顺丰创建发货并录入运单号。',
        impact: '可变更订单履约状态并向买家展示交付进度。',
    },
    'sales.totals': {
        purpose: '汇总商品、配送、优惠、税费、退款与应付金额。',
        requirements: ['订单价格计算已完成', '改单后需确认重算结果'],
        example: '例如：查看商品小计 200 元、优惠 20 元、运费 10 元，应付 190 元。',
        impact: '本区域主要用于核对；上游商品、优惠或配送变更会使结果重算。',
    },
    'sales.after-sales': {
        purpose: '处理退款、退货、补发和售后协商，并记录完整处理结论。',
        requirements: ['先核对订单、买家诉求和涉及商品', '提交前确认金额与处理方式'],
        example: '例如：核实一件破损商品后，选择部分退款并写明处理说明。',
        impact: '可影响支付、库存、订单状态与买家通知。',
    },
    'sales.card-pool': {
        purpose: '跨商品查看发卡记录和交付异常；具体 SKU 的交付与库存配置在商品编辑页完成。',
        requirements: ['SKU 已配置为自动发卡', '导入前检查卡密格式和重复项'],
        example: '例如：筛选交付失败记录，再进入对应商品检查卡密库存。',
        impact: '会影响虚拟商品能否自动交付；已交付卡密应视为敏感数据。',
    },
    'customers.management': {
        purpose: '检索客户，查看资料、地址、订单、标签和所属店铺。',
        requirements: ['按名称、手机或邮箱搜索', '修改资料前核对客户身份'],
        example: '例如：用邮箱找到客户，查看其历史有效订单金额和最近收货地址。',
        impact: '资料修改可影响客户登录、通知和后续订单信息。',
    },
    'marketing.promotions': {
        purpose: '管理优惠券、限时活动、通用促销规则及效果数据。',
        requirements: ['设定有效期、适用范围和优惠条件', '上线前用测试订单核对规则'],
        example: '例如：创建满 200 减 20 的优惠券，限默认店铺且每人使用一次。',
        impact: '启用后会影响结账价格、活动成本和订单统计。',
    },
    'marketing.coupon-report': {
        purpose: '统计优惠券的领取、核销、退款、优惠成本和带动成交。',
        requirements: ['选择统计时间范围', '对比时保持店铺与币种口径一致'],
        example: '例如：统计本月优惠券带来的成交额，并与优惠成本对比。',
        impact: '只读统计当前筛选范围，不修改促销规则。',
    },
    'marketing.coupon-ledger': {
        purpose: '追踪每张优惠券从领取、锁定、核销到退款或作废的完整流水。',
        requirements: ['按优惠码、客户或订单筛选', '核对事件时间与状态转换'],
        example: '例如：查询 SAVE20 在订单 ORD-1008 中从锁定到核销的记录。',
        impact: '只读审计数据，用于客诉、对账和异常排查。',
    },
    'marketing.sku-sale-prices': {
        purpose: '在统一折扣之外，为选中的 SKU 单独设定秒杀价。',
        requirements: ['先选择参与活动的商品', '秒杀价必须低于原价'],
        example: '例如：商品统一八折，但将 PRO-X5-YEARLY 单独设为 699 元。',
        impact: '只覆盖已填写的 SKU；留空的 SKU 仍按统一比例计算。',
    },
    'marketing.generic-promotions': {
        purpose: '直接配置 Vendure 的促销条件与优惠动作，用于覆盖更通用的营销规则。',
        requirements: ['了解每个条件和动作的参数', '启用前使用测试订单验证组合规则'],
        example: '例如：限定指定客群满 300 元后免运费。',
        impact: '启用后直接参与订单价格计算。',
    },
    'marketing.referrals': {
        purpose: '管理邀请关系、返利规则、推广海报和佣金提现。',
        requirements: ['确认返利比例、结算条件和退款处理', '上线前预览买家端推广素材'],
        example: '例如：设定邀请人获得实付金额 5% 返利，并配置店铺海报。',
        impact: '会影响佣金计算、用户余额和提现审核。',
    },
    'marketing.referral-rules': {
        purpose: '设定邀请人与被邀请人的奖励、结算和有效性规则。',
        requirements: ['明确计算基数与比例', '确认退款、取消和风控时的处理'],
        example: '例如：订单完成 7 天后结算 5% 佣金，退款则冲销。',
        impact: '影响后续返利计算与可提现金额。',
    },
    'marketing.poster-templates': {
        purpose: '选择系统海报或管理店铺自定义海报，用于生成分享素材。',
        requirements: ['海报图尺寸与可读性符合移动端要求', '自定义素材需先上传'],
        example: '例如：用品牌色海报生成带邀请二维码的分享图。',
        impact: '影响新生成的推广图样式，不改动已保存的历史图片。',
    },
    'storefront.decoration': {
        purpose: '编排商城首页楼层、启用状态和每个模块的展示内容。',
        requirements: ['先选择要配置的店铺', '保存前在桌面和移动预览中核对'],
        example: '例如：将轮播图移到第一层，在其下方放置“本周推荐”商品楼层。',
        impact: '发布后会改变当前店铺首页的模块顺序与显示。',
    },
    'storefront.floor-order': {
        purpose: '调整已配置楼层的排序、启用状态和编辑入口。',
        requirements: ['至少已添加一个楼层', '调整后点击保存首页'],
        example: '例如：将“限时秒杀”移到“新品推荐”之前并启用。',
        impact: '影响当前店铺首页楼层顺序和可见性。',
    },
    'storefront.available-blocks': {
        purpose: '展示可添加到首页的内容模块类型。',
        requirements: ['了解模块需要的图片、文案或商品数据', '添加后完成模块设置'],
        example: '例如：添加“商品列表”模块，再选择要展示的集合。',
        impact: '添加后仅进入当前编辑草稿，完成保存后才生效。',
    },
    'storefront.structure-preview': {
        purpose: '按当前草稿快速预览首页楼层结构，检查顺序和显隐。',
        requirements: ['已加载当前店铺的楼层数据', '精确样式仍需到真实前台验收'],
        example: '例如：预览中确认轮播图、入口宫格和商品楼层的先后顺序。',
        impact: '预览本身不保存、不发布。',
    },
    'storefront.block-basic': {
        purpose: '编辑当前楼层模块的名称、类型和基础识别信息。',
        requirements: ['模块标识保持唯一', '类型确定后再填写其他内容'],
        example: '例如：将模块命名为 weekly-picks，类型选择商品列表。',
        impact: '影响当前模块的识别与渲染方式。',
    },
    'storefront.block-copy': {
        purpose: '维护楼层模块在各语言下的标题、副标题和按钮文案。',
        requirements: ['在每个需要的语言页签中填写', '文案长度适合移动端'],
        example: '例如：中文标题填“本周推荐”，英文填“Weekly Picks”。',
        impact: '影响当前模块在对应语言前台中的文案。',
    },
    'storefront.block-visuals': {
        purpose: '配置模块图片、色彩和点击后的跳转目标。',
        requirements: ['图片素材已上传', '跳转地址为允许的站内路径或完整安全链接'],
        example: '例如：选择活动横幅图，按钮跳转到 /collections/sale。',
        impact: '影响当前模块的外观和前台点击去向。',
    },
    'storefront.block-rules': {
        purpose: '限定模块在哪些时间、设备或用户条件下显示。',
        requirements: ['开始与结束时间使用同一时区口径', '组合条件后检查是否过度限制'],
        example: '例如：秒杀楼层仅在 9 月 1 日至 9 月 3 日向移动端显示。',
        impact: '会改变模块的前台可见人群和时段。',
    },
    'storefront.content': {
        purpose: '管理固定页面文案、系统公告和营销落地页内容。',
        requirements: ['先选择店铺与内容类型', '发布前检查多语言、链接和预览'],
        example: '例如：更新售后政策页，同时在全站公告中提醒生效日期。',
        impact: '保存或发布后可影响前台对应页面与公告。',
    },
    'storefront.fixed-content': {
        purpose: '维护具有稳定业务编码的店铺页面文案。',
        requirements: ['选择要编辑的固定内容项', '各语言版本完整且链接可用'],
        example: '例如：更新“关于我们”和“退款政策”中英文文案。',
        impact: '只影响当前店铺对应固定页面。',
    },
    'storefront.announcements': {
        purpose: '发布全站系统公告，并控制状态、顺序和有效时间。',
        requirements: ['填写清晰标题和内容', '定时公告需核对时区与开始结束时间'],
        example: '例如：发布“9 月 5 日 02:00–04:00 系统维护”公告。',
        impact: '启用后可在当前店铺前台全站显示。',
    },
    'storefront.landing-source': {
        purpose: '编辑营销落地页的 HTML 或结构化源码，并通过安全预览检查效果。',
        requirements: ['仅使用受支持的标签和资源', '不写入密钥、用户数据或不可控脚本'],
        example: '例如：编辑新品活动的标题、卖点和站内购买按钮。',
        impact: '发布后影响当前店铺的营销落地页；需特别注意内容安全。',
    },
    'storefront.safe-preview': {
        purpose: '在隔离的预览区中查看落地页内容，降低未信任代码影响后台的风险。',
        requirements: ['先生成或刷新预览', '预览通过不代表线上已发布'],
        example: '例如：保存前检查活动页标题、图片和购买链接是否正常。',
        impact: '仅预览当前草稿，不会写入前台。',
    },
    'storefront.reviews': {
        purpose: '查看、筛选并审核买家评价与图片，处理展示状态。',
        requirements: ['核对评价对应的商品和订单', '隐藏或拒绝时记录合理原因'],
        example: '例如：筛选待审核图文评价，通过真实且无敏感信息的内容。',
        impact: '审核状态会决定评价是否在前台展示。',
    },
    'storefront.business-copy': {
        purpose: '维护商务服务页顶部文案，并在右侧预览前台效果。',
        requirements: ['中英文内容与当前店铺品牌一致', '保存前检查移动端换行'],
        example: '例如：修改服务页标题、说明和 CTA 按钮文案。',
        impact: '保存后影响当前店铺商务服务页。',
    },
    'plugins.client-center': {
        purpose: '查看可用客户端插件，并管理已添加插件的启用与配置。',
        requirements: ['了解插件所需权限与配置', '启用前在测试环境检查客户端兼容性'],
        example: '例如：添加一个统计插件，填写公开配置后在前台验证。',
        impact: '启用的插件可影响客户端加载、隐私与性能。',
    },
    'plugins.platform': {
        purpose: '列出系统提供、可添加到客户端的插件。',
        requirements: ['先查看插件用途、版本和所需配置', '确认它与当前客户端兼容'],
        example: '例如：从平台插件中选择一个分析插件加入店铺。',
        impact: '仅添加后还不一定生效，需完成配置并启用。',
    },
    'plugins.installed': {
        purpose: '管理已加入当前客户端的插件及其配置。',
        requirements: ['修改前记录现有配置', '移除前确认无业务页面依赖'],
        example: '例如：暂停故障统计插件，保留配置以便恢复。',
        impact: '修改可影响客户端功能、性能或数据收集。',
    },
    'plugins.ai-settings': {
        purpose: '配置 AI 生图服务的提供商、模型、定价、开关和使用条款。',
        requirements: ['服务商访问凭据由服务端安全配置', '定价与条款经运营审核'],
        example: '例如：启用一个图像模型，设定单张价格并更新买家免责声明。',
        impact: '会影响买家能否使用生图、选用模型和支付金额。',
    },
    'plugins.ai-access': {
        purpose: '管理 AI 服务商访问配置的状态、范围和测试结果。',
        requirements: ['密钥仅在受保护的服务端表单中录入', '启用前执行连通性测试'],
        example: '例如：更新某生图服务商密钥后，测试成功再启用。',
        impact: '错误配置会使 AI 任务失败；说明中不会显示任何密钥值。',
    },
    'plugins.two-factor': {
        purpose: '安全保存并快速查询管理用的 TOTP 二次验证码账号。',
        requirements: ['仅录入经授权的账号', '批量导入前检查重复项与密文保护'],
        example: '例如：搜索“AWS 生产”并复制当前 30 秒有效的验证码。',
        impact: '涉及敏感认证信息，只应授予必需人员。',
    },
    'settings.store-profile': {
        purpose: '管理店铺基本资料、经营模式、独立域名、卖家与 Channel 关系。',
        requirements: ['选中要修改的店铺', '域名、币种与经营模式变更前评估前台影响'],
        example: '例如：为新店铺设置中文名、CNY 币种和 shop.example.com 域名。',
        impact: '可影响当前店铺的前台访问、价格显示和数据隔离。',
    },
    'settings.commerce-mode': {
        purpose: '设定当前店铺使用自营商城还是多卖家经营模式。',
        requirements: ['确认现有商品、订单与卖家结构', '变更前做业务影响评估'],
        example: '例如：单品牌店使用自营模式，平台入驻场景使用多卖家模式。',
        impact: '这是高影响设置，可改变商品、订单和权限的归属逻辑。',
    },
    'settings.payment-shipping': {
        purpose: '配置店铺可用的支付方式、配送方式与适用条件。',
        requirements: ['支付凭据使用服务端安全配置', '配送试算通过后再向买家开放'],
        example: '例如：启用银行转账，并配置满 199 元免运费的配送方式。',
        impact: '会改变买家结账时可选的支付和配送方案。',
    },
    'settings.finance': {
        purpose: '管理结算、费率、账期和店铺财务口径。',
        requirements: ['确认币种、税费和结算周期', '费率变更需经财务或运营审核'],
        example: '例如：设定每月结算，并配置平台服务费比例。',
        impact: '可影响账单、对账与店铺结算金额。',
    },
    'settings.team': {
        purpose: '管理后台员工、角色、权限与可访问店铺范围。',
        requirements: ['遵循最小权限原则', '禁用账号前确认其没有未完成任务'],
        example: '例如：为库管授予商品和库存权限，不授予支付退款权限。',
        impact: '权限变更会立即影响员工能看到和执行的后台功能。',
    },
    'settings.translations': {
        purpose: '审计多语言字段的缺失、回退和翻译完整度。',
        requirements: ['选择目标语言与内容范围', '保存前由懂目标语言的人员复核'],
        example: '例如：查找商品英文描述的缺失项，补齐后重新审计。',
        impact: '修改后影响对应语言前台的文案。',
    },
    'settings.telegram': {
        purpose: '配置 Telegram 连接、通知规则、部门路由并查看发送记录。',
        requirements: ['机器人凭据在服务端安全配置', '测试消息确认目标群组与路由正确'],
        example: '例如：将待发货告警路由到履约群，再发送一条测试通知。',
        impact: '可影响运营告警的接收人与时效，不在说明中展示凭据。',
    },
    'settings.system-ops': {
        purpose: '查看服务健康、任务记录，并管理调度、动态配置和 API 密钥。',
        requirements: ['具有运维管理权限', '写操作前确认目标环境与影响范围'],
        example: '例如：查看失败的定时任务，核对错误后再决定是否重试。',
        impact: '包含高影响运维功能；修改调度、配置或密钥可影响整个服务。',
    },
    'settings.service-checks': {
        purpose: '实时检查管理 API、任务队列和相关服务的可用性。',
        requirements: ['后台可访问目标服务', '结果需结合日志与业务验收判断'],
        example: '例如：发现队列检查异常后，再查看任务执行记录定位失败原因。',
        impact: '健康结果仅代表当前检测，不等于所有业务已正常。',
    },
    'settings.job-runs': {
        purpose: '查看后台任务的执行时间、状态、耗时和错误摘要。',
        requirements: ['根据任务名与时间范围筛选', '重试前确认任务是否幂等'],
        example: '例如：查找今天失败的媒体同步任务，打开详情查看错误。',
        impact: '查看为只读；若提供重试操作，可重新触发对应业务。',
    },
    'settings.schedules': {
        purpose: '管理周期性任务的启停、计划表达式与执行状态。',
        requirements: ['核对执行时区与频率', '启用前确认任务可重入且不会重复产生数据'],
        example: '例如：设置每天 03:00 执行库存报表任务。',
        impact: '启停或改频率会影响后台自动任务的实际执行。',
    },
    'settings.dynamic-config': {
        purpose: '查看并修改可在运行时生效的系统配置项。',
        requirements: ['了解配置键的数据类型与默认值', '修改前记录原值并准备回滚'],
        example: '例如：将一个功能开关从关闭调整为灰度开启，再检查监控。',
        impact: '可无需重新构建即影响运行中服务，属于高影响操作。',
    },
    'settings.api-keys': {
        purpose: '创建、禁用和轮换供程序调用的 API 访问凭据。',
        requirements: ['按最小权限和最小店铺范围授权', '新凭据仅在安全位置保存一次'],
        example: '例如：为库存同步程序创建只读商品和库存的密钥。',
        impact: '泄露的凭据可造成未授权访问；禁用会立即中断依赖它的集成。',
    },
    'settings.usdt': {
        purpose: '配置 USDT 收款钱包、网络、报价汇率，并管理人工退款记录。',
        requirements: ['核对链类型、钱包地址和汇率来源', '退款前二次核对地址、币种与金额'],
        example: '例如：配置 TRON 网络收款地址，并设定报价的有效时间。',
        impact: '会影响买家支付指引和财务对账；链上转账不可撤销。',
    },
    'profile.basic': {
        purpose: '修改当前管理员的姓名、联系方式等基本资料。',
        requirements: ['当前会话有效', '邮箱或手机变更需按系统校验填写'],
        example: '例如：更新显示姓名和工作联系邮箱。',
        impact: '只影响当前管理员资料。',
    },
    'profile.password': {
        purpose: '修改当前管理员的登录密码。',
        requirements: ['输入正确的当前密码', '新密码符合强度要求且两次一致'],
        example: '例如：在凭据疑似泄露后立即更换密码并重新登录。',
        impact: '可使现有会话失效；不会在说明中记录或复制密码。',
    },
    'profile.account-status': {
        purpose: '查看当前管理员账号的启用状态和基础安全信息。',
        requirements: ['当前会话已通过认证'],
        example: '例如：核对账号是否已验证且未被禁用。',
        impact: '本区域主要用于只读查看。',
    },
    'profile.authentication': {
        purpose: '查看当前账号使用的登录与身份验证方式。',
        requirements: ['查看敏感认证信息时注意屏幕和共享环境'],
        example: '例如：确认账号使用本地密码登录还是外部身份提供方。',
        impact: '只读显示认证方式，不展示凭据明文。',
    },
    'profile.scope': {
        purpose: '查看当前管理员的角色、权限和可访问店铺范围。',
        requirements: ['如需变更，由具备员工管理权限的管理员处理'],
        example: '例如：确认库管角色只能访问 默认店铺 店铺的库存功能。',
        impact: '本页只读；权限变更需在员工与权限页完成。',
    },
} as const satisfies Record<string, FeatureHelpContent>;

export type FeatureHelpTopic = keyof typeof featureHelpContent;

export function featureHelpCopyText(title: string, content: FeatureHelpContent): string {
    const sections = [
        `${title}\n\n这个功能做什么\n${content.purpose}`,
        `使用要求\n${content.requirements.map(item => `• ${item}`).join('\n')}`,
        `举例\n${content.example}`,
    ];

    if (content.impact) sections.push(`影响范围\n${content.impact}`);
    return sections.join('\n\n');
}
