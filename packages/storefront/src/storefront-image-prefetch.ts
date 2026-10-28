import { decodeImageElement, IMAGE_REQUEST_TIMEOUT_MS } from './image-readiness';
import { imageSources, type StorefrontImageKind } from './responsive-image';

export function shouldPrefetchMedia(): boolean {
    if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
    const connection = (
        navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }
    ).connection;
    return !connection?.saveData && !['slow-2g', '2g'].includes(connection?.effectiveType ?? '');
}

export async function decodeStorefrontImage(
    src: string,
    imageKind: StorefrontImageKind,
    sizes?: string,
    options: {
        signal?: AbortSignal;
        priority?: 'low' | 'high';
        onCreate?: (image: HTMLImageElement) => void;
    } = {},
): Promise<void> {
    const { signal, priority = 'low' } = options;
    const aborted = () => new DOMException('Image preparation cancelled', 'AbortError');
    if (signal?.aborted) throw aborted();
    const sources = imageSources(src, imageKind, sizes);
    const image = new Image();
    image.fetchPriority = priority;
    options.onCreate?.(image);
    if (sources.srcSet) image.srcset = sources.srcSet;
    if (sources.sizes) image.sizes = sources.sizes;
    image.src = sources.src;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancel: (() => void) | undefined;
    const release = () => {
        image.removeAttribute('srcset');
        image.removeAttribute('src');
    };
    try {
        await Promise.race([
            decodeImageElement(image),
            new Promise<never>((_, reject) => {
                cancel = () => {
                    release();
                    reject(aborted());
                };
                signal?.addEventListener('abort', cancel, { once: true });
                timer = setTimeout(() => {
                    release();
                    reject(new Error('Image preparation timed out'));
                }, IMAGE_REQUEST_TIMEOUT_MS);
            }),
        ]);
    } finally {
        clearTimeout(timer);
        if (cancel) signal?.removeEventListener('abort', cancel);
    }
}

const pending = new Set<string>();
const recent = new Map<string, number>();
const queue: Array<{ key: string; load: () => Promise<void> }> = [];
let active = 0;
let waitingForPage = false;

function drain() {
    if (document.querySelector('[data-page-readiness="preparing"], [data-page-readiness="error"]')) {
        if (!waitingForPage) {
            waitingForPage = true;
            document.addEventListener(
                'storefront:page-ready',
                () => {
                    waitingForPage = false;
                    drain();
                },
                { once: true },
            );
        }
        return;
    }
    while (active < 2 && queue.length) {
        const task = queue.shift();
        if (!task) break;
        if (!shouldPrefetchMedia()) {
            pending.delete(task.key);
            continue;
        }
        active++;
        void task
            .load()
            .then(
                () => {
                    if (recent.size >= 128) {
                        const oldest = recent.keys().next().value;
                        if (oldest) recent.delete(oldest);
                    }
                    recent.set(task.key, Date.now());
                },
                () => undefined,
            )
            .finally(() => {
                pending.delete(task.key);
                active--;
                drain();
            });
    }
}

/** Speculation shares a small queue; visible images keep the browser's normal loading path. */
export function prefetchStorefrontImage(src: string, kind: StorefrontImageKind, sizes?: string): void {
    if (!shouldPrefetchMedia()) return;
    const media = imageSources(src, kind, sizes);
    let key: string;
    try {
        key = JSON.stringify([
            new URL(media.src, window.location.href).href,
            media.srcSet?.split(', ').map(candidate => {
                const [url, width] = candidate.split(' ');
                return `${new URL(url, window.location.href).href} ${width}`;
            }),
            media.sizes,
            window.innerWidth,
            window.devicePixelRatio,
        ]);
    } catch {
        return;
    }
    const completedAt = recent.get(key);
    if (
        pending.has(key) ||
        (completedAt !== undefined && Date.now() - completedAt < 30_000) ||
        queue.length >= 16
    )
        return;
    pending.add(key);
    queue.push({ key, load: () => decodeStorefrontImage(src, kind, sizes) });
    drain();
}
