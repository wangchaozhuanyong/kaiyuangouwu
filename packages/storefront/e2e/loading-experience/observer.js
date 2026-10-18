// Local fixture instrumentation only; never included in storefront production assets.
const initialLoadingMetrics = () => ({
    url: location.href,
    start: 0,
    samples: [],
    shifts: [],
    inputs: [],
    firstImage: null,
});
window.__loadingQA = initialLoadingMetrics();
new PerformanceObserver(list => {
    for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput && entry.startTime >= window.__loadingQA.start)
            window.__loadingQA.shifts.push({ t: entry.startTime, value: entry.value });
    }
}).observe({ type: 'layout-shift', buffered: true });
addEventListener('pointerdown', () => {
    const start = performance.now();
    requestAnimationFrame(() => window.__loadingQA.inputs.push(performance.now() - start));
});
function sampleLoading() {
    if (window.__loadingQA.url !== location.href)
        window.__loadingQA = { ...initialLoadingMetrics(), start: performance.now() };
    const qa = window.__loadingQA;
    const product = document.querySelector(
        '.featured-collection-section, .category-product-list, .product-detail',
    );
    const coupon = document.querySelector('.coupon-hub-section');
    const selector = location.pathname.includes('/product')
        ? '.detail-gallery img.safe-image'
        : location.pathname.includes('/category')
          ? '.category-product-list img.safe-image'
          : '.hero img.safe-image';
    const image = [...document.querySelectorAll(selector)].find(
        image =>
            image.complete &&
            image.naturalWidth &&
            image.getBoundingClientRect().top < innerHeight &&
            image.getBoundingClientRect().bottom > 0,
    );
    if (image && qa.firstImage === null) qa.firstImage = performance.now() - qa.start;
    const state = {
        product: product?.getBoundingClientRect().top,
        coupon: coupon?.getBoundingClientRect().height,
        couponState: document.querySelector('[data-coupon-state]')?.getAttribute('data-coupon-state'),
        row: document.querySelector('.product-card-skeleton')?.getBoundingClientRect().height,
        media: [...document.querySelectorAll('.detail-gallery img.safe-image, .hero img.safe-image')].map(
            image => ({
                src: image.currentSrc || image.src,
                ready: image.complete && image.naturalWidth > 0,
                opacity: getComputedStyle(image).opacity,
                backing: image.closest('.safe-image-frame')?.querySelector('.safe-image-fallback')?.style
                    .backgroundImage,
            }),
        ),
    };
    if (JSON.stringify(state) !== JSON.stringify(qa.samples.at(-1)?.state))
        qa.samples.push({ t: performance.now() - qa.start, state });
    if (document.body) {
        let output = document.getElementById('loading-qa-metrics');
        if (!output) {
            output = document.createElement('script');
            output.type = 'application/json';
            output.id = 'loading-qa-metrics';
            document.body.append(output);
        }
        const serialized = JSON.stringify(qa);
        if (output.textContent !== serialized) output.textContent = serialized;
    }
    requestAnimationFrame(sampleLoading);
}
requestAnimationFrame(sampleLoading);
