export const DEFAULT_PRODUCT_ASSIGNMENT_BATCH_SIZE = 50;
export const DEFAULT_PRODUCT_ID_PAGE_SIZE = 100;

export interface ProductIdPage {
    items: Array<{ id: string }>;
    totalItems: number;
}

export interface FetchProductIdsProgress {
    fetched: number;
    total: number;
}

export interface AssignProductBatchesProgress {
    completed: number;
    total: number;
}

export interface AssignProductBatchFailure {
    channelId: string;
    productIds: string[];
    reason: unknown;
}

export interface AssignProductBatchesResult {
    completedAssignments: number;
    failedAssignments: number;
    failures: AssignProductBatchFailure[];
}

export function isAssignAllProductsAvailable(
    activeChannel: { id: string; code: string } | undefined,
    channels: Array<{ id: string }>,
    defaultChannelCode: string,
): boolean {
    return (
        activeChannel?.code === defaultChannelCode &&
        channels.some(channel => channel.id !== activeChannel.id)
    );
}

/**
 * Loads every product ID using bounded requests. Offset pagination is stable for this workflow because
 * channel assignment does not change which products belong to the source (default) channel.
 */
export async function fetchAllProductIds(
    fetchPage: (variables: { skip: number; take: number }) => Promise<ProductIdPage>,
    onProgress?: (progress: FetchProductIdsProgress) => void,
    pageSize = DEFAULT_PRODUCT_ID_PAGE_SIZE,
): Promise<string[]> {
    const productIds: string[] = [];
    let totalItems = Number.POSITIVE_INFINITY;

    while (productIds.length < totalItems) {
        const page = await fetchPage({ skip: productIds.length, take: pageSize });
        totalItems = page.totalItems;
        productIds.push(...page.items.map(item => item.id));
        onProgress?.({ fetched: productIds.length, total: totalItems });

        if (page.items.length === 0) {
            break;
        }
    }

    return productIds;
}

/**
 * Assigns products sequentially in bounded batches. Sequential writes avoid competing relation updates and
 * overlapping search-index work on the same products. Failures are isolated to one target store and batch so
 * the remaining work can continue.
 */
export async function assignProductBatchesToChannels({
    productIds,
    channelIds,
    priceFactor,
    mutationFn,
    onProgress,
    batchSize = DEFAULT_PRODUCT_ASSIGNMENT_BATCH_SIZE,
}: {
    productIds: string[];
    channelIds: string[];
    priceFactor: number;
    mutationFn: (variables: {
        input: { productIds: string[]; channelId: string; priceFactor: number };
    }) => Promise<unknown>;
    onProgress?: (progress: AssignProductBatchesProgress) => void;
    batchSize?: number;
}): Promise<AssignProductBatchesResult> {
    const total = productIds.length * channelIds.length;
    let completed = 0;
    let completedAssignments = 0;
    const failures: AssignProductBatchFailure[] = [];

    for (const channelId of channelIds) {
        for (let index = 0; index < productIds.length; index += batchSize) {
            const batch = productIds.slice(index, index + batchSize);
            try {
                await mutationFn({ input: { productIds: batch, channelId, priceFactor } });
                completedAssignments += batch.length;
            } catch (reason) {
                failures.push({ channelId, productIds: batch, reason });
            }
            completed += batch.length;
            onProgress?.({ completed, total });
        }
    }

    return {
        completedAssignments,
        failedAssignments: total - completedAssignments,
        failures,
    };
}
