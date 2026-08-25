#!/usr/bin/env node
/* global process */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parsePOFile } from './locale-profiles.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const poFile = path.resolve(__dirname, '../../src/i18n/locales/zh_Hans.po');

const exactTranslations = new Map([
    ['Are you sure you want to delete {0} {entityName}?', '确定要删除 {0} 个{entityName}吗？'],
    ['123 Main St', '中山路 123 号'],
    ['Blockquote', '引用块'],
    ['Bold', '粗体'],
    ['Bullet List', '无序列表'],
    ['Digital delivery', '电子交付'],
    ['DD/MM/YYYY HH:mm', 'YYYY年MM月DD日 HH:mm'],
    ['Details and configuration', '详情与配置'],
    ['Enter ID', '输入 ID'],
    ['Field guidance', '字段说明'],
    ['Italic', '斜体'],
    ['Link', '链接'],
    ['List and bulk actions', '列表与批量操作'],
    ['Ordered List', '有序列表'],
    ['Redo', '重做'],
    ['Recommended workflow', '建议操作顺序'],
    ['Run pending updates', '执行待处理更新'],
    ['Running pending search index updates', '正在执行待处理的搜索索引更新'],
    ['Search collections...', '搜索商品分组...'],
    ['Search coupon codes...', '搜索优惠码...'],
    ['Strikethrough', '删除线'],
    ['Table', '表格'],
    ['Practical tips', '实用提示'],
    ['Confirm before continuing', '操作前请确认'],
    ['Undo', '撤销'],
    ['Unknown customer activity', '未知客户动态'],
    ['Unknown order activity', '未知订单动态'],
    ['View field guidance', '查看字段说明'],
    ['View fulfillment details', '查看履约详情'],
    ['View JSON data', '查看 JSON 数据'],
    ['View operation guide', '查看操作说明'],
    ['{data} pending search index updates', '{data} 项搜索索引更新待处理'],
    ['A view with this name already exists', '已存在同名视图'],
    ['API Keys', 'API 密钥'],
    ['Configuration item', '配置项'],
    ['Current value', '当前值'],
    ['Effective scope', '生效范围'],
    ['Retry', '重试'],
    ['Scheduled task', '计划任务'],
    ['The data could not be loaded. Try again.', '数据加载失败，请重试。'],
    ['Unable to load records', '无法加载记录'],
    ['You do not have permission to view these records.', '您没有权限查看这些记录。'],
    ['View configuration content', '查看配置内容'],
    ['An error occurred: {0}', '发生错误：{0}'],
    [
        'Are you sure you want to remove 1 country/region from this zone?',
        '确定要从此业务区域移除 1 个国家/地区吗？',
    ],
    [
        'Are you sure you want to remove {countryCount} countries/regions from this zone?',
        '确定要从此业务区域移除 {countryCount} 个国家/地区吗？',
    ],
    ['Assets', '素材库'],
    ['Asset', '素材'],
    ['Bulk actions', '批量操作'],
    ['Change status', '更改状态'],
    ['Change sort order', '切换排序方式'],
    ['Browse and select an asset', '浏览并选择一个素材'],
    ['Browse and select one or more assets', '浏览并选择一个或多个素材'],
    ['Default billing address', '默认账单地址'],
    ['Default shipping address', '默认收货地址'],
    ['Done', '完成'],
    ['Deleted {deleted} {entityName}', '{entityName}已删除：{deleted} 个'],
    ['Duplicate {entityName}', '复制{entityName}'],
    ['Configure duplication settings for {entityName}', '配置{entityName}的复制方式'],
    ['Copy ID', '复制 ID'],
    ['Copy to clipboard', '复制到剪贴板'],
    ['Enter comma-separated IDs...', '输入多个 ID，并用英文逗号分隔...'],
    ['Enter comma-separated values...', '输入多个值，并用英文逗号分隔...'],
    ['Enter filter value...', '输入筛选值...'],
    ['Entity information', '实体信息'],
    ['Enter ID...', '输入 ID...'],
    ['Enter a name for this view', '输入视图名称'],
    ['Enter value...', '输入数值...'],
    ['Explore Platform & Cloud', '了解 Vendure 平台与云服务'],
    ['Failed to save view', '保存视图失败'],
    ['Failed to delete {failed} {entityName}', '删除 {failed} 个{entityName}失败'],
    ['Failed to delete {failed} {entityName}: {allErrors}', '删除 {failed} 个{entityName}失败：{allErrors}'],
    ['Failed to duplicate {0} {entityName}: {errorMessage}', '复制 {0} 个{entityName}失败：{errorMessage}'],
    ['{remainingErrorCount} more errors', '另有 {remainingErrorCount} 条错误'],
    ['Failed to update', '更新失败'],
    ['Global view (visible to all users)', '公共视图（所有后台用户可见）'],
    ['Global', '全局'],
    ['Maximum', '最大值'],
    ['More actions', '更多操作'],
    ['Minimum', '最小值'],
    ['Minimum value must be less than maximum value', '最小值必须小于最大值'],
    ['Personal view (only visible to you)', '个人视图（仅自己可见）'],
    ['Please enter a name for the view', '请输入视图名称'],
    ['Please enter a valid number', '请输入有效数值'],
    ['Please enter both minimum and maximum values', '请同时输入最小值和最大值'],
    ['Please enter both start and end dates', '请同时输入开始时间和结束时间'],
    ['Please enter valid numbers', '请输入有效数值'],
    ['Please wait', '请稍候'],
    ['Save current view', '保存当前视图'],
    [
        'Save the current filters and search term as a reusable view.',
        '保存当前筛选条件和搜索词，方便以后直接复用。',
    ],
    ['Save view', '保存视图'],
    ['Scroll tabs left', '向左滚动标签页'],
    ['Scroll tabs right', '向右滚动标签页'],
    ['Select a currency', '选择币种'],
    ['Select all rows', '选择全部行'],
    ['Select a language', '选择语言'],
    ['Select a locale', '选择地区格式'],
    ['Select 1 asset', '选择 1 个素材'],
    ['Select assets', '选择素材'],
    ['Select options', '选择选项'],
    ['Select products', '选择商品'],
    ['Select row', '选择当前行'],
    ['Select variants', '选择商品 SKU'],
    ['Change selected products', '更改已选商品'],
    ['Change selected variants', '更改已选商品 SKU'],
    ['Drag {item}', '拖动 {item}'],
    ['Remove {item}', '移除 {item}'],
    ['Select {0} assets', '选择 {0} 个素材'],
    ['Search and select product variants from the catalog', '从商品目录中搜索并选择商品 SKU'],
    ['Search and select products from the catalog', '从商品目录中搜索并选择商品'],
    ['Start date must be before end date', '开始时间必须早于结束时间'],
    ['Channel Languages', '店铺内容语言'],
    ['Channels', '店铺'],
    ['Channel', '店铺'],
    ['Default channel', '默认店铺'],
    ['Add store', '添加店铺'],
    ['API request header', 'API 请求头'],
    ['Catalog prices include tax', '商品价格已含税'],
    ['Complete the required information before creating the store.', '创建店铺前，请完成以下必填配置。'],
    ['Copy store token', '复制店铺令牌'],
    ['Could not create store', '创建店铺失败'],
    ['Could not update store', '更新店铺失败'],
    ['Create store', '新建店铺'],
    ['Current store', '当前店铺'],
    ['Current store: {0}', '当前店铺：{0}'],
    ['Currently managing', '当前正在管理'],
    ['Currency and content language', '货币与内容语言'],
    ['Default content language', '默认内容语言'],
    ['Default delivery region', '默认配送区域'],
    ['Default tax region', '默认税务区域'],
    ['Delivery and tax', '配送与税务'],
    ['Delivery and tax regions', '配送与税务区域'],
    ['Domain binding happens in the storefront', '域名绑定在商城前台完成'],
    ['Enter a store token first', '请先填写店铺令牌'],
    ['Manage which stores can sell this product.', '设置哪些店铺可以销售此商品。'],
    ['Managed stores', '可管理店铺'],
    [
        'Map each domain to a store token in the storefront or gateway configuration.',
        '请在商城前台或网关配置中，将每个域名映射到对应的店铺令牌。',
    ],
    ['Market and content defaults', '市场与内容默认设置'],
    ['Operating entity', '经营主体'],
    [
        'Optional. Use this when the store belongs to a specific merchant.',
        '选填。当店铺属于特定商家时进行关联。',
    ],
    ['Published stores', '销售店铺'],
    [
        'Select the languages that editors can maintain for this store.',
        '选择运营人员可以为该店铺维护的内容语言。',
    ],
    [
        'Set the default service regions and how catalog prices handle tax.',
        '设置默认服务区域，以及商品价格的含税方式。',
    ],
    ['Set the internal identity used to distinguish this store.', '设置用于区分店铺的内部标识。'],
    ['Settlement currency', '结算货币'],
    ['Store API token', '店铺 API 令牌'],
    ['Store API token copied', '店铺 API 令牌已复制'],
    ['Store code', '店铺编码'],
    ['Store created', '店铺已创建'],
    ['Store ID: {0}', '店铺 ID：{0}'],
    ['Store identity', '店铺标识'],
    ['Store name', '店铺名称'],
    ['Store settings updated', '店铺设置已更新'],
    ['Store setup', '店铺配置进度'],
    ['Stores', '店铺'],
    ['Storefront connection', '商城前台接入'],
    ['Supported content languages', '支持的内容语言'],
    ['Supported currencies', '支持的货币'],
    ['Switch store', '切换店铺'],
    [
        'The storefront sends this token with API requests to select this store.',
        '商城前台通过 API 请求携带此令牌来指定店铺。',
    ],
    [
        'These defaults apply when the storefront does not specify a language or currency.',
        '商城前台未指定语言或货币时，将使用以下默认设置。',
    ],
    [
        'This role can only view and manage data for the selected stores.',
        '该角色只能查看和管理所选店铺的数据。',
    ],
    ['Use a stable short code, such as cn-mainland.', '请使用稳定的短编码，例如 cn-mainland。'],
    ['Use the store token to connect a domain or storefront.', '使用店铺令牌连接独立域名或商城前台。'],
    [
        'When enabled, prices entered for this store already include tax for the default tax region.',
        '开启后，该店铺录入的商品价格已包含默认税务区域的税费。',
    ],
    ['Collections', '商品分组'],
    ['Completed', '已完成'],
    ['Commerce Admin', '电商管理后台'],
    ['Custom', '自定义'],
    ['Facet', '筛选属性'],
    ['Facets', '筛选属性'],
    ['Facet Values', '筛选属性值'],
    ['Facet values', '筛选属性值'],
    ['Fulfill order', '执行订单履约'],
    ['Failed to fulfill order', '订单履约失败'],
    ['Failed', '执行失败'],
    ['Fulfilling...', '正在处理履约...'],
    ['Job Queue', '后台任务'],
    ['Job status', '任务状态'],
    ['Task type', '任务类型'],
    ['Unknown status', '未知状态'],
    ['Successfully duplicated {count} {entityName}', '已复制 {count} 个{entityName}'],
    [
        'No duplicator found with code "{duplicatorCode}" for {entityName}',
        '未找到适用于{entityName}的复制器“{duplicatorCode}”',
    ],
    ['New Administrator', '新建后台用户'],
    ['New asset', '新建素材'],
    ['New channel', '新建店铺'],
    ['New Channel', '新建店铺'],
    ['New Collection', '新建商品分组'],
    ['New collection', '新建商品分组'],
    ['Payment handler', '支付处理器'],
    ['Pending', '等待执行'],
    ['Retrying', '正在重试'],
    ['Running', '正在执行'],
    ['Cancelled', '已取消'],
    ['New facet', '新建筛选属性'],
    ['New Facet', '新建筛选属性'],
    ['New facet value', '新建筛选属性值'],
    ['New option group', '新建规格组'],
    ['New Option Group', '新建规格组'],
    ['New product variant', '新建商品 SKU'],
    ['New promotion', '新建促销活动'],
    ['New Promotion', '新建促销活动'],
    ['New seller', '新建商家'],
    ['New Seller', '新建商家'],
    ['New stock location', '新建库存点'],
    ['New Stock Location', '新建库存点'],
    ['New tax category', '新建税务分类'],
    ['New Tax Category', '新建税务分类'],
    ['No fulfillments', '暂无履约记录'],
    ['No more facets', '没有更多可选筛选属性'],
    ['Option Group', '规格组'],
    ['Option Groups', '规格组'],
    ['Order fulfilled', '订单履约已完成'],
    ['Product Variants', '商品 SKU'],
    ['Product variants', '商品 SKU'],
    ['Promotions', '促销活动'],
    ['Public', '公开'],
    ['Permissions for {0}', '{0} 的权限'],
    ['Quantity: {0}', '数量：{0}'],
    ['Remove {0} from {1}', '从 {1} 中移除 {0}'],
    ['Remove asset', '移除素材'],
    ['Removed 1 country/region from zone', '已从业务区域移除 1 个国家/地区'],
    ['Removed {countryCount} countries/regions from zone', '已从业务区域移除 {countryCount} 个国家/地区'],
    ['Seller', '商家'],
    ['Sellers', '商家'],
    ['Seller order', '商家订单'],
    ['Seller orders', '商家订单'],
    ['Set as primary asset', '设为主图'],
    ['Settings Store', '系统配置'],
    ['Single variant, no options', '单一 SKU，不设置规格'],
    ['Slug', 'URL 标识'],
    ['Stock Locations', '仓库与库存点'],
    ['Successfully fulfilled order', '订单履约已完成'],
    ['Variant', '商品 SKU'],
    ['Variants', '商品 SKU'],
    ['Variant name', 'SKU 名称'],
    ['Toggle sidebar', '展开或收起侧边栏'],
    ['Unknown product', '未知商品'],
    ['User', '用户'],
    ['User & Channel', '用户与店铺'],
    ['Collapse', '收起'],
    ['Expand', '展开'],
    ['Updated successfully', '更新成功'],
    ['View name', '视图名称'],
    ['View scope', '可见范围'],
    ['View and manage countries/regions in {zoneName}', '查看并管理业务区域“{zoneName}”中的国家/地区'],
    ['View "{name}" saved successfully', '视图“{name}”已保存'],
    ['1 item', '1 件商品'],
    ['SKU: {sku}', '商品 SKU：{sku}'],
    ['{0} items', '共 {0} 件商品'],
    ['{0} permissions in total', '共 {0} 项权限'],
    ['fieldName.slug', 'URL 标识'],
    ['fieldName.administrator', '后台用户'],
    ['fieldName.availableCurrencyCodes', '可用币种'],
    ['fieldName.availableLanguageCodes', '可用内容语言'],
    ['fieldName.currencyCode', '币种'],
    ['fieldName.defaultCurrencyCode', '默认币种'],
    ['fieldName.defaultLanguageCode', '默认内容语言'],
    ['fieldName.facetValues', '筛选属性值'],
    ['fieldName.featuredAsset', '主图'],
    ['fieldName.fulfillmentHandlerCode', '履约方式'],
    ['fieldName.groups', '客户组'],
    ['fieldName.isPublic', '公开'],
    ['fieldName.isSettled', '已结算'],
    ['fieldName.orderPlacedAt', '下单时间'],
    ['fieldName.phoneNumber', '电话号码'],
    ['fieldName.productCount', '商品数'],
    ['fieldName.productId', '商品 ID'],
    ['fieldName.productVariantCount', '商品 SKU 数'],
    ['fieldName.shippingLines', '配送项'],
    ['fieldName.state', '业务状态'],
    ['fieldName.stockLevels', '库存'],
    ['fieldName.token', '渠道令牌'],
    ['fieldName.total', '合计'],
    ['fieldName.totalWithTax', '含税合计'],
    ['fieldName.user', '后台用户'],
    ['fieldName.valueList', '可选值'],
    ['fieldName.variants', '商品 SKU'],
    ['orderState.ArrangingAdditionalPayment', '等待补款'],
    ['orderState.ArrangingPayment', '等待付款'],
    ['orderState.PaymentSettled', '已付款'],
    ['paymentState.Settled', '已付款'],
    ['refundState.Failed', '退款失败'],
    ['refundState.Pending', '退款处理中'],
    ['refundState.Settled', '退款完成'],
    ['Add a note...', '输入备注...'],
    ['Add note', '添加备注'],
    ['Building, unit, room (optional)', '楼栋、单元、房间号（选填）'],
    ['Building, unit, room, etc.', '楼栋、单元、房间号等'],
    ['Channel language settings updated successfully', '店铺内容语言设置已更新'],
    ['Company (optional)', '公司名称（选填）'],
    ['Company name', '公司名称'],
    ['Could not find the order state before modification', '未找到订单修改前的状态'],
    ['Created tag "{newTag}"', '标签“{newTag}”已创建'],
    ['Delete table', '删除表格'],
    ['Enter a value and press Enter', '输入规格值后按回车键'],
    ['Enter transaction ID...', '输入交易流水号...'],
    ['Failed to create tag', '创建标签失败'],
    ['Failed to delete {0} {entityName}', '删除 {0} 个{entityName}失败'],
    ['Failed to delete {selectionLength} assets', '删除 {selectionLength} 个素材失败'],
    ['Failed to update channel settings: {0}', '更新店铺设置失败：{0}'],
    [
        'Failed to update filter attributes for {entityIdsLength} items',
        '更新 {entityIdsLength} 个条目的筛选属性失败',
    ],
    ['Failed to update global settings: {0}', '更新全局设置失败：{0}'],
    ['Failed to update tags', '更新标签失败'],
    ['For example: Size', '例如：尺码'],
    ['Full size', '原始尺寸'],
    ['Global language settings updated successfully', '全局语言设置已更新'],
    ['Large', '大图'],
    ['Medium', '中图'],
    ['No featured asset', '暂未设置主图'],
    ['No. 88, Nanjing West Road', '南京西路 88 号'],
    ['Phone number (optional)', '手机号码（选填）'],
    ['Postal code (optional)', '邮政编码（选填）'],
    ['Province or state (optional)', '省、自治区或直辖市（选填）'],
    ['Search countries...', '搜索国家或地区...'],
    ['Search filter attribute values...', '搜索筛选属性值...'],
    ['Search products...', '搜索商品...'],
    ['Search products or SKUs...', '搜索商品名称或 SKU...'],
    ['Search tags...', '搜索标签...'],
    ['Select a country or region', '选择国家或地区'],
    ['Select an order state', '选择订单状态'],
    ['Select asset', '选择素材'],
    [
        'Select at least one filter attribute value or change an existing value',
        '请至少选择一个筛选属性值，或修改已有属性值',
    ],
    ['Select default language', '选择默认内容语言'],
    ['Select inventory tracking mode', '选择库存跟踪方式'],
    ['Select language', '选择内容语言'],
    ['Select size', '选择预览尺寸'],
    ['Shanghai', '上海市'],
    ['Small', '小图'],
    ['Tags updated successfully', '标签已更新'],
    ['Thumbnail', '缩略图'],
    ['Tiny', '微型图'],
    ['Zhang Wei', '张伟'],
    ['Customer group controls', '客户分组操作'],
    ['Delete project', '删除项目'],
    ['More', '更多'],
    ['Projects', '项目'],
    ['Share project', '共享项目'],
    ['View project', '查看项目'],
    ['nav.administrators', '管理员'],
    ['nav.apiKeys', 'API 密钥'],
    ['nav.assets', '素材库'],
    ['nav.catalog', '商品管理'],
    ['nav.channels', '店铺'],
    ['nav.collections', '商品分组'],
    ['nav.countries', '国家或地区'],
    ['nav.customerGroups', '客户分组'],
    ['nav.customers', '客户'],
    ['nav.customersSection', '客户管理'],
    ['nav.facets', '筛选属性'],
    ['nav.globalSettings', '全局设置'],
    ['nav.insights', '经营概览'],
    ['nav.jobQueue', '后台任务'],
    ['nav.marketing', '营销中心'],
    ['nav.optionGroups', '规格组'],
    ['nav.orders', '订单'],
    ['nav.paymentMethods', '支付方式'],
    ['nav.products', '商品'],
    ['nav.productVariants', '商品 SKU'],
    ['nav.promotions', '促销活动'],
    ['nav.roles', '角色与权限'],
    ['nav.sales', '订单管理'],
    ['nav.scheduledTasks', '定时任务'],
    ['nav.sellers', '商家'],
    ['nav.settings', '业务设置'],
    ['nav.settingsStore', '系统配置'],
    ['nav.shippingMethods', '配送方式'],
    ['nav.stockLocations', '仓库与库存点'],
    ['nav.system', '系统管理'],
    ['nav.taxCategories', '税务分类'],
    ['nav.taxRates', '税率'],
    ['nav.zones', '业务区域'],
]);

