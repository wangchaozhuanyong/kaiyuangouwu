import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MyStoreSettingsModule } from './MyStoreSettingsModule';

const mocks = vi.hoisted(() => ({ query: vi.fn(), page: vi.fn() }));
vi.mock('../../hooks/use-admin-query', () => ({ useAdminQuery: mocks.query }));
vi.mock('../../hooks/use-standalone-admin-page', () => ({ useStandaloneAdminPage: mocks.page }));
vi.mock('../../components/FeatureHelp', () => ({ FeatureHelpButton: () => null }));
vi.mock('./StoreShippingSettings', () => ({ StoreShippingSettings: () => <div>专用本店配送管理</div> }));

describe('store shipping settings route', () => {
    it('uses the shipping manager without loading or mounting the legacy combined commerce editor', () => {
        mocks.page.mockReturnValue({ key: 'shipping', title: '本店配送' });
        const html = renderToStaticMarkup(<MyStoreSettingsModule />);
        expect(html).toContain('本店配送');
        expect(html).toContain('专用本店配送管理');
        expect(html).not.toContain('本店税务与经营地区');
        expect(mocks.query).not.toHaveBeenCalled();
    });
});
