import { RequestContext } from '../../api/common/request-context';
import { Product } from '../../entity/product/product.entity';

/** Optional commerce adapter consumed without introducing a plugin dependency cycle. */
export const PUBLIC_PRODUCT_SUMMARY_READER = Symbol.for('vendure.public-product-summary-reader');

export interface PublicProductSummaryAsset {
    id: string;
    preview: string;
}

export interface PublicProductSummary {
    id: string;
    createdAt: string;
    name: string;
    slug: string;
    descriptionSummary: string;
    descriptionSubtitle: string | null;
    warrantyDuration: string | null;
    featuredAsset: PublicProductSummaryAsset | null;
    collections: Array<{ id: string; name: string; slug: string; parentId: string }>;
    customFields: {
        fulfillmentType: 'physical' | 'digital';
        pricingMode: 'FIXED' | 'QUOTE_ONLY' | null;
        refundPolicy: 'MERCHANT_REVIEW' | 'SEVEN_DAY_NO_REASON' | 'NON_REFUNDABLE';
        manualDeliverySlaMinutes: number;
    };
    variants: Array<{
        id: string;
        name: string;
        sku: string;
        priceWithTax: number;
        currencyCode: string;
        saleableStockLevel: number | null;
        autoCardAvailableStock: number | null;
        storeCouponCollectionIds: string[];
        featuredAsset: PublicProductSummaryAsset | null;
        product: { id: string; name: string; featuredAsset: PublicProductSummaryAsset | null };
        customFields: {
            fulfillmentType: 'physical' | 'digital';
            digitalDeliveryMode: 'manual_service' | 'file_download' | 'auto_card' | null;
            digitalStockPolicy: 'pool_derived' | 'limited' | 'unlimited' | null;
        };
    }>;
}

/** Separate from detail/edit DTOs: compact card text, without the gallery or full description. */
export interface PublicProductSummaryReader {
    list(
        ctx: RequestContext,
        input?: {
            take?: number;
            skip?: number;
            collectionId?: string;
            term?: string;
            sort?: 'name-asc' | 'newest';
        },
    ): Promise<{ items: PublicProductSummary[]; totalItems: number }>;
    byId(ctx: RequestContext, id: string): Promise<PublicProductSummary | null>;
    /** Projects products already authorized by a channel-scoped public catalog reader. */
    project(ctx: RequestContext, products: Product[]): Promise<PublicProductSummary[]>;
    detail(ctx: RequestContext, id: string): Promise<PublicProductDetail | null>;
}

export interface PublicProductDetail extends PublicProductSummary {
    description: string;
    assets: PublicProductSummaryAsset[];
    packaging: {
        id: string;
        enabled: boolean;
        autoUnpack: boolean;
        unitLabel: string;
        packageLabel: string;
        unitsPerPackage: number;
        unitVariant: { id: string; name: string; sku: string };
        packageVariant: { id: string; name: string; sku: string };
    } | null;
}