const explicitIdTranslations = new Map([
    ['entity.facetValues', '筛选属性值'],
    ['jobQueue.applyCollectionFilters', '更新商品分组匹配'],
    ['jobQueue.applyCollectionFilters.description', '根据筛选规则重新计算商品分组内容'],
    ['jobQueue.cleanSessions', '清理过期登录会话'],
    ['jobQueue.cleanSessions.description', '移除已过期的后台用户和客户登录会话'],
    ['jobQueue.custom', '自定义后台任务'],
    ['jobQueue.custom.description', '由插件或业务扩展创建的后台任务'],
    ['jobQueue.sendEmail', '发送系统邮件'],
    ['jobQueue.sendEmail.description', '发送订单、账户等通知邮件'],
    ['jobQueue.updateSearchIndex', '更新商品搜索索引'],
    ['jobQueue.updateSearchIndex.description', '同步商品搜索与筛选数据'],
    ['fieldName.currentValue', '当前值'],
    ['fieldName.isRunning', '运行中'],
    ['fieldName.lastExecutedAt', '上次执行'],
    ['fieldName.lastResult', '上次结果'],
    ['fieldName.nextExecutionAt', '下次执行'],
    ['fieldName.readonly', '只读'],
    ['fieldName.schedule', '时间表达式'],
    ['fieldName.scheduleDescription', '时间表'],
    ['fieldName.scopeType', '生效范围'],
    ['scheduledTask.cleanSessions', '清理过期登录会话'],
    ['scheduledTask.cleanSessions.description', '清理数据库中过期和不活跃的后台用户及客户登录会话'],
    ['scheduledTask.cleanOrphanedSettingsStore', '清理无效系统配置'],
    ['scheduledTask.cleanOrphanedSettingsStore.description', '清理字段定义已不存在的孤立系统配置记录'],
    ['scheduledTask.cleanJobs', '清理后台任务记录'],
    ['scheduledTask.cleanJobs.description', '清理数据库中已完成、失败和已取消的后台任务记录'],
    ['scheduledTask.cleanJobQueueIndex', '清理后台任务索引'],
    ['scheduledTask.cleanJobQueueIndex.description', '清理用于加快后台任务列表查询的索引'],
    ['scheduledTask.custom', '扩展计划任务'],
    ['scheduledTask.custom.description', '由插件或业务扩展注册的定时后台任务'],
    ['settingsStore.pluginGlobalValue', '插件全局配置'],
    ['settingsStore.pluginUserValue', '插件用户配置'],
    ['settingsStore.buildVersion', '系统构建版本'],
    ['settingsStore.buildMetadata', '系统构建信息'],
    ['settingsStore.dashboardUserSettings', '后台用户界面设置'],
    ['settingsStore.globalSavedViews', '公共表格视图'],
    ['settingsStore.userSavedViews', '个人表格视图'],
    ['settingsStore.custom', '扩展系统配置'],
]);

