/** Translate tracking codes only; merchant campaign names and unknown sources remain intact. */
export function marketingSourceLabel(source: string, medium: string, language = 'zh_Hans') {
    if (!/^zh/iu.test(language)) return `${source} / ${medium}`;
    if (source === 'direct' && ['(none)', 'none', 'direct', ''].includes(medium)) return '直接访问';
    const sources: Record<string, string> = {
        google: '谷歌',
        bing: '必应',
        facebook: '脸书',
        instagram: 'Instagram',
        telegram: 'Telegram',
    };
    const media: Record<string, string> = {
        cpc: '点击付费广告',
        ppc: '点击付费广告',
        paid: '付费广告',
        paid_social: '社交付费广告',
        organic: '自然搜索',
        referral: '网站引荐',
        email: '邮件推广',
        social: '社交媒体',
        '(none)': '未标记媒介',
        '(not set)': '未标记媒介',
        none: '未标记媒介',
    };
    return `${sources[source.toLowerCase()] ?? source} · ${media[medium.toLowerCase()] ?? medium}`;
}
export function marketingCampaignLabel(campaign: string, language = 'zh_Hans') {
    return /^zh/iu.test(language) && ['(not set)', 'not set', '(none)', ''].includes(campaign.trim())
        ? '未标记活动'
        : campaign;
}
export function marketingReturnMultiple(value?: number | null, language = 'zh_Hans') {
    return value == null || !Number.isFinite(value)
        ? /^zh/iu.test(language)
            ? '暂不可计算'
            : 'Not calculable'
        : `${value.toFixed(2)}${/^zh/iu.test(language) ? ' 倍' : 'x'}`;
}
export function marketingReturnPercent(value?: number | null, language = 'zh_Hans') {
    return value == null || !Number.isFinite(value)
        ? /^zh/iu.test(language)
            ? '暂不可计算'
            : 'Not calculable'
        : `${(value * 100).toFixed(1)}%`;
}
export const MARKETING_REPORT_COLUMNS = {
    zh_Hans: [
        '访问来源',
        '推广活动',
        '搜索词',
        '访问人数',
        '浏览与结账',
        '付款订单数',
        '付款转化率',
        '退款后收入',
        '投放费用',
        '收入回报倍数',
        '投放回报率',
    ],
    en: [
        'Source / medium',
        'Campaign',
        'Search terms',
        'Visitors',
        'Product / checkout',
        'Paid orders',
        'Paid conversion',
        'Refund-adjusted revenue',
        'Campaign cost',
        'ROAS',
        'ROI',
    ],
};
