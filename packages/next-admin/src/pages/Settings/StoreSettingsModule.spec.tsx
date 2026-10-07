import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StoreSettingsModule } from './StoreSettingsModule';

const mocks = vi.hoisted(() => ({ query: vi.fn(), permissions: vi.fn() }));
vi.mock('../../hooks/use-admin-query', () => ({ useAdminQuery: mocks.query }));
vi.mock('../../hooks/use-admin-permissions', () => ({
    useAdminPermissions: () => ({ hasAnyPermission: mocks.permissions }),
}));
vi.mock('./MyStoreSettingsModule', () => ({ MyStoreSettingsModule: () => <div>本店设置</div> }));
vi.mock('./PlatformGovernanceCenter', () => ({ PlatformGovernanceCenter: () => <div>平台治理</div> }));
vi.mock('./PlatformGovernanceReviewCenter', () => ({
    PlatformGovernanceReviewCenter: () => <div>平台审核</div>,
}));
vi.mock('./settings-ui', () => ({
    ErrorState: ({ message }: { message: string }) => <div>{message}</div>,
    SettingsContentSkeleton: () => <div>读取范围中</div>,
}));

describe('store settings context', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.permissions.mockReturnValue(true);
    });

    it('renders own-store settings for a platform SuperAdmin in an operating Channel', () => {
        mocks.query.mockReturnValue({
            data: {
                activeChannel: { id: '2', code: 'shop-a' },
                myAdministratorAccess: { scope: 'PLATFORM', authority: 'OWNER' },
            },
        });
        expect(renderToStaticMarkup(<StoreSettingsModule />)).toContain('本店设置');
    });

    it('renders central governance in the platform default Channel', () => {
        mocks.query.mockReturnValue({
            data: {
                activeChannel: { id: '1', code: '__default_channel__' },
                myAdministratorAccess: { scope: 'PLATFORM', authority: 'OWNER' },
            },
        });
        expect(renderToStaticMarkup(<StoreSettingsModule />)).toContain('平台治理');
    });

    it('does not render cached governance when context refresh failed', () => {
        mocks.query.mockReturnValue({
            data: { activeChannel: { id: '1', code: '__default_channel__' } },
            error: new Error('范围读取失败'),
        });
        const html = renderToStaticMarkup(<StoreSettingsModule />);
        expect(html).toContain('范围读取失败');
        expect(html).not.toContain('平台治理');
    });

    it('waits for scope and reports an incomplete response without a platform fallback', () => {
        mocks.query.mockReturnValue({});
        expect(renderToStaticMarkup(<StoreSettingsModule />)).toContain('读取范围中');
        mocks.query.mockReturnValue({ data: { myAdministratorAccess: { authority: 'OWNER' } } });
        const html = renderToStaticMarkup(<StoreSettingsModule />);
        expect(html).toContain('无法识别当前管理账号范围');
        expect(html).not.toContain('平台治理');
    });
});
