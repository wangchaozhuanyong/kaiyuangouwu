import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AdminPermissionsContext } from '../../../hooks/use-admin-permissions';
import type { AdminPermission } from '../../../utils/admin-permissions';

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
