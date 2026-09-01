export {
    CATALOG_BROWSER_PARSER_VERSION,
    CATALOG_EXCLUDED_HEADERS,
    CATALOG_FIELD_OPTIONS,
    CATALOG_MAPPING_EXCLUDED,
    CATALOG_MAPPING_UNKNOWN,
    MAX_LOCAL_CATALOG_BYTES,
    MAX_LOCAL_CATALOG_ROWS,
    parseCatalogArrayBuffer,
    rowsForCatalogTransport,
    type CatalogWorkerRequest,
    type CatalogWorkerResponse,
    type LocalCatalogFile,
    type LocalCatalogRowError,
} from './dashboard/catalog-local-file.js';
export type { NormalizedCatalogRow } from './types.js';
