// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminFeedbackCenter } from '../../components/AdminFeedbackCenter';
import { subscribeAdminFeedback, type AdminFeedback } from '../../utils/admin-feedback';
import { ProductEditor } from './ProductEditor';
import type { useProductEditorForm } from './useProductEditorForm';

type Editor = ReturnType<typeof useProductEditorForm>;
const mocks = vi.hoisted(() => ({
    editor: null as Editor | null,
    data: {} as Record<string, unknown>,
    fields: [],
    noop: vi.fn(),
    mutation: vi.fn(),
    query: vi.fn(),
    canUseCapability: () => true,
}));
vi.mock('../../apollo', () => ({
    client: { mutate: mocks.mutation, query: mocks.query },
    getAdminQueryScope: () => 'save-feedback-store',
    getActiveChannelToken: () => null,
    channelRequestContext: mocks.noop,
    sensitiveActionContext: mocks.noop,
}));
vi.mock('@apollo/client/react', () => ({
    useMutation: () => [mocks.mutation, { loading: false }],
}));
vi.mock('react-router-dom', () => ({
    useParams: () => ({ id: 'new' }),
    useNavigate: () => mocks.noop,
}));
vi.mock('../../components/confirm-dialog-context', () => ({ useConfirmDialog: () => mocks.noop }));
vi.mock('../../custom-fields/custom-fields-context', () => ({
    useCustomFieldDefinitions: () => mocks.fields,
}));
vi.mock('../../hooks/use-admin-return', () => ({ useAdminReturn: () => ({ returnToList: mocks.noop }) }));
vi.mock('../../hooks/use-page-size', () => ({ usePageSize: () => [20, mocks.noop] }));
vi.mock('../../hooks/use-admin-capabilities', () => ({
    useAdminCapabilities: () => ({ canUseCapability: mocks.canUseCapability }),
}));
vi.mock('../../hooks/use-admin-permissions', () => ({
    useAdminPermissions: () => ({ hasAnyPermission: mocks.canUseCapability }),
}));
vi.mock('../../hooks/use-url-tab', async () => {
    const { useState } = await import('react');
    return { useUrlTab: () => useState('BASIC') };
});
vi.mock('./useProductEditorData', () => ({ useProductEditorData: () => mocks.data }));
// New-product maintenance checks are skipped; keep the real scope guard and isolate its query IO.
vi.mock('../../hooks/use-admin-query', () => ({
    useAdminQuery: () => ({ data: undefined, loading: false, error: undefined, refetch: mocks.noop }),
}));
// Keep the real form, save validation, editor, pricing fields and workspace focus behavior.
// Unrelated assets, extensions and stock readers do not participate in these submissions.
vi.mock('../../components/FeatureHelp', () => ({ FeatureHelpButton: () => null }));
vi.mock('../../components/ImageAssetUploadButton', () => ({ ImageAssetUploadButton: () => null }));
vi.mock('../../extensions/extension-hosts', () => ({ NextAdminPageBlocks: () => null }));
vi.mock('./ProductAssetPickerModal', () => ({ ProductAssetPickerModal: () => null }));
vi.mock('./ProductCategorySummary', () => ({ ProductCategorySummary: () => null }));
vi.mock('./ProductFacetsCollectionsTab', () => ({ ProductFacetsCollectionsTab: () => null }));
vi.mock('./DigitalProductWorkspace', () => ({ DigitalProductWorkspace: () => null }));
vi.mock('./PhysicalProductWorkspace', () => ({ PhysicalProductWorkspace: () => null }));
vi.mock('./ProductMoreSettings', () => ({ ProductMoreSettings: () => null }));
vi.mock('./ProductSupplySettings', () => ({ ProductSupplySettings: () => null }));
vi.mock('./CatalogOperationsBlocks', () => ({ ProductPackagingBlock: () => null }));
vi.mock('../Storefront/SeoEditorLink', () => ({ SeoEditorLink: () => null }));
vi.mock('./ProductEditorSidebar', async importOriginal => {
    const original = await importOriginal<typeof import('./ProductEditorSidebar')>();
    const { useProductEditor } = await import('./ProductEditorContext');
    return {
        ...original,
        ProductEditorSidebar({ children }: { children?: ReactNode }) {
            mocks.editor = useProductEditor();
            return <aside>{children}</aside>;
        },
    };
});

let host: HTMLDivElement;
let root: Root;
let feedback: AdminFeedback[];
let unsubscribe: () => void;
let previousScrollIntoView: PropertyDescriptor | undefined;
const scrollIntoView = vi.fn();
const editor = () => {
    if (!mocks.editor) throw new Error('Product editor did not render');
    return mocks.editor;
};
const control = (label: string) => {
    const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
    if (!input) throw new Error(`Missing product field: ${label}`);
    return input;
};
const save = async () => {
    const button = Array.from(host.querySelectorAll('button')).find(
        item => item.textContent?.trim() === '保存商品',
    );
    if (!button) throw new Error('Missing save product button');
    button.focus();
    await act(async () => button.click());
};
const notifications = () => host.querySelectorAll('[aria-label="操作通知"] [role="alert"]');

