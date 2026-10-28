/* Local fixture instrumentation only. No production installation or external transmission. */
(() => {
    const query = new URLSearchParams(location.search);
    const samples = [];
    const events = [];
    const shifts = [];
    const longTasks = [];
    const largestPaints = [];
    const errors = [];
    const animationIds = new WeakMap();
    let nextAnimationId = 1;
    let startedAt = Date.now();
    let sampleStarted = 0;
    let stopped = false;
    let sent = false;
    let firstRoot;
    let firstHero;
    let firstTitle;
    let firstCoupon;
    const round = value => Math.round(value * 100) / 100;
    function layoutShiftScore() {
        let max = 0;
        let score = 0;
        let sessionStart = 0;
        let previous = -Infinity;
        for (const entry of shifts.filter(item => !item.hadRecentInput)) {
            if (entry.at - previous > 1000 || entry.at - sessionStart > 5000) {
                score = 0;
                sessionStart = entry.at;
            }
            score += entry.value;
            previous = entry.at;
            max = Math.max(max, score);
        }
        return Math.round(max * 10000) / 10000;
    }
    const visible = node => {
        if (!node || !node.getClientRects().length) return false;
        const style = getComputedStyle(node);
        return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0;
    };
    const box = node => {
        if (!visible(node)) return null;
        const rect = node.getBoundingClientRect();
        return [rect.x, rect.y, rect.width, rect.height].map(round);
    };
    const selectors = {
        header: '.proto-desktop-header, .topbar, .mobile-page-header',
        home: '.home-page',
        intro: '.home-intro-grid',
        hero: '.hero-carousel-stage',
        quick: '.quick-grid',
        coupon: '.coupon-hub-section',
        featured: '.featured-collection-section',
        sales: '[data-home-catalog="sales"]',
        recommended: '[data-home-catalog="recommended"]',
    };
    const firstVisible = selector => [...document.querySelectorAll(selector)].find(visible);
    function sample() {
        const root = document.getElementById('root');
        const hero = firstVisible('.hero-carousel-stage');
        const title = firstVisible('.hero-carousel h1, .hero-carousel h2');
        const coupon = firstVisible('.coupon-hub-section');
        if (root?.hasChildNodes() && !firstRoot) firstRoot = root.firstElementChild;
        if (hero && !firstHero) firstHero = hero;
        if (title && !firstTitle) firstTitle = title;
        if (coupon && !firstCoupon) firstCoupon = coupon;
        return {
            at: round(performance.now()),
            width: innerWidth,
            scrollY: round(scrollY),
            route: location.pathname + location.search,
            historyKey: history.state?.__TSR_key ?? history.state?.key ?? null,
            documentHeight: document.documentElement.scrollHeight,
            appOwned: document.documentElement.hasAttribute('data-storefront-app-owned'),
            readiness: document.querySelector('[data-page-readiness]')?.dataset.pageReadiness ?? null,
            bootVisible: visible(document.getElementById('storefront-boot-loading')),
            bootPresentation:
                document.getElementById('storefront-boot-loading')?.dataset.presentation ?? null,
            rootSame: firstRoot ? root?.firstElementChild === firstRoot : null,
            heroSame: firstHero ? hero === firstHero : null,
            titleSame: firstTitle ? title === firstTitle : null,
            title: title?.textContent?.trim() ?? null,
            queryFeedback: firstVisible('[data-query-feedback="error"]')?.textContent?.trim() ?? null,
            couponPending: firstVisible('.coupon-hub-section')?.getAttribute('aria-busy') ?? null,
            couponPresent: Boolean(coupon),
            couponSame: firstCoupon ? coupon === firstCoupon : null,
            couponPlaceholderCount: document.querySelectorAll(
                '.coupon-hub-placeholder, .coupon-hub-skeleton',
            ).length,
            reveals: document.getAnimations().flatMap(animation => {
                const target = animation.effect?.target;
                if (!(target instanceof Element) || !target.hasAttribute('data-content-reveal')) return [];
                if (!animationIds.has(animation)) animationIds.set(animation, nextAnimationId++);
                return [
                    {
                        id: animationIds.get(animation),
                        state: animation.playState,
                        time: round(Number(animation.currentTime) || 0),
                        duration: animation.effect.getTiming().duration,
                        delay: animation.effect.getTiming().delay,
                        target: target.tagName + '.' + target.className,
                    },
                ];
            }),
            geometry: Object.fromEntries(
                Object.entries(selectors).map(([name, selector]) => [name, box(firstVisible(selector))]),
            ),
            images: [...document.querySelectorAll('.hero-carousel img')].filter(visible).map(node => ({
                complete: node.complete && node.naturalWidth > 0,
                box: box(node),
                opacity: getComputedStyle(node).opacity,
                candidate: new URL(node.currentSrc || node.src, location.href).pathname,
            })),
        };
    }
    function payload() {
        return {
            fixture: 'loading-experience-synthetic-v1',
            label: query.get('qaLabel') || 'manual',
            case: query.get('qaCase') || 'home',
            preset: query.get('qaPreset') || 'classic',
            startedAt,
            sampleStarted,
            navigationType: performance.getEntriesByType('navigation')[0]?.type,
            navigation: Object.fromEntries(
                [
                    'responseStart',
                    'responseEnd',
                    'domInteractive',
                    'domContentLoadedEventEnd',
                    'loadEventEnd',
                ].map(name => [name, round(performance.getEntriesByType('navigation')[0]?.[name] ?? 0)]),
            ),
            viewport: { width: innerWidth, height: innerHeight },
            reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
            samples,
            events,
            shifts,
            longTasks,
            largestPaints,
            errors,
            paints: performance
                .getEntriesByType('paint')
                .map(({ name, startTime }) => ({ name, at: round(startTime) })),
        };
    }
    function finish() {
        if (sent) return;
        sent = true;
        stopped = true;
        const report = payload();
        const summary = {
            samples: samples.length,
            firstContent: samples.find(item => item.geometry.home)?.at ?? null,
            appOwned: samples.find(item => item.appOwned)?.at ?? null,
            cls: layoutShiftScore(),
            longTasks: longTasks.length,
            lcp: largestPaints.at(-1)?.at ?? null,
            errors: errors.length,
            width: innerWidth,
            title: samples.at(-1)?.title,
            rootReplaced: samples.some(item => item.rootSame === false),
            heroReplaced: samples.some(item => item.heroSame === false),
        };
        const body = JSON.stringify(report);
        // Full frame traces exceed sendBeacon's shared 64 KiB queue.
        fetch('/__qa/record', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body,
            keepalive: new Blob([body]).size < 60_000,
        }).catch(() => {});
        parent.postMessage({ type: 'loading-experience-report', summary }, location.origin);
        const node = document.createElement('script');
        node.type = 'application/json';
        node.id = 'loading-experience-summary';
        node.textContent = JSON.stringify(summary);
        document.body.append(node);
    }
    const tick = () => {
        if (stopped) return;
        samples.push(sample());
        if (performance.now() - sampleStarted < 12000 && samples.length < 900) requestAnimationFrame(tick);
        else finish();
    };
    try {
        localStorage.setItem('storefront-analytics-opt-out:v1', '1');
    } catch {}
    for (const type of ['layout-shift', 'longtask', 'largest-contentful-paint']) {
        try {
            new PerformanceObserver(list => {
                for (const entry of list.getEntries()) {
                    if (type === 'layout-shift')
                        shifts.push({
                            at: round(entry.startTime),
                            value: entry.value,
                            hadRecentInput: entry.hadRecentInput,
                        });
                    else if (type === 'longtask')
                        longTasks.push({ at: round(entry.startTime), duration: round(entry.duration) });
                    else
                        largestPaints.push({
                            at: round(entry.startTime),
                            size: entry.size,
                            tag: entry.element?.tagName ?? null,
                        });
                }
            }).observe({ type, buffered: true });
        } catch {}
    }
    for (const name of ['storefront:app-owned', 'storefront:page-ready', 'storefront:page-error'])
        document.addEventListener(name, () => events.push({ type: name, at: round(performance.now()) }));
    addEventListener('popstate', event =>
        events.push({
            type: 'popstate',
            at: round(performance.now()),
            route: location.pathname + location.search,
            historyKey: event.state?.__TSR_key ?? event.state?.key ?? null,
        }),
    );
    addEventListener(
        'scroll',
        () =>
            events.push({
                type: 'scroll',
                at: round(performance.now()),
                route: location.pathname + location.search,
                historyKey: history.state?.__TSR_key ?? history.state?.key ?? null,
                scrollY: round(scrollY),
                viewportHeight: innerHeight,
                documentHeight: document.documentElement.scrollHeight,
            }),
        { passive: true },
    );
    addEventListener('error', event =>
        errors.push({ type: 'error', message: String(event.message || 'Resource error').slice(0, 500) }),
    );
    addEventListener('unhandledrejection', event =>
        errors.push({ type: 'rejection', message: String(event.reason).slice(0, 500) }),
    );
    addEventListener('pagehide', finish, { once: true });
    addEventListener('message', event => {
        if (
            event.origin !== location.origin ||
            event.source !== parent ||
            event.data?.type !== 'start-loading-sample'
        )
            return;
        finish();
        samples.length = 0;
        events.length = 0;
        shifts.length = 0;
        longTasks.length = 0;
        largestPaints.length = 0;
        errors.length = 0;
        firstRoot = firstHero = firstTitle = firstCoupon = undefined;
        startedAt = Date.now();
        sampleStarted = performance.now();
        query.set('qaCase', 'navigation');
        stopped = sent = false;
        requestAnimationFrame(tick);
    });
    requestAnimationFrame(tick);
})();
