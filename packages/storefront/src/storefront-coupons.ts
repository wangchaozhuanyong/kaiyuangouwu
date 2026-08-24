import { StorefrontContentBlock, StorefrontCouponCampaign, StorefrontLanguage } from './types';

export type StorefrontCouponTheme = 'gold' | 'rose' | 'blue' | 'emerald';

export interface StorefrontCouponCard {
    id: string;
    code: string;
    value: string;
    unit: string;
    unitBefore: boolean;
    title: string;
    description: string;
    tag: string;
    theme: StorefrontCouponTheme;
}

const COUPON_STORAGE_LIMIT = 20;
const COUPON_STORAGE_PREFIX = 'vendure-storefront-claimed-coupons';
const couponThemes: StorefrontCouponTheme[] = ['gold', 'rose', 'blue', 'emerald'];

export function couponCardsFromBlock(
    block: StorefrontContentBlock | undefined,
    language: StorefrontLanguage,
): StorefrontCouponCard[] {
    if (block?.type !== 'COUPONS') return [];
    const defaultTag = block.subtitle.trim() || (language === 'zh' ? '活动优惠' : 'Special offer');
    return block.items
        .filter(item => item.targetType === 'COUPON' && Boolean(item.targetValue?.trim()))
        .map((item, index) => {
            const display = parseCouponDisplay(item.label);
            return {
                id: item.id,
                code: item.targetValue?.trim() ?? '',
                value: display.value,
                unit: display.unit,
                unitBefore: display.unitBefore,
                title: item.label.trim(),
                description: item.description.trim() || block.body.trim(),
                tag: defaultTag,
                theme: couponThemes[index % couponThemes.length],
            };
        });
}

export function couponCardsFromCampaigns(
    campaigns: StorefrontCouponCampaign[],
    language: StorefrontLanguage,
    currencyCode: string,
): StorefrontCouponCard[] {
    const isZh = language === 'zh';
    const currencyUnit = currencySymbol(currencyCode, language);
    return campaigns.map((coupon, index) => {
        const isFixed = coupon.kind === 'ORDER_FIXED';
        const minimum = formatMinorAmount(coupon.minimumSpend, language);
        const value = isFixed
            ? formatMinorAmount(coupon.discountAmount ?? 0, language)
            : formatDiscountRate(coupon.discountRate);
        const threshold = coupon.minimumSpend
            ? isZh
                ? `满 ${currencyUnit}${minimum} 可用`
                : `Spend ${currencyUnit}${minimum}`
            : isZh
              ? '无门槛'
              : 'No minimum';
        return {
            id: coupon.id,
            code: coupon.couponCode,
            value,
            unit: isFixed ? currencyUnit : isZh ? '折' : 'x',
            unitBefore: isFixed,
            title: coupon.name,
            description: threshold,
            tag: campaignKindLabel(coupon.kind, language),
            theme: couponThemes[index % couponThemes.length],
        };
    });
}

export function readClaimedCouponCodes(scope: string): string[] {
    if (!scope) return [];
    try {
        const parsed = JSON.parse(localStorage.getItem(couponStorageKey(scope)) ?? '[]');
        if (!Array.isArray(parsed)) return [];
        return normalizeCouponCodes(parsed.filter((value): value is string => typeof value === 'string'));
    } catch {
        return [];
    }
}

export function storeClaimedCouponCodes(scope: string, codes: string[]): string[] {
    const normalized = normalizeCouponCodes(codes);
    if (!scope) return normalized;
    try {
        localStorage.setItem(couponStorageKey(scope), JSON.stringify(normalized));
    } catch {
        // Coupon application still works when storage is unavailable.
    }
    return normalized;
}

function parseCouponDisplay(label: string): { value: string; unit: string; unitBefore: boolean } {
    const normalized = label.trim();
    const currencyPrefix = normalized.match(/^([¥￥$€£])\s*([\d.,]+)(.*)$/);
    if (currencyPrefix) {
        return {
            value: `${currencyPrefix[2]}${currencyPrefix[3]}`.trim(),
            unit: currencyPrefix[1],
            unitBefore: true,
        };
    }
    const suffix = normalized.match(/^([\d.,]+)\s*(折|%|x|off|rm|元)$/i);
    if (suffix) {
        return { value: suffix[1], unit: suffix[2], unitBefore: false };
    }
    return { value: normalized, unit: '', unitBefore: false };
}

function normalizeCouponCodes(codes: string[]): string[] {
    return [...new Set(codes.map(code => code.trim()).filter(Boolean))].slice(-COUPON_STORAGE_LIMIT);
}

function campaignKindLabel(kind: StorefrontCouponCampaign['kind'], language: StorefrontLanguage) {
    const labels =
        language === 'zh'
            ? {
                  ORDER_FIXED: '满减券',
                  ORDER_PERCENTAGE: '消费折扣券',
                  COLLECTION_PERCENTAGE: '分类折扣券',
                  PRODUCT_PERCENTAGE: '单品折扣券',
              }
            : {
                  ORDER_FIXED: 'Amount off',
                  ORDER_PERCENTAGE: 'Order discount',
                  COLLECTION_PERCENTAGE: 'Category discount',
                  PRODUCT_PERCENTAGE: 'Product discount',
              };
    return labels[kind];
}

function currencySymbol(currencyCode: string, language: StorefrontLanguage): string {
    try {
        const currencyPart = new Intl.NumberFormat(language === 'zh' ? 'zh-CN' : 'en-US', {
            style: 'currency',
            currency: currencyCode,
            currencyDisplay: 'narrowSymbol',
        })
            .formatToParts(0)
            .find(part => part.type === 'currency');
        return currencyPart?.value ?? currencyCode;
    } catch {
        return currencyCode;
    }
}

function formatMinorAmount(value: number, language: StorefrontLanguage): string {
    return new Intl.NumberFormat(language === 'zh' ? 'zh-CN' : 'en-US', {
        maximumFractionDigits: 2,
    }).format(value / 100);
}

function formatDiscountRate(value: number | null): string {
    return value == null ? '-' : String(Math.round(value * 100) / 100);
}

function couponStorageKey(scope: string): string {
    return `${COUPON_STORAGE_PREFIX}:${scope}`;
}
