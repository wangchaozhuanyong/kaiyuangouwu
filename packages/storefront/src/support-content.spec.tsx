import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SupportContent } from './pages/support-page';
import {
    storefrontSupportChannels,
    supportChannelDetail,
    supportPageTitle,
    supportServiceDetails,
} from './support-content';
import { StorefrontContentBlock } from './types';

const supportBlock: StorefrontContentBlock = {
    id: 'support-1',
    code: 'storefront-support',
    type: 'SUPPORT',
    enabled: true,
    position: 0,
    startsAt: null,
    endsAt: null,
    imageUrl: null,
    backgroundColor: null,
    textColor: null,
    targetType: 'NONE',
    targetValue: null,
    settings: {
        serviceDaysZh: '工作日',
        serviceDaysEn: 'Weekdays',
        serviceStartTime: '08:30',
        serviceEndTime: '19:00',
    },
    title: '客服配置',
    subtitle: '客服副标题',
    body: '非工作时间可留言，我们会尽快回复',
    ctaLabel: '',
    items: [
        {
            id: 'telegram',
            enabled: true,
            position: 1,
            imageUrl: null,
            targetType: 'URL',
            targetValue: 'https://t.me/demo_support',
            settings: { supportChannel: 'TELEGRAM', supportAccount: '@demo_support' },
            label: 'Telegram',
            description: '点击打开 Telegram 与我们联系',
        },
        {
            id: 'wechat',
            enabled: true,
            position: 0,
            imageUrl: 'https://example.com/wechat-qr.png',
            targetType: 'NONE',
            targetValue: null,
            settings: { supportChannel: 'WECHAT', supportAccount: 'demo_support' },
            label: '微信客服',
            description: '微信扫码联系',
        },
    ],
};

describe('support content', () => {
    it('reads service hours from settings and preserves channel order', () => {
        expect(supportPageTitle(supportBlock, 'zh')).toBe('客服配置');
        expect(supportPageTitle(undefined, 'en')).toBe('Customer support');
        expect(supportServiceDetails(supportBlock, 'zh')).toEqual({
            days: '工作日',
            time: '08:30–19:00',
            note: supportBlock.body,
        });
        expect(storefrontSupportChannels(supportBlock).map(channel => channel.key)).toEqual([
            'WECHAT',
            'TELEGRAM',
        ]);
        expect(supportChannelDetail(storefrontSupportChannels(supportBlock)[1], 'zh')).toBe(
            'Telegram：@demo_support',
        );
    });

    it('hides legacy instructions that repeat the row action', () => {
        const [telegram] = storefrontSupportChannels({
            ...supportBlock,
            items: [
                {
                    ...supportBlock.items[0],
                    settings: { supportChannel: 'TELEGRAM' },
                },
            ],
        });

        expect(supportChannelDetail(telegram, 'zh')).toBe('');
    });

    it('renders the selected brand two-tone service strip and contact actions', () => {
        const markup = renderToStaticMarkup(<SupportContent content={supportBlock} language="zh" />);

        expect(markup).toContain('support-hours-rail');
        expect(markup).toContain('客服副标题');
        expect(markup).toContain('客服服务时间');
        expect(markup).toContain('08:30–19:00');
        expect(markup).toContain('微信客服');
        expect(markup).toContain('扫码');
        expect(markup).toContain('Telegram');
        expect(markup).toContain('Telegram：@demo_support');
        expect(markup).not.toContain('点击打开 Telegram 与我们联系');
        expect(markup).toContain('打开');
        expect(markup).toContain('href="https://t.me/demo_support"');
        expect(markup).toContain('target="_blank"');
        expect(markup.indexOf('微信客服')).toBeLessThan(markup.indexOf('Telegram'));
        expect(markup).toContain('<span class="support-channel-icon" aria-hidden="true"><img');
        expect(markup).not.toContain(
            'support-channel-icon"><span class="responsive-picture safe-image-frame"',
        );
    });

    it('marks the order evaluation section as the focused destination', () => {
        const markup = renderToStaticMarkup(
            <SupportContent content={supportBlock} language="zh" orderCode="T0001" focus="evaluation" />,
        );

        expect(markup).toContain('当前服务订单');
        expect(markup).toContain('T0001');
        expect(markup).toContain('class="support-evaluation-card"');
        expect(markup).toContain('tabindex="-1"');
    });

    it('shows only published bilingual FAQs in the selected language', () => {
        const content = {
            ...supportBlock,
            settings: {
                ...supportBlock.settings,
                supportFaqs: [
                    {
                        id: 'delivery',
                        enabled: true,
                        questionZh: '如何确认运费？',
                        answerZh: '结算时按地址计算。',
                        questionEn: 'How is shipping calculated?',
                        answerEn: 'It is calculated at checkout.',
                    },
                    {
                        id: 'draft',
                        enabled: true,
                        questionZh: '未完成问题',
                        answerZh: '未完成答案',
                        questionEn: '',
                        answerEn: '',
                    },
                ],
            },
        };
        const chinese = renderToStaticMarkup(<SupportContent content={content} language="zh" />);
        const english = renderToStaticMarkup(<SupportContent content={content} language="en" />);

        expect(chinese).toContain('如何确认运费？');
        expect(chinese).toContain('结算时按地址计算。');
        expect(chinese).not.toContain('未完成问题');
        expect(english).toContain('How is shipping calculated?');
        expect(english).not.toContain('如何确认运费？');
    });

    it('shows a configured banner image in the desktop support header', () => {
        const markup = renderToStaticMarkup(
            <SupportContent
                content={{ ...supportBlock, imageUrl: '/assets/preview/support-banner.webp' }}
                language="zh"
            />,
        );
        expect(markup).toContain('support-desktop-hero');
        expect(markup).toContain('/assets/preview/support-banner.webp');
    });
});
