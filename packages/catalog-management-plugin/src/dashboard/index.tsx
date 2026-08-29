import { defineDashboardExtension } from '@vendure/dashboard';

import { CatalogExportAction } from './catalog-export-action';
import { CatalogImportAction } from './catalog-import-workbench';
import { CatalogProductWorkspace } from './catalog-product-workspace';

defineDashboardExtension({
    actionBarItems: [
        {
            id: 'catalog-safe-import',
            pageId: 'product-list',
            component: CatalogImportAction,
            requiresPermission: ['CreateCatalogImport'],
            position: { itemId: 'create-button', order: 'before' },
        },
        {
            id: 'catalog-browser-export',
            pageId: 'product-list',
            component: CatalogExportAction,
            requiresPermission: ['ReadCatalogExport', 'ReadCatalogImport'],
            position: { itemId: 'catalog-safe-import', order: 'before' },
        },
    ],
    pageBlocks: [
        {
            id: 'catalog-product-workspace',
            title: '规格、价格、库存与批次',
            location: {
                pageId: 'product-detail',
                column: 'main',
                position: { blockId: 'product-variants-table', order: 'replace' },
            },
            component: CatalogProductWorkspace,
            shouldRender: context => Boolean(context.entity?.id && context.entity?.variantList?.totalItems),
            requiresPermission: ['ReadCatalogOperations', 'ReadCatalogImport'],
        },
    ],
});
