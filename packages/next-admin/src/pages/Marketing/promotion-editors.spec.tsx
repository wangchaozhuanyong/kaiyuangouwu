// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FeatureHelpProvider } from '../../components/FeatureHelp';
import { CouponEditor } from './promotion-editors';

const mocks = vi.hoisted(() => ({ query: vi.fn(), create: vi.fn() }));
vi.mock('@apollo/client/react', () => ({
    useQuery: mocks.query,
    useMutation: () => [mocks.create, { loading: false }],
}));

afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
});

describe('coupon category selection', () => {
    it('selects first-level categories across pages and retains them when choosing a child category', async () => {
        vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
        const parents = Array.from({ length: 31 }, (_, index) => ({
            id: `parent-${index}`,
            name: `一级分类 ${index}`,
            breadcrumbs: [
                { id: 'root', name: '__root_collection__' },
                { id: `parent-${index}`, name: `一级分类 ${index}` },
            ],
        }));
        const child = {
            id: 'child',
            name: '二级分类',
            breadcrumbs: [...parents[0].breadcrumbs, { id: 'child', name: '二级分类' }],
        };
        mocks.query.mockImplementation((_document, { variables }) => {
            const options = variables.collectionOptions;
            const search = options.filter?.name?.contains ?? '';
            const items = (options.topLevelOnly ? parents : [child, ...parents]).filter(item =>
                item.name.includes(search),
            );
            return {
                data: {
                    collections: {
                        totalItems: items.length,
                        items: items.slice(options.skip, options.skip + options.take),
                    },
                    products: { totalItems: 0, items: [] },
                },
                loading: false,
            };
        });
        mocks.create.mockResolvedValue({ data: { createStoreCouponCampaign: { id: 'campaign' } } });
        const host = document.createElement('div');
        document.body.append(host);
        const root = createRoot(host);
        const onSaved = vi.fn().mockResolvedValue(undefined);
        const onError = vi.fn();
        const change = async (element: HTMLInputElement | HTMLSelectElement, value: string) => {
            await act(async () => {
                const prototype =
                    element instanceof HTMLSelectElement
                        ? HTMLSelectElement.prototype
                        : HTMLInputElement.prototype;
                Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
                element.dispatchEvent(
                    new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
                );
            });
        };
        const field = (text: string) =>
            Array.from(host.querySelectorAll('label')).find(label => label.textContent?.startsWith(text))!;
        const button = (text: string) =>
            Array.from(host.querySelectorAll('button')).find(item => item.textContent?.includes(text))!;

        try {
            await act(async () =>
                root.render(
                    <FeatureHelpProvider>
                        <CouponEditor
                            currencyCode="MYR"
                            onClose={vi.fn()}
                            onSaved={onSaved}
                            onError={onError}
                        />
                    </FeatureHelpProvider>,
                ),
            );
            await change(field('优惠类型').querySelector('select')!, 'COLLECTION_PERCENTAGE');
            expect(field('分类层级').querySelector('select')!.value).toBe('TOP_LEVEL');
            expect(host.textContent).toContain('该分类及全部下级分类中的商品均可使用优惠券');
            await act(async () => field('一级分类 0').querySelector('input')!.click());
            await act(async () => button('下一页').click());
            expect(host.textContent).toContain('第 2 / 2 页');
            await act(async () => field('一级分类 30').querySelector('input')!.click());
            await change(host.querySelector('input[aria-label="搜索适用分类 *"]')!, '一级分类 0');
            expect(mocks.query.mock.calls.at(-1)![1].variables.collectionOptions).toMatchObject({
                skip: 0,
                topLevelOnly: true,
                filter: { name: { contains: '一级分类 0' } },
            });
            expect(field('一级分类 0').querySelector('input')!.checked).toBe(true);
            await change(field('分类层级').querySelector('select')!, 'ALL');
            expect(host.textContent).toContain('一级分类 0 / 二级分类');
            expect(host.textContent).not.toContain('__root_collection__');
            await act(async () => field('一级分类 0 / 二级分类').querySelector('input')!.click());
            await change(field('活动名称').querySelector('input')!, '一级分类优惠');
            expect(button('创建优惠券').disabled).toBe(false);
            await act(async () => button('创建优惠券').click());
            expect(mocks.create).toHaveBeenCalledWith({
                variables: {
                    input: expect.objectContaining({
                        kind: 'COLLECTION_PERCENTAGE',
                        collectionIds: ['parent-0', 'parent-30', 'child'],
                    }),
                },
            });
            const submitted = mocks.create.mock.calls[0][0].variables.input;
            expect(submitted.validityDays).toBe(7);
            expect(submitted.claimEndsAt).toBeTruthy();
            expect(submitted).not.toHaveProperty('endsAt');
            expect(submitted).not.toHaveProperty('perCustomerUsageLimit');
            expect(submitted).not.toHaveProperty('usageLimit');
            expect(onSaved).toHaveBeenCalledOnce();
            expect(onError).not.toHaveBeenCalled();
        } finally {
            act(() => root.unmount());
            host.remove();
        }
    });
});
