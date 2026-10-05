export interface CatalogDataPlanAdapter {
    query(sql: string): Promise<Array<Record<string, unknown>>>;
    tableExists(table: string): Promise<boolean>;
    columnExists?(table: string, column: string): Promise<boolean>;
}

export type CatalogResourceType =
    | 'Product'
    | 'Collection'
    | 'ProductOptionGroup'
    | 'ProductOption'
    | 'Facet'
    | 'FacetValue'
    | 'Asset'
    | 'Tag';

export interface CatalogOwnershipMapping {
    resourceType: CatalogResourceType;
    resourceId: string | number;
    ownerChannelId: string | number;
    evidence: string;
}

export interface PlatformCatalogDataPlan {
    schema: 'vendure-platform-catalog-data-plan-v2';
    mode: 'READ_ONLY';
    productionApply: false;
    defaultChannelId: string;
    snapshotHash: string;
    resources: Array<{
        resourceType: CatalogResourceType;
        resourceId: string;
        status: string;
        [key: string]: unknown;
    }>;
    referenceEvidence: unknown;
    safeguards: string[];
    validation: {
        ownershipMapping: string;
        governanceMetadata: {
            ownership: 'DATA_MISSING' | 'READ';
            sales: 'DATA_MISSING' | 'READ';
        };
        dataMissing: CatalogResourceType[];
    };
}

export declare function collectPlatformCatalogDataPlan(
    adapter: CatalogDataPlanAdapter,
    mapping?: CatalogOwnershipMapping[],
): Promise<PlatformCatalogDataPlan>;
