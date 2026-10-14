/** Decode the actual browser-selected candidate, not a previously seen source URL. */
const decodes = new WeakMap<HTMLImageElement, { identity: string; promise: Promise<void> }>();

export function imageCandidateIdentity(image: HTMLImageElement): string {
    return [image.currentSrc || image.src, image.src, image.srcset, image.sizes].join('\u0000');
}

/** Verify this node's pixels, including a direct source replaced before currentSrc updates. */
export function isImageCandidateComplete(image: HTMLImageElement): boolean {
    if (!image.complete || image.naturalWidth <= 0) return false;
    if (!image.srcset && !image.closest('picture')?.querySelector('source')) {
        return !image.currentSrc || image.currentSrc === image.src;
    }
    return true;
}

export function decodeImageElement(image: HTMLImageElement): Promise<void> {
    const identity = imageCandidateIdentity(image);
    const requestIdentity = [image.src, image.srcset, image.sizes].join('\u0000');
    const selectedCandidate = isImageCandidateComplete(image);
    const existing = decodes.get(image);
    if (existing?.identity === identity) return existing.promise;
    let decoded: Promise<void>;
    try {
        decoded = typeof image.decode === 'function' ? image.decode() : Promise.resolve();
    } catch (error) {
        decoded = Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    const promise = decoded.then(() => {
        if (
            [image.src, image.srcset, image.sizes].join('\u0000') !== requestIdentity ||
            (selectedCandidate && imageCandidateIdentity(image) !== identity) ||
            !isImageCandidateComplete(image)
        )
            throw new Error('Image candidate is not ready');
    });
    decodes.set(image, { identity, promise });
    void promise.catch(() => {
        if (decodes.get(image)?.promise === promise) decodes.delete(image);
    });
    return promise;
}

export const IMAGE_WAIT_EXPIRED_EVENT = 'storefront-image-wait-expired';
export const IMAGE_REQUEST_TIMEOUT_MS = 15_000;

/** Cancel the image and any shared preload which still holds the document load open. */
export function cancelPendingImage(image: HTMLImageElement): void {
    const candidates = new Set([image.src, image.currentSrc].filter(Boolean));
    for (const hint of document.querySelectorAll<HTMLLinkElement>('link[rel="preload"][as="image"]')) {
        if (
            candidates.has(hint.href) ||
            (image.srcset && hint.getAttribute('imagesrcset') === image.srcset)
        ) {
            hint.removeAttribute('imagesrcset');
            hint.removeAttribute('href');
            hint.remove();
        }
    }
    image.removeAttribute('srcset');
    image.removeAttribute('src');
}

/** Hidden slides and offscreen media must never hold up the current viewport. */
export function isFirstViewportElement(element: Element, root: Element): boolean {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.right <= 0) return false;
    if (rect.top >= window.innerHeight || rect.left >= window.innerWidth) return false;
    for (let node: Element | null = element; node && node !== root; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (
            node.hasAttribute('hidden') ||
            node.getAttribute('aria-hidden') === 'true' ||
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            style.opacity === '0'
        )
            return false;
    }
    return true;
}
