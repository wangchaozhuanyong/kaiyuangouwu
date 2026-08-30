import { CrudPermissionDefinition } from '@vendure/core';

export const CATALOG_IMPORT_QUEUE = 'catalog-safe-import';
export const CATALOG_MANAGEMENT_LOGGER_CTX = 'CatalogManagementPlugin';
export const MAX_CATALOG_IMPORT_BYTES = 20 * 1024 * 1024;
export const MAX_CATALOG_IMPORT_ROWS = 20_000;

export const manageCatalogImportPermission = new CrudPermissionDefinition(
    'CatalogImport',
    operation => `${operation} catalog report imports and rollback audit records`,
);

export const manageCatalogOperationsPermission = new CrudPermissionDefinition(
    'CatalogOperations',
    operation => `${operation} catalog costs, warehouse policies, and inventory lots`,
);

export const manageCatalogExportPermission = new CrudPermissionDefinition(
    'CatalogExport',
    operation => `${operation} structured catalog export data`,
);

export const manageCatalogSupplierPermission = new CrudPermissionDefinition(
    'CatalogSupplier',
    operation => `${operation} catalog suppliers and default SKU supplier assignments`,
);
