// Only this application-owned script runs in the opaque-origin mail frame.
const content = document.getElementById('mail-preview-content');
const fit = document.documentElement.dataset.fit === 'true';
let previous = '';
let queued = false;

function reportLayout() {
    queued = false;
    const scale = fit ? Math.min(1, window.innerWidth / Math.max(content.scrollWidth, 1)) : 1;
    content.style.transformOrigin = 'top left';
    content.style.transform = scale < 1 ? `scale(${scale})` : '';
    const height = Math.ceil(content.scrollHeight * scale) + 2;
    const failedImages = document.querySelectorAll('[data-image-failed]').length;
    const result = JSON.stringify({ height, failedImages });
    if (result === previous) return;
    previous = result;
    window.parent.postMessage({ type: 'mail-preview-layout', height, failedImages }, '*');
}

function scheduleLayout() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(reportLayout);
}

for (const image of content.querySelectorAll('img')) {
    image.addEventListener('load', scheduleLayout);
    const failed = () => {
        const fallback = document.createElement('p');
        fallback.dataset.imageFailed = 'true';
        fallback.textContent =
            document.documentElement.lang === 'zh-CN' ? '图片暂时无法加载' : 'Image unavailable';
        image.replaceWith(fallback);
        scheduleLayout();
    };
    image.addEventListener('error', failed, { once: true });
    if (image.complete && image.naturalWidth === 0) failed();
}

new ResizeObserver(scheduleLayout).observe(content);
window.addEventListener('resize', scheduleLayout);
window.addEventListener('load', scheduleLayout);
scheduleLayout();