function normalizeTranslation(entry) {
    const explicit = explicitIdTranslations.get(entry.msgid);
    if (explicit !== undefined) return explicit;
    const exact = exactTranslations.get(entry.msgid);
    if (exact) return exact;

    let value = entry.msgstr;

    if (/product/i.test(entry.msgid)) {
        value = value.replaceAll('产品', '商品');
    }
    if (/API Keys?/iu.test(entry.msgid)) {
        value = value
            .replaceAll('API Keys', 'API 密钥')
            .replaceAll('API keys', 'API 密钥')
            .replaceAll('API Key', 'API 密钥')
            .replaceAll('API key', 'API 密钥');
    }
    if (/collection/i.test(entry.msgid)) {
        value = value.replaceAll('集合', '商品分组');
    }
    if (/facet/i.test(entry.msgid)) {
        value = value
            .replaceAll('分面值', '筛选属性值')
            .replaceAll('分面', '筛选属性')
            .replace(/(?<!筛选)属性值/g, '筛选属性值')
            .replace(/(?<!筛选)属性/g, '筛选属性')
            .replace(/(?:筛选)+属性/g, '筛选属性');
    }
    if (/option group/i.test(entry.msgid)) {
        value = value.replaceAll('选项组', '规格组');
    }
    if (/variant/i.test(entry.msgid)) {
        value = value
            .replaceAll('产品变体', '商品 SKU')
            .replaceAll('商品变体', '商品 SKU')
            .replaceAll('变体', '商品 SKU')
            .replaceAll('选项', '规格');
    }
    if (/asset/i.test(entry.msgid)) {
        value = value.replaceAll('资源', '素材');
    }
    if (/job/i.test(entry.msgid)) {
        value = value.replaceAll('作业', '任务');
    }
    if (/settings store/i.test(entry.msgid)) {
        value = value.replaceAll('设置商店', '系统配置');
    }
    if (/fulfill/i.test(entry.msgid)) {
        value = value.replaceAll('履行', '履约');
    }
    if (/seller/i.test(entry.msgid)) {
        value = value.replaceAll('卖家', '商家');
    }
    if (/stock location/i.test(entry.msgid)) {
        value = value.replaceAll('库存位置', '库存点').replaceAll('库存地点', '库存点');
    }
    if (/channel/i.test(entry.msgid)) {
        value = value
            .replaceAll('销售渠道', '店铺')
            .replaceAll('渠道', '店铺')
            .replaceAll('店铺店铺', '店铺');
    }
    if (/promotion/i.test(entry.msgid)) {
        value = value.replaceAll('促销', '促销活动').replaceAll('促销活动活动', '促销活动');
    }
    if (/tax categor/i.test(entry.msgid)) {
        value = value.replaceAll('税务类别', '税务分类');
    }

    return value
        .replaceAll('商品 SKU库存', '商品 SKU 库存')
        .replaceAll('商品 SKU设置', '商品 SKU 设置')
        .replaceAll('商品 SKU覆盖', '商品 SKU 覆盖')
        .replaceAll('商品 SKU名称', 'SKU 名称')
        .replaceAll('商品 SKU失败', '商品 SKU 失败')
        .replaceAll('商品 SKU已', '商品 SKU 已')
        .replaceAll('商品 SKU吗', '商品 SKU 吗');
}

