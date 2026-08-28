import { CurrencyCode } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';
import { CustomProductVariantFields } from '@vendure/core/dist/entity/custom-entity-fields';

export type CatalogImportState =
    'PREVIEW_READY' | 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'COMPLETED_WITH_ERRORS' | 'FAILED' | 'ROLLED_BACK';

export type CatalogImportAction = 'CREATE' | 'UPDATE' | 'SKIP_UNCHANGED' | 'CONFLICT' | 'WARNING' | 'ERROR';

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

export interface ResolveCatalogImportRowInput {
    rowId: ID;
    resolution: CatalogImportResolution;
    targetVariantId?: ID | null;
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
}

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
    name: string;
    category: string;
    channelCode: string;
    stockLocationCode: string;
    currencyCode: string;
    specification: string;
    primaryUnit: string;
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
    description: string;
    tags: string[];
    sourceCreatedAt: string | null;
    sku: string;
    barcode: string;
    lotCode: string;
    raw: Record<string, string | number | boolean | null>;
}

declare module '@vendure/core/dist/entity/custom-entity-fields' {
    interface CustomProductVariantFields {
        barcode?: string | null;
        specification?: string | null;
        saleUnit?: string | null;
        purchaseUnit?: string | null;
        packageQuantity?: number | null;
        shelfLifeDays?: number | null;
    }
}
