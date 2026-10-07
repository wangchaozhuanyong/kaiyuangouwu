import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoreProfileRecord } from '../../graphql/management.graphql';
import { DomainsPanel } from './StorePanels';

const mocks = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn(), confirm: vi.fn() }));
vi.mock('../../hooks/use-admin-query', () => ({ useAdminQuery: mocks.query }));
vi.mock('@apollo/client/react', () => ({ useMutation: () => [mocks.mutation, { loading: false }] }));
vi.mock('../../apollo', () => ({ client: { query: vi.fn() }, sensitiveActionContext: {} }));
vi.mock('../../components/confirm-dialog-context', () => ({ useConfirmDialog: () => mocks.confirm }));
vi.mock('../../components/FeatureHelp', () => ({ FeatureHelpButton: () => null }));
vi.mock('./StoreDialogs', () => ({
    SellerDialog: () => null,
    storeName: (profile: { channel: { code: string } }) => profile.channel.code,
}));

const profile = { channel: { id: 'store-a', code: 'store-a' } } as StoreProfileRecord;
const other = { channel: { id: 'store-b', code: 'store-b' } } as StoreProfileRecord;
const record = { id: 'domain-a', domain: 'shop.example.com', status: 'ACTIVE', isPrimary: true };
function render(allowTransfer = false) {
    return renderToStaticMarkup(
        <DomainsPanel
            profile={profile}
            profiles={[profile, other]}
            allowTransfer={allowTransfer}
            onChanged={vi.fn()}
            onError={vi.fn()}
        />,
    );
}
describe('own-store domain loading and transfer boundaries', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('queries the supplied operating Channel and hides transfer controls there', () => {
        mocks.query.mockReturnValue({
            data: { storeDomains: [record], storeDomainConfiguration: { cnameTarget: 'shops.example.com' } },
        });
        const html = render();
        expect(mocks.query).toHaveBeenCalledWith(expect.anything(), {
            variables: { channelId: 'store-a' },
            skip: false,
        });
        expect(html).toContain('shop.example.com');
        expect(html).not.toContain('原子转移');
        expect(render(true)).toContain('原子转移');
    });

    it('shows a read failure instead of claiming the store has no domains', () => {
        mocks.query.mockReturnValue({ error: new Error('域名读取失败'), loading: false });
        const html = render();
        expect(html).toContain('域名读取失败');
        expect(html).not.toContain('尚未绑定');
        expect(html).toMatch(/disabled=""[^>]*>[\s\S]*?添加域名/u);
    });

    it('reports failed refresh with retained records and disables mutation controls', () => {
        mocks.query.mockReturnValue({
            error: new Error('更新失败'),
            data: { storeDomains: [record], storeDomainConfiguration: { cnameTarget: 'shops.example.com' } },
            loading: false,
        });
        const html = render();
        expect(html).toContain('更新失败');
        expect(html).toContain('shop.example.com');
        expect(html).toMatch(/disabled=""[^>]*>[\s\S]*?移除/u);
    });

    it('shows an empty state only after a successful empty response', () => {
        mocks.query.mockReturnValue({
            data: { storeDomains: [], storeDomainConfiguration: { cnameTarget: 'shops.example.com' } },
            loading: false,
        });
        expect(render()).toContain('尚未绑定');
        mocks.query.mockReturnValue({ loading: true });
        expect(render()).not.toContain('尚未绑定');
    });
});