function getViolations(entries) {
    return entries.flatMap(entry => {
        if (!entry.msgstr) {
            const expected = normalizeTranslation(entry);
            return [{ entry, expected, reason: 'empty translation' }];
        }
        const expected = normalizeTranslation(entry);
        return expected === entry.msgstr ? [] : [{ entry, expected, reason: 'terminology mismatch' }];
    });
}

function writeNormalizedTranslations(entries, violations) {
    const lines = fs.readFileSync(poFile, 'utf8').split('\n');
    const expectedByLine = new Map(violations.map(({ entry, expected }) => [entry.msgstrLine, expected]));

    for (const entry of entries) {
        const expected = expectedByLine.get(entry.msgstrLine);
        if (expected === undefined) continue;

        const lineIndex = entry.msgstrLine - 1;
        if (!lines[lineIndex]?.startsWith('msgstr ')) {
            throw new Error(`Expected msgstr at line ${entry.msgstrLine}`);
        }
        if (lines[lineIndex + 1]?.startsWith('"')) {
            throw new Error(`Cannot safely rewrite multiline msgstr at line ${entry.msgstrLine}`);
        }
        lines[lineIndex] = `msgstr ${JSON.stringify(expected)}`;
    }

    fs.writeFileSync(poFile, lines.join('\n'), 'utf8');
}

const entries = parsePOFile(poFile);
const violations = getViolations(entries);
const shouldWrite = process.argv.includes('--write');

if (shouldWrite && violations.length > 0) {
    writeNormalizedTranslations(entries, violations);
    console.log(`Updated ${violations.length} Simplified Chinese translations.`);
    process.exit(0);
}

if (violations.length > 0) {
    console.error(`Found ${violations.length} Simplified Chinese content issues:`);
    for (const { entry, expected, reason } of violations.slice(0, 30)) {
        console.error(`- ${reason}: ${entry.msgid}`);
        if (entry.msgstr !== expected) {
            console.error(`  current: ${entry.msgstr}`);
            console.error(`  expected: ${expected}`);
        }
    }
    if (violations.length > 30) {
        console.error(`...and ${violations.length - 30} more.`);
    }
    process.exit(1);
}

console.log(`Simplified Chinese content check passed (${entries.length} messages).`);
