/** Decode the actual browser-selected candidate, not a previously seen source URL. */
const decodes = new WeakMap<HTMLImageElement, { identity: string; promise: Promise<void> }>();

export function imageCandidateIdentity(image: HTMLImageElement): string {
    return [image.currentSrc || image.src, image.src, image.srcset, image.sizes].join('\u0000');
}

export function decodeImageElement(image: HTMLImageElement): Promise<void> {
    const identity = imageCandidateIdentity(image);
    const existing = decodes.get(image);
    if (existing?.identity === identity) return existing.promise;
    const promise = (typeof image.decode === 'function' ? image.decode() : Promise.resolve()).then(() => {
        if (imageCandidateIdentity(image) !== identity || !image.complete || image.naturalWidth === 0) {
            throw new Error('Image candidate is not ready');
        }
    });
    decodes.set(image, { identity, promise });
    void promise.catch(() => {
        if (decodes.get(image)?.promise === promise) decodes.delete(image);
    });
    return promise;
}

export const IMAGE_WAIT_EXPIRED_EVENT = 'storefront-image-wait-expired';

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
