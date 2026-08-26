import { StorefrontContentBlock, StorefrontContentItem, StorefrontLanguage } from './types';

export const supportChannelKeys = ['WECHAT', 'QQ', 'WHATSAPP', 'TELEGRAM', 'QQ_GROUP'] as const;

export type SupportChannelKey = (typeof supportChannelKeys)[number];

export interface StorefrontSupportChannel {
    key: SupportChannelKey;
    item: StorefrontContentItem;
}

export function storefrontSupportChannels(block: StorefrontContentBlock): StorefrontSupportChannel[] {
    return block.items
        .flatMap(item => {
            const key = supportChannelKey(item);
            return key ? [{ key, item }] : [];
        })
        .sort((a, b) => a.item.position - b.item.position);
}

export function supportServiceDetails(
    block: StorefrontContentBlock,
    language: StorefrontLanguage,
): { days: string; time: string; note: string } {
    const settings = block.settings ?? {};
    const daysKey = language === 'zh' ? 'serviceDaysZh' : 'serviceDaysEn';
    const days = stringSetting(settings[daysKey], language === 'zh' ? '每日' : 'Daily');
    const start = timeSetting(settings.serviceStartTime, '09:00');
    const end = timeSetting(settings.serviceEndTime, '18:00');
    return {
        days,
        time: `${start}–${end}`,
        note:
            block.body.trim() ||
            (language === 'zh'
                ? '非工作时间可留言，我们会尽快回复'
                : 'Leave a message outside service hours and we will reply as soon as possible.'),
    };
}

export function supportChannelDetail(
    channel: StorefrontSupportChannel,
    language: StorefrontLanguage,
): string {
    if (channel.key === 'WECHAT') {
        return channel.item.description.trim() || (language === 'zh' ? '微信扫码联系' : 'Scan with WeChat');
    }

    const account = channel.item.settings?.supportAccount;
    if (typeof account === 'string' && account.trim()) {
        const labels: Record<Exclude<SupportChannelKey, 'WECHAT'>, { zh: string; en: string }> = {
            QQ: { zh: 'QQ号', en: 'QQ ID' },
            WHATSAPP: { zh: 'WhatsApp', en: 'WhatsApp' },
            TELEGRAM: { zh: 'Telegram', en: 'Telegram' },
            QQ_GROUP: { zh: 'QQ群号', en: 'QQ group' },
        };
        return `${labels[channel.key][language]}：${account.trim()}`;
    }

    const description = channel.item.description.trim();
    return isRedundantSupportDescription(description) ? '' : description;
}

export function supportChannelKey(item: StorefrontContentItem): SupportChannelKey | null {
    const configured = item.settings?.supportChannel;
    if (supportChannelKeys.includes(configured as SupportChannelKey)) {
        return configured as SupportChannelKey;
    }
    const source = `${item.label} ${item.description}`;
    if (/qq\s*群|qq\s*group/i.test(source)) return 'QQ_GROUP';
    if (/wechat|微信/i.test(source)) return 'WECHAT';
    if (/whatsapp/i.test(source)) return 'WHATSAPP';
    if (/telegram/i.test(source)) return 'TELEGRAM';
    if (/(^|\s)qq|qq客服/i.test(source)) return 'QQ';
    return null;
}

function stringSetting(value: unknown, fallback: string): string {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function timeSetting(value: unknown, fallback: string): string {
    return typeof value === 'string' && /^\d{2}:\d{2}$/.test(value) ? value : fallback;
}

function isRedundantSupportDescription(value: string): boolean {
    return (
        !value ||
        /(?:点击.*(?:打开|加入)|与我们联系|open .* to contact us|join .* support group)/iu.test(value)
    );
}
