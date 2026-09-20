import { getAdminDisplayLanguage, type AdminDisplayLanguage } from './admin-language';

export interface ChannelDisplayValue {
    code: string;
    defaultCurrencyCode?: string | null;
    displayName?: string | null;
    customFields?: {
        storefrontNameZh?: string | null;
        storefrontNameEn?: string | null;
    } | null;
}

const DEFAULT_CHANNEL_CODE_PATTERN = /^_+default_channel_+$/iu;

export const isDefaultChannelCode = (code: string) => DEFAULT_CHANNEL_CODE_PATTERN.test(code.trim());

export const getChannelDisplayName = (
    value: string | ChannelDisplayValue,
    languageCode: AdminDisplayLanguage = getAdminDisplayLanguage(),
) => {
    const code = typeof value === 'string' ? value : value.code;
    const normalizedCode = code.trim();
    if (!normalizedCode) return languageCode === 'zh_Hans' ? '未命名店铺' : 'Unnamed store';
    if (isDefaultChannelCode(normalizedCode)) {
        return languageCode === 'zh_Hans' ? '平台管理（不经营）' : 'Platform management (non-operating)';
    }
    if (typeof value !== 'string') {
        const localizedName =
            value.displayName?.trim() ||
            (languageCode === 'zh_Hans'
                ? value.customFields?.storefrontNameZh?.trim()
                : value.customFields?.storefrontNameEn?.trim());
        if (localizedName) return localizedName;
        if (value.displayName != null || value.customFields != null) {
            return languageCode === 'zh_Hans' ? '未填写中文店名' : 'English store name not set';
        }
    }
    // A technical Channel code is never a user-facing fallback. Every visible query should return
    // localized metadata; stale or historical records get an explicit language-matched placeholder.
    return languageCode === 'zh_Hans' ? '店铺名称不可用' : 'Store name unavailable';
};

export const getChannelDisplayLabel = (
    value: ChannelDisplayValue,
    languageCode: AdminDisplayLanguage = getAdminDisplayLanguage(),
) => {
    const name = getChannelDisplayName(value, languageCode);
    const currencyCode = value.defaultCurrencyCode?.trim();
    return currencyCode ? `${name} · ${currencyCode}` : name;
};

export const getCatalogEmptyStateDescription = ({
    channel,
    channelCode,
    searchTerm,
    hasFilters = false,
}: {
    channel?: string | ChannelDisplayValue | null;
    /** @deprecated Pass channel metadata so localized store names can be resolved. */
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

    const channelName = channel
        ? getChannelDisplayName(channel)
        : channelCode
          ? getChannelDisplayName(channelCode)
          : '当前店铺';
    return `“${channelName}”当前暂无商品。商品、库存和价格按店铺独立显示；如果之前已经创建过商品，请先通过右上角“当前店铺”切换到对应店铺。`;
};
