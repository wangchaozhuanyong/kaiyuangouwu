import { ContentBlock, ContentItem } from './storefront-content.graphql';

export const supportChannelKeys = ['WECHAT', 'QQ', 'WHATSAPP', 'TELEGRAM', 'QQ_GROUP'] as const;

export type SupportChannelKey = (typeof supportChannelKeys)[number];

export interface SupportChannelDefinition {
    key: SupportChannelKey;
    labelZh: string;
    labelEn: string;
    descriptionZh: string;
    descriptionEn: string;
    targetModeZh: string;
    targetModeEn: string;
    linkPlaceholder: string;
}

export const supportChannelDefinitions: SupportChannelDefinition[] = [
    {
        key: 'WECHAT',
        labelZh: '微信客服',
        labelEn: 'WeChat support',
        descriptionZh: '微信扫码联系',
        descriptionEn: 'Scan with WeChat to contact us',
        targetModeZh: '二维码',
        targetModeEn: 'QR code',
        linkPlaceholder: '',
    },
    {
        key: 'QQ',
        labelZh: 'QQ客服',
        labelEn: 'QQ support',
        descriptionZh: '',
        descriptionEn: '',
        targetModeZh: '直接跳转',
        targetModeEn: 'Direct link',
        linkPlaceholder: 'https://wpa.qq.com/msgrd?v=3&uin=...',
    },
    {
        key: 'WHATSAPP',
        labelZh: 'WhatsApp',
        labelEn: 'WhatsApp',
        descriptionZh: '',
        descriptionEn: '',
        targetModeZh: '直接跳转',
        targetModeEn: 'Direct link',
        linkPlaceholder: 'https://wa.me/8613800000000',
    },
    {
        key: 'TELEGRAM',
        labelZh: 'Telegram',
        labelEn: 'Telegram',
        descriptionZh: '',
        descriptionEn: '',
        targetModeZh: '直接跳转',
        targetModeEn: 'Direct link',
        linkPlaceholder: 'https://t.me/your_service',
    },
    {
        key: 'QQ_GROUP',
        labelZh: 'QQ群',
        labelEn: 'QQ group',
        descriptionZh: '',
        descriptionEn: '',
        targetModeZh: '直接跳转',
        targetModeEn: 'Direct link',
        linkPlaceholder: 'https://qm.qq.com/cgi-bin/qm/qr?...',
    },
];

export const defaultSupportSettings = {
    serviceDaysZh: '每日',
    serviceDaysEn: 'Daily',
    serviceStartTime: '09:00',
    serviceEndTime: '18:00',
} as const;

export function supportChannelKey(item: ContentItem): SupportChannelKey | null {
    const configured = item.settings?.supportChannel;
    if (supportChannelKeys.includes(configured as SupportChannelKey)) {
        return configured as SupportChannelKey;
    }
    const source = `${item.label ?? ''} ${item.translations.map(translation => translation.label).join(' ')}`;
    if (/qq\s*群|qq\s*group/i.test(source)) return 'QQ_GROUP';
    if (/wechat|微信/i.test(source)) return 'WECHAT';
    if (/whatsapp/i.test(source)) return 'WHATSAPP';
    if (/telegram/i.test(source)) return 'TELEGRAM';
    if (/(^|\s)qq|qq客服/i.test(source)) return 'QQ';
    return null;
}

export function prepareSupportDraft(block: ContentBlock): ContentBlock {
    const unmatched = [...block.items];
    const normalizedItems = supportChannelDefinitions.map((definition, position) => {
        const matchIndex = unmatched.findIndex(item => supportChannelKey(item) === definition.key);
        const existing = matchIndex >= 0 ? unmatched.splice(matchIndex, 1)[0] : null;
        return normalizeSupportItem(
            existing ?? createSupportItem(definition, position),
            definition,
            position,
        );
    });
    const translations = (['zh_Hans', 'en'] as const).map(languageCode => {
        const existing = block.translations.find(translation => translation.languageCode === languageCode);
        const isZh = languageCode === 'zh_Hans';
        return {
            languageCode,
            title: existing?.title?.trim() || (isZh ? '客服配置' : 'Customer support'),
            subtitle: existing?.subtitle ?? '',
            body:
                existing?.body?.trim() ||
                (isZh
                    ? '非工作时间可留言，我们会尽快回复'
                    : 'Leave a message outside service hours and we will reply as soon as possible.'),
            ctaLabel: existing?.ctaLabel ?? '',
        };
    });

    return {
        ...block,
        layoutVariant: 'RICH_TEXT',
        targetType: 'NONE',
        targetValue: null,
        settings: { ...defaultSupportSettings, ...(block.settings ?? {}) },
        translations,
        items: [
            ...normalizedItems,
            ...unmatched.map((item, index) => ({ ...item, position: normalizedItems.length + index })),
        ],
    };
}

