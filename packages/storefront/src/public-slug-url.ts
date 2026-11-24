import { type StorefrontPageData } from '../../storefront-content-plugin/src/shared/public-page-data';

type SnapshotView = Pick<StorefrontPageData, 'product' | 'collections'>;

interface NavigationNode {
    id?: string;
    slug?: string;
    children?: NavigationNode[] | null;
}

function findCollection(nodes: readonly NavigationNode[], slug: string): string | null {
    for (const node of nodes) {
        if (node.slug === slug && node.id) return node.id;
        const child = findCollection(node.children ?? [], slug);
        if (child) return child;
    }
    return null;
}

/**
 * Slug URLs are the canonical shape crawlers index. The client keeps its existing id routes,
 * so a direct slug visit is adopted back to the id URL before the router starts.
 * Returns null when the slug is not the page that was rendered.
 */
export function slugUrlTarget(pathname: string, snapshot: SnapshotView | null | undefined): string | null {
    const match = /^\/(?:zh|en)\/(p|c)\/([^/?#]+)\/?$/u.exec(pathname);
    if (!match || !snapshot) return null;
    const language = pathname.slice(1, 3);
    let slug: string;
    try {
        slug = decodeURIComponent(match[2]);
    } catch {
        return null;
    }
    if (match[1] === 'p') {
        const product = snapshot.product as { id?: string; slug?: string } | null | undefined;
        return product?.id && product.slug === slug
            ? `/${language}/product?id=${encodeURIComponent(product.id)}`
            : null;
    }
    const collectionId = findCollection((snapshot.collections ?? []) as NavigationNode[], slug);
    return collectionId ? `/${language}/category?collectionId=${encodeURIComponent(collectionId)}` : null;
}
