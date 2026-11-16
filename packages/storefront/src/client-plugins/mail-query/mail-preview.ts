import { filterXSS, getDefaultWhiteList } from 'xss';

import runtimeUrl from './mail-preview-runtime.js?url&no-inline';

const allowedTags = Object.fromEntries(
    Object.entries(getDefaultWhiteList()).map(([tag, attributes]) => [
        tag,
        [...(attributes ?? []), 'style', 'class', 'align', 'valign', 'dir', 'width', 'height', 'bgcolor'],
    ]),
);

export function createMailPreview(
    source: string,
    { showImages, fit, isZh }: { showImages: boolean; fit: boolean; isZh: boolean },
): { html: string; hasRemoteImages: boolean } {
    // Re-sanitize historical and hosted mail before replacing its old preview policy.
    const clean = filterXSS(source, {
        allowList: {
            ...allowedTags,
            style: [],
            img: ['src', 'alt', 'title', 'style', 'width', 'height'],
            a: ['href', 'title'],
        },
        css: false,
        stripIgnoreTag: true,
        stripIgnoreTagBody: ['script', 'iframe', 'object', 'embed', 'svg', 'math', 'template'],
    });
    const document = new DOMParser().parseFromString(clean, 'text/html');
    let hasRemoteImages = /url\(\s*['"]?(?:https?:)?\/\//i.test(
        [...document.querySelectorAll('style, [style]')]
            .map(element =>
                element.tagName === 'STYLE' ? element.textContent : element.getAttribute('style'),
            )
            .join(' '),
    );
    for (const image of document.querySelectorAll('img')) {
        const src = (image.getAttribute('src') ?? '')
            .replace(/^http:/i, 'https:')
            .replace(/^\/\//, 'https://');
        image.setAttribute('src', src);
        const remote = /^(?:https?:)?\/\//i.test(src);
        hasRemoteImages ||= remote;
        image.setAttribute('referrerpolicy', 'no-referrer');
        image.style.setProperty('max-width', '100%', 'important');
        image.style.setProperty('height', 'auto', 'important');
        image.style.setProperty('min-width', '0', 'important');
        if (remote && !showImages) {
            const placeholder = document.createElement('p');
            placeholder.textContent = isZh
                ? '显示邮件图片后可查看此图'
                : 'Show email images to view this image';
            image.replaceWith(placeholder);
        } else if (!/^(?:https:\/\/|data:image\/)/i.test(src)) {
            const placeholder = document.createElement('p');
            placeholder.dataset.imageFailed = 'true';
            placeholder.textContent = isZh ? '图片地址不可用' : 'Image address unavailable';
            image.replaceWith(placeholder);
        }
    }
    for (const link of document.querySelectorAll('a')) {
        if (!/^(?:https?:\/\/|mailto:)/i.test(link.getAttribute('href') ?? '')) link.removeAttribute('href');
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener noreferrer nofollow');
    }
    const script = new URL(runtimeUrl, window.location.href).href;
    const policy = [
        "default-src 'none'",
        `script-src ${script}`,
        `img-src data:${showImages ? ' https:' : ''}`,
        "style-src 'unsafe-inline'",
        "base-uri 'none'",
        "form-action 'none'",
        "connect-src 'none'",
    ].join('; ');
    const styles = `
        html,body { margin:0; padding:0; }
        html { overflow-y:hidden; overflow-x:${fit ? 'hidden' : 'auto'}; }
        body { overflow-wrap:anywhere; font-family:system-ui,sans-serif; }
        #mail-preview-content { display:flow-root; min-width:0; }
        img { max-width:100% !important; height:auto !important; }
        table { max-width:100%; }
        pre { white-space:pre-wrap; }
        [data-image-failed] { padding:16px; border:1px solid #ddd; }
    `;
    // Only the fixed script URL is executable. Sender scripts/handlers are removed,
    // and the sandbox never grants same-origin access to the shop or its credentials.
    return {
        hasRemoteImages,
        html: `<!doctype html><html lang="${isZh ? 'zh-CN' : 'en'}" data-fit="${fit}">
<head><meta charset="utf-8"><meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="${policy}">
${document.head.innerHTML}<style>${styles}</style></head>
<body><div id="mail-preview-content">${document.body.innerHTML}</div>
<script src="${script}"></script></body></html>`,
    };
}
