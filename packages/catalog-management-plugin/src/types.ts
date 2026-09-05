import type {
    CreateProductInput,
    CurrencyCode,
    ProductListOptions,
    UpdateProductInput,
} from '@vendure/common/lib/generated-types';
import type { ID } from '@vendure/common/lib/shared-types';
import type {
    CustomProductFields,
    CustomProductVariantFields,
} from '@vendure/core/dist/entity/custom-entity-fields';

export type CatalogImportState =
    | 'RECEIVING'
    | 'PREVIEW_READY'
    | 'QUEUED'
    | 'RUNNING'
    | 'COMPLETED'
    | 'COMPLETED_WITH_ERRORS'
    | 'FAILED'
    | 'ROLLED_BACK';

export type CatalogImportAction =
    'PENDING' | 'CREATE' | 'UPDATE' | 'SKIP_UNCHANGED' | 'CONFLICT' | 'WARNING' | 'ERROR';

export type CatalogImportResolution = 'APPLY' | 'CREATE_NEW' | 'UPDATE_EXISTING' | 'SKIP';

export interface UploadedCatalogFile {
    filename: string;
    mimetype: string;
    encoding?: string;
    createReadStream(): NodeJS.ReadableStream;
}

export interface CatalogImportContextInput {
    channelId: ID;
    stockLocationId: ID;
    currencyCode: CurrencyCode;
    clearBlankFields?: boolean;
}

export interface CatalogImportSourceInput {
    filename: string;
    mimetype: string;
    byteSize: number;
    fileHash: string;
    sheetName?: string | null;
    detectedHeaders: string[];
    fieldMapping: Record<string, string>;
    parserVersion: string;
}

export interface BeginCatalogImportInput {
    context: CatalogImportContextInput;
    source: CatalogImportSourceInput;
    totalRows: number;
}

export interface AppendCatalogImportRowsInput {
    jobId: ID;
    rows: NormalizedCatalogRow[];
}

export interface ResolveCatalogImportRowInput {
    rowId: ID;
    resolution: CatalogImportResolution;
    targetVariantId?: ID | null;
}

export interface ResolveCatalogImportRowsInput {
    rowIds: ID[];
    resolution: 'APPLY' | 'SKIP';
}

export interface UpdateCatalogVariantOperationsInput {
    productVariantId: ID;
    stockLocationId: ID;
    sku?: string | null;
    enabled?: boolean | null;
    barcode?: string | null;
    specification?: string | null;
    saleUnit?: string | null;
    purchaseUnit?: string | null;
    packageQuantity?: number | null;
    shelfLifeDays?: number | null;
    sellingPrice?: number | null;
    purchaseCostMicrounits?: number | null;
    currencyCode: CurrencyCode;
    stockOnHand?: number | null;
    minimumStock?: number | null;
    maximumStock?: number | null;
    supplierId?: ID | null;
}

export interface CatalogSupplierListOptions {
    skip?: number | null;
    take?: number | null;
    text?: string | null;
    enabled?: boolean | null;
}

export interface CreateCatalogSupplierInput {
    code?: string | null;
    name: string;
    enabled?: boolean | null;
    contactName?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    notes?: string | null;
}

export interface UpdateCatalogSupplierInput {
    id: ID;
    code?: string;
    name?: string;
    enabled?: boolean;
    contactName?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    notes?: string | null;
}

export interface SaveCatalogProductInput {
    product: UpdateProductInput;
    variants: UpdateCatalogVariantOperationsInput[];
}

export interface CreateCatalogInitialVariantInput {
    stockLocationId: ID;
    sku: string;
    enabled?: boolean | null;
    barcode?: string | null;
    specification?: string | null;
    saleUnit?: string | null;
    purchaseUnit?: string | null;
    packageQuantity: number;
    shelfLifeDays?: number | null;
    sellingPrice: number;
    purchaseCostMicrounits: number;
    stockOnHand: number;
    minimumStock?: number | null;
    maximumStock?: number | null;
}

export interface CreateCatalogProductInput {
    product: CreateProductInput;
    variant: CreateCatalogInitialVariantInput;
    collectionIds: ID[];
}

export interface CreateCatalogProductVariantInput {
    productId: ID;
    stockLocationId: ID;
    name: string;
    sku: string;
    optionIds: ID[];
    enabled?: boolean | null;
    barcode?: string | null;
    specification?: string | null;
    saleUnit?: string | null;
    purchaseUnit?: string | null;
    packageQuantity: number;
    shelfLifeDays?: number | null;
    sellingPrice: number;
    purchaseCostMicrounits?: number | null;
    currencyCode: CurrencyCode;
    stockOnHand: number;
    minimumStock?: number | null;
    maximumStock?: number | null;
}

export interface CatalogProductSummaryFilterInput {
    text?: string | null;
    category?: string | null;
    brand?: string | null;
    enabled?: boolean | null;
    minimumSellingPrice?: number | null;
    maximumSellingPrice?: number | null;
    minimumPurchaseCostMicrounits?: number | null;
    maximumPurchaseCostMicrounits?: number | null;
    minimumMargin?: number | null;
    maximumMargin?: number | null;
    minimumAvailableStock?: number | null;
    maximumAvailableStock?: number | null;
    lowStock?: boolean | null;
    expiringWithinDays?: number | null;
}

export type CatalogProductListOptions = ProductListOptions;

export interface SaveInventoryLotInput {
    id?: ID | null;
    productVariantId: ID;
    stockLocationId: ID;
    lotCode: string;
    manufacturedAt?: Date | string | null;
    expiresAt?: Date | string | null;
    quantityOnHand: number;
    purchaseCostMicrounits?: number | null;
    currencyCode: CurrencyCode;
}

export interface NormalizedCatalogRow {
    rowNumber: number;
    /** Stable per-source record identity used to make retries and legacy rows idempotent. */
    sourceRecordKey?: string;
    name: string;
    category: string;
    channelCode: string;
    stockLocationCode: string;
    currencyCode: string;
    specification: string;
    primaryUnit: string;
    purchaseUnit: string;
    packageQuantity: number | null;
    stockOnHand: number | null;
    purchaseCost: number | null;
    sellingPrice: number | null;
    reportedMargin: number | null;
    maximumStock: number | null;
    minimumStock: number | null;
    brand: string;
    manufacturedAt: string | null;
    shelfLifeDays: number | null;
    enabled: boolean | null;
    variantEnabled?: boolean | null;
    description: string;
    tags: string[];
    sourceCreatedAt: string | null;
    sku: string;
    barcode: string;
    lotCode: string;
    lotQuantity: number | null;
    supplier: string;
    /** Names of mapped source columns. Raw source cell values are intentionally not sent. */
    providedFields: string[];
    /**
     * Kept only for the legacy server-side parser tests and historical import rows.
     * The browser client strips this object before any network request.
     */
    raw?: Record<string, string | number | boolean | null>;
}

declare module '@vendure/core/dist/entity/custom-entity-fields' {
    interface CustomProductFields {
        sourceCreatedAt?: Date | null;
    }

    interface CustomProductVariantFields {
        barcode?: string | null;
        specification?: string | null;
        saleUnit?: string | null;
        purchaseUnit?: string | null;
        packageQuantity?: number | null;
        shelfLifeDays?: number | null;
    }
}
