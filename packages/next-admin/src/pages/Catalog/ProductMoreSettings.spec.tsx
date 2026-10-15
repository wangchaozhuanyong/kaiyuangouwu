// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FeatureHelpProvider } from '../../components/FeatureHelp';
import { ProductMoreSettings } from './ProductMoreSettings';

const fixture = vi.hoisted(() => ({
    editor: {} as Record<string, unknown>,
    change: vi.fn(),
}));
vi.mock('./ProductEditorContext', () => ({ useProductEditor: () => fixture.editor }));

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

beforeEach(() => {
    vi.clearAllMocks();
    fixture.editor = {
        isCreateMode: false,
        productData: {
            product: { createdAt: '2026-10-01T10:00:00.000Z', translations: [{ languageCode: 'en' }] },
        },
        productExtensionFields: [
            {
                name: 'sourceCreatedAt',
                type: 'datetime',
                list: false,
                label: [{ languageCode: 'zh_Hans', value: '来源创建日期' }],
            },
            {
                name: 'pricingMode',
                type: 'string',
                list: false,
                label: [{ languageCode: 'zh_Hans', value: '销售方式' }],
                options: [
                    { value: 'FIXED', label: [{ languageCode: 'zh_Hans', value: '标价销售' }] },
                    { value: 'QUOTE_ONLY', label: [{ languageCode: 'zh_Hans', value: '联系客服询价' }] },
                ],
            },
            {
                name: 'sourceNote',
                type: 'string',
                list: false,
                label: [{ languageCode: 'zh_Hans', value: '补充资料' }],
            },
        ],
        dynamicCustomFieldValues: {
            sourceCreatedAt: '2026-09-01T08:00:00.000Z',
            pricingMode: 'QUOTE_ONLY',
            sourceNote: '保留来源',
        },
        setDynamicCustomFieldValues: fixture.change,
        catalogChannelsData: { activeChannel: { code: 'isolated-store', displayName: '当前独立店铺' } },
        saving: false,
    };
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
});
afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
});
const render = () =>
    act(async () =>
        root.render(
            <FeatureHelpProvider>
                <ProductMoreSettings />
            </FeatureHelpProvider>,
        ),
    );

describe('ProductMoreSettings compact fields', () => {
    it('retains configured fields and persisted sale mode when displaying read-only store ownership', async () => {
        await render();
        expect(host.textContent).toContain('来源创建日期');
        expect(host.textContent).toContain('销售方式');
        expect(host.textContent).toContain('补充资料');
        expect(host.querySelector('select')?.value).toBe('QUOTE_ONLY');
        expect(host.textContent).toContain('本商品仅属于 当前独立店铺');
        expect(host.textContent).toContain('单店独立');
        expect(host.querySelector('time')?.getAttribute('datetime')).toBe('2026-10-01T10:00:00.000Z');
        expect(fixture.change).not.toHaveBeenCalled();
    });

    it('edits a configured field in the existing draft without clearing its neighboring values', async () => {
        await render();
        const select = host.querySelector('select')!;
        await act(async () => {
            select.value = 'FIXED';
            select.dispatchEvent(new Event('change', { bubbles: true }));
        });
        expect(fixture.change).toHaveBeenCalledExactlyOnceWith({
            sourceCreatedAt: '2026-09-01T08:00:00.000Z',
            pricingMode: 'FIXED',
            sourceNote: '保留来源',
        });
    });

    it('keeps new-product metadata read-only and disables configured fields during save', async () => {
        Object.assign(fixture.editor, { saving: true, isCreateMode: true, productData: undefined });
        await render();
        expect(host.textContent).toContain('首次保存后自动记录');
        expect(host.querySelector('time')).toBeNull();
        for (const input of host.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select'))
            expect(input.disabled).toBe(true);
        expect(fixture.change).not.toHaveBeenCalled();
    });
});
