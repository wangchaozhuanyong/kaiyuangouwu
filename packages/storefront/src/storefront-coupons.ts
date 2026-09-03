import { convertMinorPriceToUsdt } from './money-display';
import {
    StoreCouponUsageRecord,
    StoreCustomerCoupon,
    StorefrontContentBlock,
    StorefrontCouponCampaign,
    StorefrontLanguage,
} from './types';

export type StorefrontCouponTheme = 'gold' | 'rose' | 'blue' | 'emerald';

export interface StorefrontCouponCard {
    id: string;
    campaignId: string;
    value: string;
    unit: string;
    unitBefore: boolean;
    title: string;
    description: string;
    tag: string;
    theme: StorefrontCouponTheme;
    claimed: boolean;
    claimable: boolean;
}

export function appliedCouponLabel(
    coupons: StoreCustomerCoupon[],
    orderId: string,
    language: StorefrontLanguage,
): string | null {
    const names = Array.from(
        new Set(
            coupons
                .filter(coupon => coupon.lockedOrderId === orderId)
                .map(coupon => coupon.campaignName.trim())
                .filter(Boolean),
        ),
    );
    return names.length ? names.join(language === 'zh' ? '、' : ', ') : null;
}

const couponThemes: StorefrontCouponTheme[] = ['gold', 'rose', 'blue', 'emerald'];

const couponThemeByKind: Record<StorefrontCouponCampaign['kind'], StorefrontCouponTheme> = {
    ORDER_FIXED: 'rose',
    ORDER_PERCENTAGE: 'gold',
    COLLECTION_PERCENTAGE: 'blue',
    PRODUCT_PERCENTAGE: 'emerald',
};

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
                campaignId: item.targetValue?.trim() ?? '',
                value: display.value,
                unit: display.unit,
                unitBefore: display.unitBefore,
                title: item.label.trim(),
                description: item.description.trim() || block.body.trim(),
                tag: defaultTag,
                theme: couponThemes[index % couponThemes.length],
                claimed: false,
                claimable: true,
            };
        });
}

export function couponCardsFromCampaigns(
    campaigns: StorefrontCouponCampaign[],
    language: StorefrontLanguage,
    currencyCode: string,
    displayCurrencyCode = currencyCode,
): StorefrontCouponCard[] {
    const isZh = language === 'zh';
    return campaigns.filter(isDisplayableCampaign).map(coupon => {
        const isFixed = coupon.kind === 'ORDER_FIXED';
        const money = displayMoneyParts(coupon.minimumSpend, currencyCode, displayCurrencyCode, language);
        const discountMoney = displayMoneyParts(
            coupon.discountAmount ?? 0,
            currencyCode,
            displayCurrencyCode,
            language,
        );
        const value = isFixed ? discountMoney.value : formatDiscountRate(coupon.discountRate);
        const threshold = coupon.minimumSpend
            ? isZh
                ? `满 ${money.unit}${money.value} 可用`
                : `Spend ${money.unit}${money.value}`
            : isZh
              ? '无门槛'
              : 'No minimum';
        return {
            id: coupon.id,
            campaignId: coupon.id,
            value,
            unit: isFixed ? discountMoney.unit : isZh ? '折' : 'x',
            unitBefore: isFixed,
            title: coupon.name,
            description: threshold,
            tag: campaignKindLabel(coupon.kind, language),
            theme: couponThemeByKind[coupon.kind],
            claimed: coupon.claimed,
            claimable: coupon.claimable && !coupon.claimed,
        };
    });
}

