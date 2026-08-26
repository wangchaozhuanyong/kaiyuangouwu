import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AssetFragment } from '@/vdb/graphql/fragments.js';
import { DeleteAssetsBulkAction } from './asset-bulk-actions.js';

const mocks = vi.hoisted(() => ({
    deleteAssets: vi.fn(),
    toastError: vi.fn(),
    toastSuccess: vi.fn(),
}));

vi.mock('@/vdb/graphql/api.js', () => ({
    api: {
        mutate: () => mocks.deleteAssets,
    },
}));

vi.mock('@/vdb/hooks/use-permissions.js', () => ({
    usePermissions: () => ({ hasPermissions: () => true }),
}));

vi.mock('sonner', () => ({
    toast: {
        error: mocks.toastError,
        success: mocks.toastSuccess,
    },
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('DeleteAssetsBulkAction', () => {
    let container: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;
    let queryClient: QueryClient;

    beforeEach(() => {
        i18n.load('en', {
            'Are you sure you want to delete {selectionLength} assets?':
                'Are you sure you want to delete {selectionLength} assets?',
            'Asset is in use': 'Asset is in use',
            Cancel: 'Cancel',
            Delete: 'Delete',
            'Delete anyway': 'Delete anyway',
            'Deleted {selectionLength} assets': 'Deleted {selectionLength} assets',
            'Failed to delete': 'Failed to delete',
            'Failed to delete {selectionLength} assets': 'Failed to delete {selectionLength} assets',
            'Failed to delete assets: {message}': 'Failed to delete assets: {message}',
        });
        i18n.activate('en');
        queryClient = new QueryClient({
            defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
        });
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        queryClient.clear();
        document.body.innerHTML = '';
        vi.clearAllMocks();
    });

    async function renderAction(refetch = vi.fn()) {
        await act(async () => {
            root.render(
                <I18nProvider i18n={i18n}>
                    <QueryClientProvider client={queryClient}>
                        <DeleteAssetsBulkAction
                            selection={[{ id: 'asset-1' } as AssetFragment]}
                            refetch={refetch}
                        />
                    </QueryClientProvider>
                </I18nProvider>,
            );
            await Promise.resolve();
        });
        return refetch;
    }

    async function click(element: Element) {
        await act(async () => {
            element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await Promise.resolve();
            await Promise.resolve();
        });
    }

    function buttonWithText(text: string, rootElement: ParentNode = document) {
        const button = [...rootElement.querySelectorAll('button')].find(
            candidate => candidate.textContent?.trim() === text,
        );
        expect(button).toBeDefined();
        if (!button) throw new Error(`Expected button with text: ${text}`);
        return button;
    }

    it('shows delete as a direct action and refreshes after deletion', async () => {
        mocks.deleteAssets.mockResolvedValue({ deleteAssets: { result: 'DELETED' } });
        const refetch = await renderAction();

        await click(buttonWithText('Delete', container));
        const dialog = document.querySelector('[role="alertdialog"]');
        expect(dialog?.textContent).toContain('Are you sure you want to delete 1 assets?');

        await click(buttonWithText('Delete', dialog ?? document));

        expect(mocks.deleteAssets).toHaveBeenCalledWith({
            input: { assetIds: ['asset-1'], force: false },
        });
        expect(refetch).toHaveBeenCalledOnce();
        expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    });

    it('offers force deletion when the selected asset is in use', async () => {
        mocks.deleteAssets
            .mockResolvedValueOnce({
                deleteAssets: { result: 'NOT_DELETED', message: 'Used by 1 product' },
            })
            .mockResolvedValueOnce({ deleteAssets: { result: 'DELETED' } });
        const refetch = await renderAction();

        await click(buttonWithText('Delete', container));
        await click(buttonWithText('Delete', document.querySelector('[role="alertdialog"]') ?? document));

        const usageDialog = document.querySelector('[role="alertdialog"]');
        expect(usageDialog?.textContent).toContain('Asset is in use');
        expect(usageDialog?.textContent).toContain('Used by 1 product');

        await click(buttonWithText('Delete anyway', usageDialog ?? document));

        expect(mocks.deleteAssets).toHaveBeenNthCalledWith(2, {
            input: { assetIds: ['asset-1'], force: true },
        });
        expect(refetch).toHaveBeenCalledOnce();
    });
});
