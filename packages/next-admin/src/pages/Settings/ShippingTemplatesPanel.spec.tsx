import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoreManagementResult } from '../../graphql/management.graphql';
import { AdminPermissionsContext } from '../../hooks/use-admin-permissions';
import { ShippingTemplatesPanel } from './ShippingTemplatesPanel';

const mocks = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn() }));
vi.mock('../../hooks/use-admin-query', () => ({ useAdminQuery: mocks.query }));
vi.mock('@apollo/client/react', () => ({ useMutation: mocks.mutation }));
const method = (id: string, name: string) => ({
    id,
    name,
    translations: [{ languageCode: 'zh_Hans', name, description: '' }],
    calculator: { code: 'default-shipping-calculator', args: [{ name: 'rate', value: '0' }] },
    checker: { code: 'store-shipping-zone-eligibility-checker', args: [] },
});
const data = {
    activeChannel: { id: 'store-2', code: 'store-2', defaultCurrencyCode: 'MYR' },
    shippingMethods: { items: [method('legacy', '旧配送')] },
} as unknown as StoreManagementResult;
const option = (id: string, name: string, flags: Record<string, unknown>) => ({
    method: method(id, name),
    platformTemplate: false,
    ownedByStore: false,
    enabled: true,
    sourceCurrencyCode: null,
    ownershipConfirmed: false,
    assignedStoreChannels: [{ id: 'store-2', code: '本店' }],
    ...flags,
});
function render(platform = false) {
    return renderToStaticMarkup(
        <AdminPermissionsContext.Provider
            value={{ permissions: ['SuperAdmin'], hasAnyPermission: () => true }}
        >
            <ShippingTemplatesPanel
                data={
                    platform
                        ? { ...data, activeChannel: { ...data.activeChannel, code: '__default_channel__' } }
                        : data
                }
                onCreate={() => undefined}
                onEdit={() => undefined}
                onDelete={() => undefined}
                deleting={false}
                onChanged={async () => undefined}
                onError={() => undefined}
            />
        </AdminPermissionsContext.Provider>,
    );
}
describe('store shipping template controls', () => {
    beforeEach(() => {
        mocks.mutation.mockReturnValue([vi.fn(), { loading: false }]);
        mocks.query.mockReturnValue({
            data: {
                shippingTemplateManagement: {
                    isPlatform: false,
                    missingPlatformTemplates: 0,
                    items: [
                        option('shared', '包邮', { platformTemplate: true, enabled: false }),
                        option('own', '本店快递', { ownedByStore: true, sourceCurrencyCode: 'CNY' }),
                        option('legacy', '旧配送', {}),
                    ],
                },
            },
            loading: false,
            refetch: vi.fn(),
        });
    });
    it('shows independent switches and copy for shared templates, with edits only for owned templates', () => {
        const html = render();
        expect(html).toContain('包邮本店开关');
        expect(html).toContain('复制到本店');
        expect(html).toContain('编辑配送方式本店快递');
        expect(html).not.toContain('编辑配送方式包邮');
        expect(html).not.toContain('删除配送方式包邮');
        expect(html).not.toContain('编辑配送方式旧配送');
        expect(html).toContain('金额来源 CNY');
        expect(html).toContain('归属待确认');
    });
    it('requires an explicit platform action to create just the common free-shipping template', () => {
        mocks.query.mockReturnValue({
            data: {
                shippingTemplateManagement: { isPlatform: true, missingPlatformTemplates: 1, items: [] },
            },
            loading: false,
        });
        const html = render(true);
        expect(html).toContain('创建通用包邮模板');
        expect(html).not.toContain('满200');
        expect(html).not.toContain('200.00');
        expect(html).not.toContain('本店开关');
    });
    it('keeps legacy content readonly when ownership cannot be read', () => {
        mocks.query.mockReturnValue({ error: new Error('offline'), loading: false, refetch: vi.fn() });
        const html = render();
        expect(html).toContain('旧配送');
        expect(html).toContain('重试读取');
        expect(html).not.toContain('编辑配送方式旧配送');
        expect(html).not.toContain('旧配送本店开关');
    });

    it('offers a platform confirmation only for a single associated store with explicit currency selection', () => {
        const html = render(true);
        expect(html).toContain('确认此旧模板归属');
        expect(html).toContain('请选择经营店铺');
        expect(html).toContain('请选择来源币种');
        expect(html).toContain('确认原金额来源币种');
    });

    it('shows a copy path and blocks direct claiming for shared legacy templates', () => {
        mocks.query.mockReturnValue({
            data: {
                shippingTemplateManagement: {
                    items: [
                        option('legacy', '旧共享配送', {
                            assignedStoreChannels: [
                                { id: 'a', code: '店A' },
                                { id: 'b', code: '店B' },
                            ],
                        }),
                    ],
                },
            },
        });
        const platform = render(true);
        expect(platform).toContain('多店共享旧模板不能直接认领');
        expect(platform).not.toContain('确认此旧模板归属');
        const store = render();
        expect(store).toContain('复制旧模板到本店');
        expect(store).toContain('新模板默认关闭');
    });
});
