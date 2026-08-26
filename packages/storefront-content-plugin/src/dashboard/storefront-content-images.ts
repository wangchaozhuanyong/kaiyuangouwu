import type { ContentBlock } from './storefront-content.graphql';

export function contentBlockImagePreview(block: ContentBlock): string | null {
    return block.imageAsset?.preview?.trim() || block.imageUrl?.trim() || null;
}

export function contentBlockHasImage(block: ContentBlock): boolean {
    return Boolean(contentBlockImagePreview(block));
}