export function supportItems(block: ContentBlock): Array<{
    channel: SupportChannelDefinition;
    item: ContentItem;
    index: number;
}> {
    return block.items.flatMap((item, index) => {
        const key = supportChannelKey(item);
        const channel = supportChannelDefinitions.find(definition => definition.key === key);
        return channel ? [{ channel, item, index }] : [];
    });
}

export function supportServiceTime(block: ContentBlock): {
    daysZh: string;
    daysEn: string;
    startTime: string;
    endTime: string;
} {
    const settings = block.settings ?? {};
    return {
        daysZh: stringSetting(settings.serviceDaysZh, defaultSupportSettings.serviceDaysZh),
        daysEn: stringSetting(settings.serviceDaysEn, defaultSupportSettings.serviceDaysEn),
        startTime: timeSetting(settings.serviceStartTime, defaultSupportSettings.serviceStartTime),
        endTime: timeSetting(settings.serviceEndTime, defaultSupportSettings.serviceEndTime),
    };
}

export function supportLinkIsValid(value: string | null | undefined): boolean {
    if (!value?.trim()) return false;
    try {
        const url = new URL(value.trim());
        return url.protocol === 'https:' || url.protocol === 'http:';
    } catch {
        return false;
    }
}

export function validateSupportDraft(block: ContentBlock, isZh: boolean): string | null {
    const time = supportServiceTime(block);
    if (!time.daysZh.trim() || !/^\d{2}:\d{2}$/.test(time.startTime) || !/^\d{2}:\d{2}$/.test(time.endTime)) {
        return isZh ? '请填写完整的客服服务时间' : 'Complete the customer-service hours';
    }
    if (time.startTime >= time.endTime) {
        return isZh ? '客服结束时间必须晚于开始时间' : 'End time must be later than start time';
    }
    const items = supportItems(block);
    for (const { channel, item } of items) {
        if (channel.key !== 'WECHAT' && item.targetValue?.trim() && !supportLinkIsValid(item.targetValue)) {
            return isZh
                ? `请为${channel.labelZh}填写有效的 HTTP(S) 跳转链接`
                : `Enter a valid HTTP(S) link for ${channel.labelEn}`;
        }
    }
    const enabled = items.filter(entry => entry.item.enabled);
    if (!enabled.length) {
        return isZh ? '请至少启用一种客服联系方式' : 'Enable at least one support channel';
    }
    for (const { channel, item } of enabled) {
        if (channel.key === 'WECHAT') {
            if (!item.imageAsset && !item.imageUrl?.trim()) {
                return isZh ? '启用微信客服前请上传二维码' : 'Upload a QR code before enabling WeChat';
            }
        } else if (!supportLinkIsValid(item.targetValue)) {
            return isZh
                ? `请为${channel.labelZh}填写有效的 HTTP(S) 跳转链接`
                : `Enter a valid HTTP(S) link for ${channel.labelEn}`;
        }
    }
    return null;
}

function createSupportItem(definition: SupportChannelDefinition, position: number): ContentItem {
    return {
        enabled: false,
        position,
        imageAsset: null,
        imageAssetId: null,
        imageUrl: null,
        targetType: 'NONE',
        targetValue: null,
        settings: { supportChannel: definition.key },
        translations: [
            {
                languageCode: 'zh_Hans',
                label: definition.labelZh,
                description: definition.descriptionZh,
            },
            {
                languageCode: 'en',
                label: definition.labelEn,
                description: definition.descriptionEn,
            },
        ],
    };
}

function normalizeSupportItem(
    item: ContentItem,
    definition: SupportChannelDefinition,
    position: number,
): ContentItem {
    const translations = (['zh_Hans', 'en'] as const).map(languageCode => {
        const existing = item.translations.find(translation => translation.languageCode === languageCode);
        const isZh = languageCode === 'zh_Hans';
        return {
            languageCode,
            label: existing?.label?.trim() || (isZh ? definition.labelZh : definition.labelEn),
            description:
                existing?.description?.trim() || (isZh ? definition.descriptionZh : definition.descriptionEn),
        };
    });
    const isDirectLink = definition.key !== 'WECHAT';
    return {
        ...item,
        position,
        targetType: isDirectLink && item.targetValue?.trim() ? 'URL' : 'NONE',
        targetValue: isDirectLink ? item.targetValue : null,
        settings: { ...(item.settings ?? {}), supportChannel: definition.key },
        translations,
    };
}

function stringSetting(value: unknown, fallback: string): string {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function timeSetting(value: unknown, fallback: string): string {
    return typeof value === 'string' && /^\d{2}:\d{2}$/.test(value) ? value : fallback;
}
