import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
    AnnouncementDetailSheet,
    AnnouncementsPage,
    splitSystemAnnouncements,
} from './pages/announcements-page';
import { StorefrontContext } from './StorefrontContext';
import { StorefrontSystemAnnouncement } from './types';

const announcements: StorefrontSystemAnnouncement[] = [
    {
        id: 'featured',
        title: '测试系统公告',
        content: '为优化用户体验并提升系统稳定性，我们将于近期对部分功能进行升级维护。',
        linkUrl: null,
        startsAt: '2026-08-25T00:00:00.000Z',
        endsAt: '2026-09-30T00:00:00.000Z',
    },
    {
        id: 'delivery',
        title: '配送时效调整通知',
        content: '因物流网络优化，部分地区配送时效将于近期进行变更，请您留意。',
        linkUrl: null,
        startsAt: '2026-08-20T00:00:00.000Z',
        endsAt: '2026-09-20T00:00:00.000Z',
    },
    {
        id: 'membership',
        title: '会员服务升级说明',
        content: '为提供更优质的服务体验，我们已完成会员服务升级。',
        linkUrl: null,
        startsAt: '2026-08-10T00:00:00.000Z',
        endsAt: null,
    },
];

function renderPage(overrides: Record<string, unknown> = {}) {
    return renderToStaticMarkup(
        <StorefrontContext.Provider
            value={{
                announcements,
                loading: false,
                error: '',
                locale: 'zh-CN',
                language: 'zh',
                onBack: vi.fn(),
                onRetry: vi.fn(),
                ...overrides,
            }}
        >
            <AnnouncementsPage />
        </StorefrontContext.Provider>,
    );
}

describe('AnnouncementsPage', () => {
    it('keeps the first backend announcement featured without duplicating it in the remaining list', () => {
        const sections = splitSystemAnnouncements(announcements);

        expect(sections.featured?.id).toBe('featured');
        expect(sections.more.map(announcement => announcement.id)).toEqual(['delivery', 'membership']);
    });

    it('renders the coordinated featured card and compact remaining-announcement directory', () => {
        const markup = renderPage();

        expect(markup).toContain('网站公告');
        expect(markup).toContain('当前有效');
        expect(markup).toContain('更多公告');
        expect(markup).toContain('2 条');
        expect(markup).toContain('配送时效调整通知');
        expect(markup).toContain('长期有效');
        expect(markup).toContain('公告内容由平台统一发布');
    });

    it('does not render a redundant more-announcements section for a single active announcement', () => {
        const markup = renderPage({ announcements: announcements.slice(0, 1) });

        expect(markup).toContain('测试系统公告');
        expect(markup).not.toContain('更多公告');
    });

    it('renders the shared empty state when there are no active announcements', () => {
        const markup = renderPage({ announcements: [] });

        expect(markup).toContain('暂无网站公告');
        expect(markup).toContain('首页公告栏同步显示');
    });

    it('shows full content and a link action in the announcement detail sheet', () => {
        const markup = renderToStaticMarkup(
            <AnnouncementDetailSheet
                announcement={{ ...announcements[0], linkUrl: 'https://example.com/maintenance' }}
                language="zh"
                onClose={vi.fn()}
            />,
        );

        expect(markup).toContain('role="dialog"');
        expect(markup).toContain(announcements[0].content);
        expect(markup).toContain('前往相关页面');
    });
});
