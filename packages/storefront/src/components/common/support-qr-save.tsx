import { useEffect, useRef, useState } from 'react';

import { StorefrontLanguage } from '../../types';

const imageExtensions: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/avif': 'avif',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
};

/** Prepare the original QR file before a click, preserving Web Share's user activation. */
export function SupportQrSave({ imageUrl, language }: { imageUrl: string; language: StorefrontLanguage }) {
    const isZh = language === 'zh';
    const [file, setFile] = useState<File | null>(null);
    const [state, setState] = useState<'preparing' | 'ready' | 'failed' | 'sharing'>('preparing');
    const [attempt, setAttempt] = useState(0);
    const [message, setMessage] = useState('');
    const sharing = useRef(false);
    const alive = useRef(true);
    const [mobile] = useState(
        () =>
            typeof window !== 'undefined' &&
            (navigator.maxTouchPoints > 0 || window.matchMedia?.('(pointer: coarse)').matches) &&
            window.innerWidth < 1024,
    );

    useEffect(() => {
        alive.current = true;
        let active = true;
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 15_000);
        setState('preparing');
        setFile(null);
        setMessage('');
        void fetch(imageUrl, { signal: controller.signal, credentials: 'same-origin' })
            .then(async response => {
                if (!response.ok) throw new Error('QR image is not available');
                const blob = await response.blob();
                const mime = blob.type.toLowerCase().split(';', 1)[0];
                const extension = imageExtensions[mime];
                if (!blob.size || !extension) throw new Error('QR response is not an image');
                if (!active) return;
                setFile(new File([blob], `support-qr.${extension}`, { type: mime }));
                setState('ready');
            })
            .catch(() => {
                if (active) setState('failed');
            })
            .finally(() => window.clearTimeout(timeout));
        return () => {
            active = false;
            alive.current = false;
            controller.abort();
            window.clearTimeout(timeout);
        };
    }, [imageUrl, attempt]);

    let canShare = false;
    if (mobile && file && typeof navigator.share === 'function' && typeof navigator.canShare === 'function') {
        try {
            canShare = navigator.canShare({ files: [file] });
        } catch {
            // Unsupported file sharing keeps the native long-press preview available.
        }
    }
    const save = () => {
        if (!file || sharing.current) return;
        if (mobile) {
            if (!canShare) return;
            sharing.current = true;
            setState('sharing');
            // Call directly in this gesture. Preparing/fetching here would lose user activation.
            void navigator
                .share({ files: [file] })
                .then(() => {
                    if (alive.current)
                        setMessage(isZh ? '系统分享流程已结束' : 'System sharing has finished');
                })
                .catch(error => {
                    if (!alive.current) return;
                    setMessage(
                        typeof error === 'object' &&
                            error !== null &&
                            'name' in error &&
                            error.name === 'AbortError'
                            ? isZh
                                ? '分享已关闭，可长按二维码保存'
                                : 'Share closed. Touch and hold the code to save it.'
                            : isZh
                              ? '无法打开系统分享，可长按二维码保存或重试'
                              : 'Sharing is unavailable. Touch and hold the code, or try again.',
                    );
                })
                .finally(() => {
                    sharing.current = false;
                    if (alive.current) setState('ready');
                });
            return;
        }
        const url = URL.createObjectURL(file);
        const link = document.createElement('a');
        link.href = url;
        link.download = file.name;
        link.hidden = true;
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        setMessage(isZh ? '图片下载已开始' : 'Image download started');
    };

    return (
        <div className="support-qr-save-actions">
            {state === 'failed' ? (
                <>
                    <p role="status">
                        {isZh
                            ? '图片暂时无法准备，预览仍可长按保存。'
                            : 'The file could not be prepared. You can still touch and hold the preview.'}
                    </p>
                    <button
                        className="support-qr-save"
                        type="button"
                        onClick={() => setAttempt(value => value + 1)}
                    >
                        {isZh ? '重新准备图片' : 'Try again'}
                    </button>
                </>
            ) : !mobile || canShare || state === 'preparing' ? (
                <button className="support-qr-save" type="button" disabled={state !== 'ready'} onClick={save}>
                    {state === 'preparing'
                        ? isZh
                            ? '正在准备图片'
                            : 'Preparing image'
                        : state === 'sharing'
                          ? isZh
                              ? '正在打开系统分享'
                              : 'Opening system share'
                          : mobile
                            ? isZh
                                ? '打开系统分享'
                                : 'Open system share'
                            : isZh
                              ? '下载二维码图片'
                              : 'Download QR image'}
                </button>
            ) : null}
            <span className="support-qr-save-result" role="status" aria-live="polite">
                {message}
            </span>
        </div>
    );
}
