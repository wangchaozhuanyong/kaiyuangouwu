// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MyStoreSettingsResult } from '../../graphql/management.graphql';
import { MyStoreCommerceEditor } from './MyStoreCommerceEditor';

const mocks = vi.hoisted(() => ({ mutation: vi.fn(), page: vi.fn() }));
vi.mock('@apollo/client/react', () => ({ useMutation: mocks.mutation }));
vi.mock('../../hooks/use-standalone-admin-page', () => ({ useStandaloneAdminPage: mocks.page }));
vi.mock('../../hooks/use-unsaved-changes-warning', () => ({ useUnsavedChangesWarning: () => undefined }));
vi.mock('../../components/FeatureHelp', () => ({ FeatureHelpButton: () => null }));

const commerce = {
    updatedAt: '2026-10-07T00:00:00.000Z',
    countryCode: 'MY',
    taxRate: 6,
    pricesIncludeTax: false,
    currencyCode: 'MYR',
    baseRate: 550,
    freeShippingThreshold: 20000,
    shippingMethodNameZh: '平台配送',
    shippingMethodNameEn: 'Shared delivery',
    shippingDescriptionZh: '原模板',
    shippingDescriptionEn: 'Source template',
    shippingTaxRate: 0,
    shippingPriceIncludesTax: true,
    estimateMinDays: 3,
    estimateMaxDays: 7,
    blockedPostalPrefixes: '',
} as MyStoreSettingsResult['myStoreCommerceConfiguration'];
let root: Root;
let container: HTMLDivElement;
let save: ReturnType<typeof vi.fn>;
let completed: ReturnType<typeof vi.fn<(message: string) => Promise<void>>>;
let error: ReturnType<typeof vi.fn<(message: string) => void>>;
const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };

beforeEach(() => {
    environment.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    save = vi.fn().mockResolvedValue({ data: { updateMyStoreCommerceConfiguration: { updatedAt: 'next' } } });
    completed = vi.fn<(message: string) => Promise<void>>().mockResolvedValue(undefined);
    error = vi.fn<(message: string) => void>();
    mocks.mutation.mockReturnValue([save, { loading: false }]);
});
afterEach(() => {
    act(() => root.unmount());
    container.remove();
    environment.IS_REACT_ACT_ENVIRONMENT = false;
    vi.clearAllMocks();
});

function render(key: 'business-taxes' | 'business-regions') {
    mocks.page.mockReturnValue({ key, title: key === 'business-taxes' ? '本店税务' : '经营地区' });
    act(() =>
        root.render(<MyStoreCommerceEditor commerce={commerce} onCompleted={completed} onError={error} />),
    );
}
async function submit() {
    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
}

describe('store tax and region submissions', () => {
    it.each(['business-taxes', 'business-regions'] as const)(
        'submits %s without any shipping amount or template fields',
        async key => {
            render(key);
            expect(container.textContent).not.toContain('基础运费');
            expect(container.textContent).not.toContain('免运费门槛');
            await submit();
            expect(save).toHaveBeenCalledWith({
                variables: {
                    input: {
                        expectedUpdatedAt: commerce.updatedAt,
                        pricesIncludeTax: false,
                        countryCode: 'MY',
                        taxRate: 6,
                    },
                },
            });
            expect(completed).toHaveBeenCalledOnce();
            expect(error).not.toHaveBeenCalled();
        },
    );

    it('keeps a rejected save from being reported as complete', async () => {
        save.mockRejectedValueOnce(new Error('配置已更新，请重新读取'));
        render('business-taxes');
        await submit();
        expect(completed).not.toHaveBeenCalled();
        expect(error).toHaveBeenCalledWith(expect.stringContaining('配置已更新，请重新读取'));
    });
});
