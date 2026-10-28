/* Local synthetic instrumentation. DOM evidence is not proof of physical pixels. */
(() => {
    const query = new URLSearchParams(location.search);
    const mode = query.get('qaMode') === 'geometry' ? 'geometry' : 'performance';
    const duration = mode === 'performance' && query.get('qaDuration') === '30000' ? 30000 : 12000;
    const samples = [],
        events = [],
        shifts = [],
        longTasks = [],
        largestPaints = [],
        errors = [];
    const resources = [],
        inputs = [],
        imageHistory = [],
        markers = [];
    const observerSupport = {};
    const ids = new WeakMap(),
        animationIds = new WeakMap();
    let imageStates = new WeakMap();
    let nextId = 1,
        nextAnimationId = 1,
        nextInputId = 1;
    let startedAt = Date.now(),
        sampleStarted = 0,
        stopped = false,
        sent = false,
        scheduled;
    let firstRoot, firstHero, firstTitle, firstCoupon, activeInput;
    let appOwnedAtDocumentTime = null;
    const round = value => Math.round(value * 100) / 100;
    const now = () => round(performance.now());
    const append = (list, value, limit = 500) => {
        if (list.length < limit) list.push(value);
    };
    const id = node => {
        if (!node) return null;
        if (!ids.has(node)) ids.set(node, nextId++);
        return ids.get(node);
    };
    const publicPath = value => {
        if (!value) return '';
        try {
            const url = new URL(value, location.href);
            if (url.origin !== location.origin) return '[external]';
            const allowed = new URLSearchParams();
            for (const key of ['preset', 'format', 'q', 'w', 'h'])
                if (url.searchParams.has(key)) allowed.set(key, url.searchParams.get(key));
            return url.pathname + (allowed.size ? '?' + allowed : '');
        } catch {
            return '';
        }
    };
    const publicSrcset = value =>
        (value || '')
            .split(',')
            .map(entry => {
                const [source, ...size] = entry.trim().split(/\s+/u);
                return [publicPath(source), ...size].filter(Boolean).join(' ');
            })
            .filter(Boolean)
            .join(', ');
    const routePath = () => {
        const params = new URLSearchParams(location.search);
        const selected = new URLSearchParams();
        for (const key of ['id', 'collectionId', 'page'])
            if (params.has(key)) selected.set(key, params.get(key));
        return location.pathname + (selected.size ? '?' + selected : '');
    };
    const storageKey = 'local-loading-qa:departure:' + location.pathname;
    let previousDeparture = null;
    try {
        previousDeparture = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
    } catch {}
    const initialScrollY = scrollY;
    const visible = node => {
        if (!node || !node.getClientRects().length) return false;
        const style = getComputedStyle(node);
        return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0;
    };
    const firstVisible = selector => [...document.querySelectorAll(selector)].find(visible);
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
    const imageSelector =
        '.hero-carousel img.safe-image, .product-card img.safe-image, ' +
        '.detail-gallery img.safe-image, .featured-collection-section img.safe-image, .quick-grid img.safe-image';
    function captureImages() {
        // Geometry mode only. Never call decode(), drawImage() or change image attributes.
        const result = [];
        for (const image of document.querySelectorAll(imageSelector)) {
            if (result.length >= 32) break;
            const rect = image.getBoundingClientRect();
            if (
                !rect.width ||
                !rect.height ||
                rect.top >= innerHeight + 400 ||
                rect.bottom <= -400 ||
                image.closest('[hidden], [inert], [aria-hidden="true"]')
            )
                continue;
            const frame = image.closest('.safe-image-frame');
            const style = getComputedStyle(image);
            if (style.display === 'none' || style.visibility === 'hidden') continue;
            const inViewport =
                rect.top < innerHeight && rect.bottom > 0 && rect.left < innerWidth && rect.right > 0;
            const candidate = publicPath(image.currentSrc || image.src);
            let state = imageStates.get(image);
            if (!state || state.candidate !== candidate) {
                state = {
                    nodeId: id(image),
                    frameId: id(frame),
                    candidateId: imageHistory.length + 1,
                    candidate,
                    firstNearAt: now(),
                    firstViewportAt: null,
                    firstCompleteAt: null,
                    firstDrawableAt: null,
                    declaredSrc: publicPath(image.getAttribute('src')),
                    declaredSrcset: publicSrcset(image.getAttribute('srcset')),
                    sources: [...(image.closest('picture')?.querySelectorAll('source') ?? [])].map(
                        source => ({
                            media: source.media,
                            type: source.type,
                            srcset: publicSrcset(source.srcset),
                            sizes: source.sizes,
                        }),
                    ),
                    loading: image.loading,
                    fetchPriority: image.fetchPriority,
                    sizes: image.sizes,
                    actualPixels: 'unmeasured-use-cua-screenshot-sequence',
                };
                imageStates.set(image, state);
                append(imageHistory, state, 256);
            }
            const complete = image.complete && image.naturalWidth > 0;
            state.currentSrc = publicPath(image.currentSrc);
            // This is a drawable DOM candidate, not observed physical pixels or a decode probe.
            const drawable = complete && Number(style.opacity) > 0;
            if (inViewport && state.firstViewportAt === null) state.firstViewportAt = now();
            if (complete && state.firstCompleteAt === null) state.firstCompleteAt = now();
            if (drawable && inViewport && state.firstDrawableAt === null) state.firstDrawableAt = now();
            const preview = frame?.querySelector('.safe-image-preview');
            result.push({
                candidateId: state.candidateId,
                nodeId: state.nodeId,
                frameId: state.frameId,
                inViewport,
                complete,
                drawableCandidate: drawable,
                box: [rect.x, rect.y, rect.width, rect.height].map(round),
                documentTop: round(rect.top + scrollY),
                naturalSize: [image.naturalWidth, image.naturalHeight],
                opacity: style.opacity,
                state: frame?.dataset.safeImage ?? null,
                paintedFlag: frame?.classList.contains('is-painted') ?? false,
                previewPresent: Boolean(preview),
                previewVisible: visible(preview),
            });
        }
        return result;
    }
    function lightState() {
        const root = document.getElementById('root');
        if (root?.hasChildNodes() && !firstRoot) firstRoot = root.firstElementChild;
        return {
            at: now(),
            width: innerWidth,
            scrollY: round(scrollY),
            route: routePath(),
            historyKey: history.state?.__TSR_key ?? history.state?.key ?? null,
            appOwned: document.documentElement.hasAttribute('data-storefront-app-owned'),
            readiness: document.querySelector('[data-page-readiness]')?.dataset.pageReadiness ?? null,
            rootSame: firstRoot ? root?.firstElementChild === firstRoot : null,
            bootPending: document.documentElement.hasAttribute('data-storefront-boot-pending'),
            bootPresentation:
                document.getElementById('storefront-boot-loading')?.dataset.presentation ?? null,
            contentPresent: Boolean(
                document.querySelector('.home-page, .product-detail-page, .category-page'),
            ),
        };
    }
    function sample() {
        const state = lightState();
        if (mode !== 'geometry') return state;
        const hero = firstVisible('.hero-carousel-stage');
        const title = firstVisible('.hero-carousel h1, .hero-carousel h2');
        const coupon = firstVisible('.coupon-hub-section');
        if (hero && !firstHero) firstHero = hero;
        if (title && !firstTitle) firstTitle = title;
        if (coupon && !firstCoupon) firstCoupon = coupon;
        return {
            ...state,
            documentHeight: document.documentElement.scrollHeight,
            bootVisible: visible(document.getElementById('storefront-boot-loading')),
            heroSame: firstHero ? hero === firstHero : null,
            titleSame: firstTitle ? title === firstTitle : null,
            title: title?.textContent?.trim() ?? null,
            queryFeedback: firstVisible('[data-query-feedback="error"]')?.textContent?.trim() ?? null,
            couponPresent: Boolean(coupon),
            couponSame: firstCoupon ? coupon === firstCoupon : null,
            couponPending: coupon?.getAttribute('aria-busy') ?? null,
            couponPlaceholderCount: document.querySelectorAll('.coupon-hub-placeholder, .coupon-hub-skeleton')
                .length,
            geometry: Object.fromEntries(
                Object.entries(selectors).map(([name, selector]) => [name, box(firstVisible(selector))]),
            ),
            images: captureImages(),
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
        };
    }
    const feedbackState = target => ({
        route: routePath(),
        owned: document.documentElement.hasAttribute('data-storefront-app-owned'),
        boot: document.documentElement.hasAttribute('data-storefront-boot-pending'),
        readiness: document.querySelector('[data-page-readiness]')?.dataset.pageReadiness ?? null,
        pending: document.querySelectorAll('[data-page-pending]').length,
        dialogs: document.querySelectorAll('[role="dialog"]').length,
        connected: target?.isConnected ?? false,
        disabled: target?.disabled ?? false,
        busy: target?.getAttribute('aria-busy'),
        expanded: target?.getAttribute('aria-expanded'),
        pressed: target?.getAttribute('aria-pressed'),
        current: target?.getAttribute('aria-current'),
    });
    function trustedClick(event) {
        if (stopped || !event.isTrusted) return;
        const target = event.target?.closest?.('button, a, [role="button"]');
        if (!target) return;
        const before = feedbackState(target);
        const input = {
            id: nextInputId++,
            at: now(),
            trusted: true,
            targetId: id(target),
            tag: target.tagName,
            role: target.getAttribute('role'),
            before,
            nextFrameOpportunityMs: null,
            feedbackMs: null,
            feedback: null,
            feedbackMeaning: 'observed DOM state change; not physical paint or proof of business completion',
        };
        append(inputs, input, 100);
        activeInput = input;
        requestAnimationFrame(() => {
            input.nextFrameOpportunityMs = round(performance.now() - input.at);
        });
        const check = () => {
            if (stopped || activeInput !== input) return;
            const after = feedbackState(target);
            if (JSON.stringify(after) !== JSON.stringify(before)) {
                input.feedbackMs = round(performance.now() - input.at);
                input.feedback = after;
            } else if (performance.now() - input.at < 2000) setTimeout(check, 50);
        };
        setTimeout(check, 0);
    }
    document.addEventListener('click', trustedClick, true);
    for (const type of ['layout-shift', 'longtask', 'largest-contentful-paint', 'resource', 'event']) {
        observerSupport[type] = false;
        try {
            if (
                PerformanceObserver.supportedEntryTypes &&
                !PerformanceObserver.supportedEntryTypes.includes(type)
            )
                continue;
            new PerformanceObserver(list => {
                if (stopped) return;
                for (const entry of list.getEntries()) {
                    if (entry.startTime < sampleStarted) continue;
                    if (type === 'layout-shift')
                        append(shifts, {
                            at: round(entry.startTime),
                            value: entry.value,
                            hadRecentInput: entry.hadRecentInput,
                        });
                    else if (type === 'longtask')
                        append(longTasks, { at: round(entry.startTime), duration: round(entry.duration) });
                    else if (type === 'largest-contentful-paint')
                        append(largestPaints, {
                            at: round(entry.startTime),
                            size: entry.size,
                            tag: entry.element?.tagName ?? null,
                        });
                    else if (
                        type === 'resource' &&
                        ['img', 'link', 'script', 'fetch', 'xmlhttprequest', 'other'].includes(
                            entry.initiatorType,
                        )
                    )
                        append(
                            resources,
                            {
                                path: publicPath(entry.name),
                                initiator: entry.initiatorType,
                                startAt: round(entry.startTime),
                                responseStart: round(entry.responseStart),
                                endAt: round(entry.responseEnd),
                                duration: round(entry.duration),
                                transferSize: entry.transferSize,
                                decodedBodySize: entry.decodedBodySize,
                                responseStatus: entry.responseStatus ?? null,
                            },
                            1000,
                        );
                    else if (type === 'event')
                        append(events, {
                            type: 'event-timing',
                            name: entry.name,
                            at: round(entry.startTime),
                            duration: round(entry.duration),
                            interactionId: entry.interactionId,
                            inputDelay: round(entry.processingStart - entry.startTime),
                            handlerTime: round(entry.processingEnd - entry.processingStart),
                        });
                }
            }).observe({ type, buffered: true, ...(type === 'event' ? { durationThreshold: 16 } : {}) });
            observerSupport[type] = true;
        } catch {}
    }
    for (const type of ['storefront:app-owned', 'storefront:page-ready', 'storefront:page-error'])
        document.addEventListener(type, () => {
            if (type === 'storefront:app-owned' && appOwnedAtDocumentTime === null)
                appOwnedAtDocumentTime = now();
            if (!stopped) append(events, { type, at: now() });
        });
    addEventListener('popstate', () => {
        if (!stopped) append(events, { type: 'popstate', ...lightState() });
    });
    addEventListener(
        'scroll',
        () => {
            if (!stopped) append(events, { type: 'scroll', at: now(), scrollY: round(scrollY) });
        },
        { passive: true },
    );
    addEventListener('error', event => {
        if (!stopped)
            append(errors, {
                type: 'error',
                message: String(event.message || 'Resource error').slice(0, 300),
            });
    });
    addEventListener('unhandledrejection', event => {
        if (!stopped) append(errors, { type: 'rejection', message: String(event.reason).slice(0, 300) });
    });
    function payload() {
        const navigation = performance.getEntriesByType('navigation')[0];
        return {
            fixture: 'loading-experience-synthetic-v2',
            mode,
            label: query.get('qaLabel') || 'manual',
            case: query.get('qaCase') || 'home',
            preset: query.get('qaPreset') || 'classic',
            startedAt,
            sampleStarted,
            captureDurationMs: duration,
            appOwnedAtDocumentTime,
            timeOrigin: performance.timeOrigin ?? null,
            observerSupport,
            evidence: {
                pixels: 'not-captured; pair with external CUA screenshots and screenshot markers',
                geometry:
                    mode === 'geometry' ? 'high-frequency DOM sampling; impacts timings' : 'not-collected',
                performance:
                    mode === 'performance'
                        ? 'native observers and 500ms light samples'
                        : 'diagnostic-only; do not compare to performance mode',
            },
            initialScrollY,
            previousDeparture,
            navigationType: navigation?.type,
            navigation: Object.fromEntries(
                [
                    'responseStart',
                    'responseEnd',
                    'domInteractive',
                    'domContentLoadedEventEnd',
                    'loadEventEnd',
                ].map(key => [key, round(navigation?.[key] ?? 0)]),
            ),
            viewport: { width: innerWidth, height: innerHeight },
            reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
            samples,
            events,
            shifts,
            longTasks,
            largestPaints,
            errors,
            resources,
            inputs,
            imageHistory,
            markers,
            paints: performance
                .getEntriesByType('paint')
                .map(({ name, startTime }) => ({ name, at: round(startTime) })),
        };
    }
    function finish() {
        if (sent) return;
        sent = stopped = true;
        cancelAnimationFrame(scheduled);
        clearTimeout(scheduled);
        const report = payload();
        const summary = {
            mode,
            samples: samples.length,
            appOwned:
                events.find(event => event.type === 'storefront:app-owned')?.at ??
                samples.find(frame => frame.appOwned)?.at ??
                null,
            longTasks: longTasks.length,
            lcp: largestPaints.at(-1)?.at ?? null,
            errors: errors.length,
            inputs: inputs.length,
            trackedImageCandidates: imageHistory.length,
            width: innerWidth,
            rootReplaced: samples.some(frame => frame.rootSame === false),
            pixels: 'external CUA screenshots required',
        };
        const body = JSON.stringify(report);
        fetch('/__qa/record', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body,
            keepalive: new Blob([body]).size < 60000,
        })
            .then(response => response.json())
            .then(saved => {
                parent.postMessage(
                    { type: 'loading-experience-report', summary: { ...summary, ...saved } },
                    location.origin,
                );
            })
            .catch(() =>
                parent.postMessage(
                    { type: 'loading-experience-report', summary: { ...summary, saveFailed: true } },
                    location.origin,
                ),
            );
    }
    const tick = () => {
        if (stopped) return;
        samples.push(sample());
        if (performance.now() - sampleStarted >= duration || samples.length >= 900) finish();
        else scheduled = mode === 'geometry' ? requestAnimationFrame(tick) : setTimeout(tick, 500);
    };
    const start = () => {
        sampleStarted = performance.now();
        startedAt = Date.now();
        stopped = sent = false;
        firstRoot = firstHero = firstTitle = firstCoupon = undefined;
        imageStates = new WeakMap();
        for (const list of [
            samples,
            events,
            shifts,
            longTasks,
            largestPaints,
            errors,
            resources,
            inputs,
            imageHistory,
            markers,
        ])
            list.length = 0;
        scheduled = mode === 'geometry' ? requestAnimationFrame(tick) : setTimeout(tick, 0);
    };
    addEventListener('message', event => {
        if (event.origin !== location.origin || event.source !== parent) return;
        if (event.data?.type === 'start-loading-sample') {
            finish();
            query.set('qaCase', 'navigation');
            start();
        }
        if (event.data?.type === 'screenshot-marker' && !stopped)
            append(
                markers,
                {
                    at: now(),
                    wallAt: Date.now(),
                    label: String(event.data.label ?? '').slice(0, 80),
                    scrollY: round(scrollY),
                    meaning: 'operator marker; screenshot captured separately by CUA',
                },
                100,
            );
    });
    addEventListener('pagehide', () => {
        try {
            sessionStorage.setItem(
                storageKey,
                JSON.stringify({
                    path: routePath(),
                    scrollY: round(scrollY),
                    at: Date.now(),
                    historyKey: history.state?.__TSR_key ?? history.state?.key ?? null,
                }),
            );
        } catch {}
        if (!stopped) append(events, { type: 'pagehide', at: now(), scrollY: round(scrollY) });
        finish();
    });
    try {
        localStorage.setItem('storefront-analytics-opt-out:v1', '1');
    } catch {}
    // Start at document time zero to retain buffered startup performance entries.
    scheduled = mode === 'geometry' ? requestAnimationFrame(tick) : setTimeout(tick, 0);
})();
