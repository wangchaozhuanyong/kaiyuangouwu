export interface ChannelDisplayValue {
    code: string;
    defaultCurrencyCode?: string | null;
}

const DEFAULT_CHANNEL_CODE_PATTERN = /^_+default_channel_+$/iu;

export const isDefaultChannelCode = (code: string) => DEFAULT_CHANNEL_CODE_PATTERN.test(code.trim());

export const getChannelDisplayName = (code: string) => {
    const normalizedCode = code.trim();
    if (!normalizedCode) return '未命名店铺';
    return isDefaultChannelCode(normalizedCode) ? '默认店铺' : normalizedCode;
};

export const getChannelDisplayLabel = ({ code, defaultCurrencyCode }: ChannelDisplayValue) => {
    const name = getChannelDisplayName(code);
    const currencyCode = defaultCurrencyCode?.trim();
    return currencyCode ? `${name} · ${currencyCode}` : name;
};

export const getCatalogEmptyStateDescription = ({
    channelCode,
    searchTerm,
    hasFilters = false,
}: {
    channelCode?: string | null;
    searchTerm: string;
    hasFilters?: boolean;
}) => {
    if (hasFilters) {
        return '当前筛选条件下暂无商品，请调整商品状态、分类或搜索条件后重试。';
    }
    const normalizedSearchTerm = searchTerm.trim();
    if (normalizedSearchTerm) {
        return `未找到与 “${normalizedSearchTerm}” 相关的商品，请尝试更换关键词。`;
    }

    const channelName = channelCode ? getChannelDisplayName(channelCode) : '当前店铺';
    return `“${channelName}”当前暂无商品。商品、库存和价格按店铺独立显示；如果之前已经创建过商品，请先通过右上角“当前店铺”切换到对应店铺。`;
};
