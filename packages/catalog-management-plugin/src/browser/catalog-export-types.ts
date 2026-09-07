export interface CatalogExportRowRecord {
    productId: string;
    variantId: string;
    productName: string;
    description: string;
    categories: string[];
    importCategory?: string | null;
    fulfillmentType: 'digital' | 'physical';
    channelCode: string;
    brand: string | null;
    tags: string[];
    productEnabled: boolean;
    variantEnabled: boolean;
    systemCreatedAt: string;
    sourceCreatedAt: string | null;
    supplierName: string | null;
    sku: string;
    barcode: string;
    specification: string;
    saleUnit: string;
    purchaseUnit: string;
    packageQuantity: number;
    shelfLifeDays: number | null;
    sellingPrice: number;
    purchaseCostMicrounits: number | null;
    margin: number | null;
    currencyCode: string;
    stockLevels: Array<{
        stockLocationId: string;
        stockLocationName: string;
        stockOnHand: number;
        stockAllocated: number;
        stockAvailable: number;
        minimumStock: number | null;
        maximumStock: number | null;
    }>;
    lots: Array<{
        id: string;
        stockLocationId: string;
        stockLocationName: string;
        lotCode: string;
        manufacturedAt: string | null;
        expiresAt: string | null;
        quantityOnHand: number;
        purchaseCostMicrounits: number | null;
        currencyCode: string;
        state: string;
    }>;
}
