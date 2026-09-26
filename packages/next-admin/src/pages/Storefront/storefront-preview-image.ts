import { useEffect, useState } from 'react';

function isLocalAsset(source: string): boolean {
    if (!source || typeof window === 'undefined') return false;
    try {
        const url = new URL(source, window.location.href);
        return url.origin === window.location.origin && /^\/assets\/(preview|source)\//.test(url.pathname);
    } catch {
        return false;
    }
}

async function readPreviewImage(source: string, signal: AbortSignal): Promise<string> {
    const response = await fetch(source, { credentials: 'same-origin', signal });
    if (!response.ok) throw new Error('Preview image unavailable');
    const blob = await response.blob();
    if (!blob.type.startsWith('image/')) throw new Error('Preview response is not an image');
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        const abort = () => reader.abort();
        signal.addEventListener('abort', abort, { once: true });
        reader.onloadend = () => {
            signal.removeEventListener('abort', abort);
            if (signal.aborted || reader.error || typeof reader.result !== 'string') {
                reject(new Error('Preview image read failed'));
            } else {
                resolve(reader.result);
            }
        };
        reader.readAsDataURL(blob);
    });
}

/** Keep the iframe opaque; only the authenticated parent reads its own managed assets. */
export function useSandboxPreviewImage(source: string) {
    const inline = isLocalAsset(source);
    const [result, setResult] = useState<{ source: string; url?: string; error?: boolean }>();
    useEffect(() => {
        if (!inline) return;
        const controller = new AbortController();
        void readPreviewImage(source, controller.signal)
            .then(url => {
                if (!controller.signal.aborted) setResult({ source, url });
            })
            .catch(() => {
                if (!controller.signal.aborted) setResult({ source, error: true });
            });
        return () => controller.abort();
    }, [source, inline]);
    const current = result?.source === source ? result : undefined;
    return {
        url: inline ? current?.url : source,
        inline,
        loading: inline && !current,
        error: inline && Boolean(current?.error),
    };
}
