// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { FeatureHelpProvider } from '../../../components/FeatureHelp';
import { AdminPermissionsContext } from '../../../hooks/use-admin-permissions';
import type { AdminPermission } from '../../../utils/admin-permissions';

vi.mock('./CatalogImportDialog', () => ({
    CatalogImportDialog: () => {
        throw new Promise(() => {});
    },
}));

import { CatalogImportAction } from './CatalogImportAction';

describe('CatalogImportAction', () => {
    it('shows the entry only when the operator can read and create catalog imports', () => {
        const html = renderAction(['ReadCatalogImport', 'CreateCatalogImport']);

        expect(html).toContain('批量导入');
        expect(renderAction(['CreateCatalogImport'])).toBe('');
        expect(renderAction(['ReadCatalogImport'])).toBe('');
    });

    it('allows SuperAdmin without requiring every generated CRUD permission', () => {
        expect(renderAction(['SuperAdmin'])).toContain('批量导入');
    });
});

function renderAction(permissions: readonly AdminPermission[]): string {
    return renderToStaticMarkup(
        <AdminPermissionsContext.Provider
            value={{
                permissions,
                hasAnyPermission: required =>
                    required.length === 0 || required.some(item => permissions.includes(item)),
            }}
        >
            <CatalogImportAction />
        </AdminPermissionsContext.Provider>,
    );
}

it('keeps the import shell and close action available while the module is pending', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    try {
        await act(async () =>
            root.render(
                <AdminPermissionsContext.Provider
                    value={{ permissions: ['SuperAdmin'], hasAnyPermission: () => true }}
                >
                    <FeatureHelpProvider>
                        <CatalogImportAction />
                    </FeatureHelpProvider>
                </AdminPermissionsContext.Provider>,
            ),
        );
        await act(async () => {
            host.querySelector('button')!.click();
            await Promise.resolve();
        });
        const dialog = document.querySelector('[role="dialog"][aria-label="商品安全导入中心"]')!;
        expect(dialog).not.toBeNull();
        expect(dialog.textContent).toContain('导入工作区');
        expect(dialog.textContent).toContain('正在加载商品导入工作区');
        expect(dialog.className).toContain('h-[96vh]');
        const close = dialog.querySelector<HTMLButtonElement>('[aria-label="关闭商品导入工作区"]')!;
        expect(close.disabled).toBe(false);
        await act(async () => close.click());
        expect(document.querySelector('[role="dialog"]')).toBeNull();
    } finally {
        act(() => root.unmount());
        host.remove();
    }
});