export function couponCardFromCustomerCoupon(
    coupon: StoreCustomerCoupon,
    language: StorefrontLanguage,
    currencyCode: string,
    _index = 0,
    displayCurrencyCode = currencyCode,
): StorefrontCouponCard {
    const isZh = language === 'zh';
    const minimumMoney = displayMoneyParts(coupon.minimumSpend, currencyCode, displayCurrencyCode, language);
    const discountMoney = displayMoneyParts(
        coupon.discountAmount ?? 0,
        currencyCode,
        displayCurrencyCode,
        language,
    );
    const isFixed = coupon.campaignKind === 'ORDER_FIXED';
    return {
        id: coupon.id,
        campaignId: coupon.campaignId,
        value: isFixed ? discountMoney.value : formatDiscountRate(coupon.discountRate),
        unit: isFixed ? discountMoney.unit : isZh ? '折' : 'x',
        unitBefore: isFixed,
        title: coupon.campaignName,
        description: coupon.minimumSpend
            ? isZh
                ? `满 ${minimumMoney.unit}${minimumMoney.value} 可用`
                : `Spend ${minimumMoney.unit}${minimumMoney.value}`
            : isZh
              ? '无门槛'
              : 'No minimum',
        tag: campaignKindLabel(coupon.campaignKind, language),
        theme: couponThemeByKind[coupon.campaignKind],
        claimed: true,
        claimable: false,
    };
}

function displayMoneyParts(
    value: number,
    sourceCurrencyCode: string,
    displayCurrencyCode: string,
    language: StorefrontLanguage,
): { value: string; unit: string } {
    if (displayCurrencyCode === 'USDT') {
        const amount = convertMinorPriceToUsdt(value, sourceCurrencyCode);
        if (amount != null) {
            return {
                value: new Intl.NumberFormat(language === 'zh' ? 'zh-CN' : 'en', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: amount < 1 ? 4 : 2,
                }).format(amount),
                unit: '≈₮',
            };
        }
    }
    return { value: formatMinorAmount(value, language), unit: currencySymbol(sourceCurrencyCode, language) };
}

export function couponCardFromUsageRecord(
    record: StoreCouponUsageRecord,
    language: StorefrontLanguage,
    _index = 0,
): StorefrontCouponCard {
    const isZh = language === 'zh';
    const currencyUnit = currencySymbol(record.currencyCode, language);
    const isFixed = record.campaignKind === 'ORDER_FIXED';
    const minimum = formatMinorAmount(record.minimumSpend, language);
    return {
        id: record.id,
        campaignId: record.campaignId,
        value: isFixed
            ? formatMinorAmount(record.discountAmount ?? 0, language)
            : formatDiscountRate(record.discountRate),
        unit: isFixed ? currencyUnit : isZh ? '折' : 'x',
        unitBefore: isFixed,
        title: record.campaignName,
        description: record.minimumSpend
            ? isZh
                ? `满 ${currencyUnit}${minimum} 可用`
                : `Spend ${currencyUnit}${minimum}`
            : isZh
              ? '无门槛'
              : 'No minimum',
        tag: campaignKindLabel(record.campaignKind, language),
        theme: couponThemeByKind[record.campaignKind],
        claimed: true,
        claimable: false,
    };
}

export function couponScopeLabel(
    kind: StorefrontCouponCampaign['kind'],
    language: StorefrontLanguage,
): string {
    const labels =
        language === 'zh'
            ? {
                  ORDER_FIXED: '全场订单',
                  ORDER_PERCENTAGE: '全场订单',
                  COLLECTION_PERCENTAGE: '指定分类商品',
                  PRODUCT_PERCENTAGE: '指定商品',
              }
            : {
                  ORDER_FIXED: 'All orders',
                  ORDER_PERCENTAGE: 'All orders',
                  COLLECTION_PERCENTAGE: 'Selected categories',
                  PRODUCT_PERCENTAGE: 'Selected products',
              };
    return labels[kind];
}

function isDisplayableCampaign(coupon: StorefrontCouponCampaign): boolean {
    if (coupon.minimumSpend < 0) return false;
    if (coupon.kind === 'ORDER_FIXED') {
        return coupon.discountAmount != null && coupon.discountAmount > 0;
    }
    return coupon.discountRate != null && coupon.discountRate > 0 && coupon.discountRate < 10;
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