beforeEach(async () => {
    vi.clearAllMocks();
    mocks.editor = null;
    mocks.data = {
        productLoading: false,
        activeCurrencyCode: 'CNY',
        commerceMode: 'DIGITAL',
        fixedFulfillmentType: 'digital',
        workspaceVariants: [],
        catalogChannelsData: {
            activeChannel: { id: 'store-a' },
            channels: { items: [], totalItems: 0 },
        },
        refetchProduct: mocks.noop,
        refetchCollections: mocks.noop,
        refetchWorkspace: mocks.noop,
    };
    feedback = [];
    unsubscribe = subscribeAdminFeedback(item => feedback.push(item));
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    previousScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
        configurable: true,
        value: scrollIntoView,
    });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () =>
        root.render(
            <>
                <AdminFeedbackCenter />
                <ProductEditor />
            </>,
        ),
    );
    await act(async () => {
        editor().setProductName('保留的商品草稿');
        editor().setDescription('尚未保存的完整详情');
        editor().setVariants(rows => rows.map(row => ({ ...row, sku: 'DRAFT-1', price: '' })));
    });
});

afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    unsubscribe();
    if (previousScrollIntoView) {
        Object.defineProperty(Element.prototype, 'scrollIntoView', previousScrollIntoView);
    } else {
        Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
    }
    vi.unstubAllGlobals();
});

describe('product save validation feedback', () => {
    it('publishes the actual missing-price reason without writing or discarding the draft', async () => {
        await act(async () => {
            editor().setSelectedAssetIds(['gallery-draft']);
            editor().setSelectedCollectionIds(['category-draft']);
        });
        await save();

        expect(feedback.at(-1)).toMatchObject({
            kind: 'error',
            title: '商品未保存',
            message: 'SKU DRAFT-1：请输入有效的 CNY 非负金额',
        });
        expect(notifications()).toHaveLength(1);
        expect(notifications()[0].textContent).toContain('SKU DRAFT-1：请输入有效的 CNY 非负金额');
        expect(editor()).toMatchObject({
            productName: '保留的商品草稿',
            description: '尚未保存的完整详情',
            selectedAssetIds: ['gallery-draft'],
            selectedCollectionIds: ['category-draft'],
            isDirty: true,
            saving: false,
        });
        expect(editor().variants[0]).toMatchObject({ sku: 'DRAFT-1', price: '' });
        expect(mocks.mutation).not.toHaveBeenCalled();
        expect(mocks.query).not.toHaveBeenCalled();
    });

    it('reannounces and refocuses a repeated error while keeping one notification', async () => {
        await save();
        const firstRevision = editor().errorRevision;
        const price = control('规格 1 售价');
        expect(price.getAttribute('aria-invalid')).toBe('true');
        expect(document.activeElement).toBe(price);
        // Center invalid controls so the workspace's sticky tab bar cannot cover them.
        expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'center' });
        const firstScrollCount = scrollIntoView.mock.calls.length;
        expect(firstScrollCount).toBeGreaterThan(0);

        await save();

        expect(editor().errorRevision).toBe(firstRevision + 1);
        expect(feedback).toHaveLength(2);
        expect(feedback[1].id).toBe(feedback[0].id);
        expect(notifications()).toHaveLength(1);
        expect(document.activeElement).toBe(price);
        expect(scrollIntoView.mock.calls.length).toBeGreaterThan(firstScrollCount);
        expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'center' });
        expect(editor().variants[0].price).toBe('');
        expect(mocks.mutation).not.toHaveBeenCalled();
    });

    it('points at the real invalid cost control and includes the SKU and currency', async () => {
        await act(async () =>
            editor().setVariants(rows => rows.map(row => ({ ...row, price: '20', costPrice: '-1' }))),
        );
        await save();

        expect(notifications()[0].textContent).toContain('SKU DRAFT-1：请输入有效的 CNY 非负成本价');
        const cost = control('规格 1 成本');
        expect(cost.getAttribute('aria-invalid')).toBe('true');
        expect(document.activeElement).toBe(cost);
        expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'center' });
        expect(mocks.mutation).not.toHaveBeenCalled();
    });

    it('opens delivery settings and focuses the actual out-of-range service duration', async () => {
        await act(async () => {
            editor().setVariants(rows => rows.map(row => ({ ...row, price: '20' })));
            editor().setManualDeliverySlaMinutes(0);
        });
        await save();

        expect(notifications()[0].textContent).toContain('人工交付预计时长必须是 5 到 525600 分钟之间的整数');
        expect(editor().activeTab).toBe('DELIVERY');
        const duration = control('预计人工处理时长');
        expect(duration.getAttribute('aria-invalid')).toBe('true');
        expect(document.activeElement).toBe(duration);
        expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'center' });
        expect(mocks.mutation).not.toHaveBeenCalled();
    });

    it('focuses and scrolls the error summary when a matrix error has no invalid input', async () => {
        await act(async () => {
            const first = { ...editor().variants[0], price: '20' };
            editor().setVariants([first, { ...first, sku: 'DRAFT-2', name: '第二个规格' }]);
        });
        await save();

        const reason =
            '普通单品未关联规格模板时仅支持 1 个销售规格。如需多个规格，请先选择规格模板生成 SKU 矩阵，或删除多余规格行。';
        expect(notifications()[0].textContent).toContain(reason);
        expect(host.querySelector('[aria-invalid="true"]')).toBeNull();
        const summary = host.querySelector<HTMLElement>('[data-product-editor-error-summary]');
        expect(summary?.textContent).toContain(reason);
        expect(document.activeElement).toBe(summary);
        expect(scrollIntoView.mock.contexts).toContain(summary);
        expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest' });
        expect(mocks.mutation).not.toHaveBeenCalled();
    });
});
