import { gql, type DocumentNode } from '@apollo/client';

export type CatalogReferenceState = 'available' | 'unavailable' | 'unknown';
export interface CatalogReferenceEntity {
    id: string;
    name: string;
    enabled?: boolean;
    sku?: string;
    slug?: string;
    product?: { id: string; name: string; enabled?: boolean };
    customFields?: { fulfillmentType?: string; digitalDeliveryMode?: string };
    channels?: Array<{ id: string; code: string; displayName: string; isDefault: boolean }>;
    variants?: Array<{
        id: string;
        name: string;
        enabled?: boolean;
        priceWithTax: number;
        currencyCode: string;
    }>;
}
export interface CatalogReference {
    id: string;
    state: CatalogReferenceState;
    entity?: CatalogReferenceEntity;
}
export type CatalogReferenceResult = Record<
    string,
    { items: CatalogReferenceEntity[]; totalItems: number } | undefined
>;

const documents = new Map<string, DocumentNode>();
const BATCH_SIZE = 100;

/** Resolve the complete saved identity list, independently of search and pagination. */
export type CatalogReferenceKind = 'products' | 'productVariants' | 'catalogProductChannelAssignments';
export function catalogReferenceRequest(
    ids: readonly string[],
    kind: CatalogReferenceKind,
    includeVariants = false,
) {
    const unique = [...new Set(ids.filter(Boolean))];
    const batches: string[][] = [];
    for (let offset = 0; offset < unique.length; offset += BATCH_SIZE)
        batches.push(unique.slice(offset, offset + BATCH_SIZE));
    const count = Math.max(1, batches.length);
    const key = `${kind}:${count}:${includeVariants}`;
    let document = documents.get(key);
    if (!document) {
        const fields =
            kind === 'products'
                ? `id name slug enabled${includeVariants ? ' variants { id name enabled priceWithTax currencyCode }' : ''}`
                : kind === 'productVariants'
                  ? 'id name sku enabled product { id name enabled } customFields { fulfillmentType digitalDeliveryMode }'
                  : 'id name enabled channels { id code displayName isDefault }';
        const variables = Array.from({ length: count }, (_, index) => `$ids${index}: [ID!]!`).join(', ');
        const selections = Array.from(
            { length: count },
            (_, index) =>
                `batch${index}: ${kind}(options: { take: 100, filter: { id: { in: $ids${index} } } }) { totalItems items { ${fields} } }`,
        ).join('\n');
        document = gql(`query NextAdminCatalogReferences(${variables}) { ${selections} }`);
        documents.set(key, document);
    }
    return {
        document,
        batches,
        variables: Object.fromEntries(
            Array.from({ length: count }, (_, index) => [`ids${index}`, batches[index] ?? []]),
        ),
    };
}

export function resolveCatalogReferences(
    batches: readonly string[][],
    result: CatalogReferenceResult | undefined,
    failed: boolean | readonly string[] = false,
): CatalogReference[] {
    return batches.flatMap((ids, index) => {
        const batch = result?.[`batch${index}`];
        const batchFailed = failed === true || (Array.isArray(failed) && failed.includes(`batch${index}`));
        const complete =
            !batchFailed && batch && Array.isArray(batch.items) && batch.items.length === batch.totalItems;
        return ids.map(id => {
            const entity = batch?.items.find(item => item.id === id);
            const state: CatalogReferenceState = !complete
                ? 'unknown'
                : entity && entity.enabled !== false && entity.product?.enabled !== false
                  ? 'available'
                  : 'unavailable';
            return { id, state, ...(entity ? { entity } : {}) };
        });
    });
}
