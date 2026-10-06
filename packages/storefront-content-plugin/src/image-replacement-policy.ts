/** Shared by the content API and editors: appearance changes do not authorize replacing images. */
export interface ImageBinding {
    imageAsset?: { id: string | number } | null;
    imageAssetId?: string | number | null;
    imageUrl?: string | null;
    settings?: Record<string, unknown> | null;
}

interface ImageItem extends ImageBinding {
    id?: string | number | null;
    position?: number;
}

export interface ImageReplacement {
    slot: string;
    before: string;
    after: string | null;
}

export function imageBindingKey(value: ImageBinding, previous?: ImageBinding): string | null {
    const assetId = value.imageAsset?.id ?? value.imageAssetId;
    const effectiveAsset =
        assetId === undefined ? (previous?.imageAsset?.id ?? previous?.imageAssetId) : assetId;
    if (effectiveAsset != null) return `asset:${String(effectiveAsset)}`;
    const url =
        value.imageUrl === undefined ? (assetId === null ? null : previous?.imageUrl) : value.imageUrl;
    return url?.trim() || null;
}

export function imageReplacements(
    previous: ImageBinding & { items?: readonly ImageItem[] | null },
    patch: ImageBinding & { items?: readonly ImageItem[] | null },
): ImageReplacement[] {
    const changes: ImageReplacement[] = [];
    const check = (slot: string, before: ImageBinding, after: ImageBinding | null) => {
        const oldKey = imageBindingKey(before);
        const newKey = after ? imageBindingKey(after, before) : null;
        if (oldKey && oldKey !== newKey) changes.push({ slot, before: oldKey, after: newKey });
    };
    check('main', previous, patch);
    if (patch.settings !== undefined) {
        const decoration = (value: ImageBinding) => ({
            imageAssetId:
                typeof value.settings?.mobileDecorationImageAssetId === 'string'
                    ? value.settings.mobileDecorationImageAssetId
                    : null,
            imageUrl:
                typeof value.settings?.mobileDecorationImageUrl === 'string'
                    ? value.settings.mobileDecorationImageUrl
                    : null,
        });
        const before = decoration(previous);
        const after = decoration(patch);
        // Settings are replaced as a whole, so clearing an existing binding needs review too.
        check('mobile-decoration', before, {
            imageAssetId: after.imageAssetId ?? null,
            imageUrl: after.imageUrl ?? null,
        });
        const mobileHero = (value: ImageBinding) => ({
            imageAssetId:
                typeof value.settings?.mobileImageAssetId === 'string'
                    ? value.settings.mobileImageAssetId
                    : null,
            imageUrl:
                typeof value.settings?.mobileImageUrl === 'string' ? value.settings.mobileImageUrl : null,
        });
        check('mobile-hero', mobileHero(previous), mobileHero(patch));
    }

    if (patch.items != null) {
        for (const item of previous.items ?? []) {
            // Persisted identity survives reordering. Position is never an ownership key.
            const next = patch.items.find(
                candidate => item.id != null && String(candidate.id) === String(item.id),
            );
            check(`item:${String(item.id)}`, item, next ?? null);
        }
    }
    return changes;
}

/** Source editors also cover image attributes, CSS backgrounds and Markdown images. */
export function sourceImageReferences(source: string): string[] {
    const references: string[] = [];
    const html = source.replace(/<!--[\s\S]*?-->/g, '');
    for (const match of html.matchAll(
        /\b(?:src|poster|data-bind-src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    )) {
        references.push(match[1] ?? match[2] ?? match[3]);
    }
    for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
        if (
            !/\b(?:property|name|itemprop)\s*=\s*(?:["'](?:og:image|twitter:image|image)["']|(?:og:image|twitter:image|image)(?=\s|>))/i.test(
                tag,
            )
        )
            continue;
        const content = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
        if (content) references.push(content[1] ?? content[2] ?? content[3]);
    }
    for (const match of html.matchAll(/\bsrcset\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
        references.push(...(match[1] ?? match[2]).split(',').map(value => value.trim().split(/\s+/)[0]));
    }
    for (const match of html.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]+))\s*\)/gi)) {
        references.push(match[1] ?? match[2] ?? match[3]);
    }
    for (const match of html.matchAll(/!\[[^\]]*\]\(\s*(\S+?)(?:\s+["'][^)]*)?\s*\)/g))
        references.push(match[1]);
    return references.filter(Boolean).map(value => value.replace(/&amp;/g, '&').trim());
}

export function sourceImageReplacements(previous: string, next: string): ImageReplacement[] {
    // Comparing counts also protects duplicate placements; ordinary reordering is harmless.
    const remaining = sourceImageReferences(next);
    const removed = sourceImageReferences(previous).flatMap((before, index) => {
        const retained = remaining.indexOf(before);
        if (retained >= 0) {
            remaining.splice(retained, 1);
            return [];
        }
        return [{ slot: `source:${index}`, before, after: null }];
    });
    return removed.map((change, index) => ({ ...change, after: remaining[index] ?? null }));
}
