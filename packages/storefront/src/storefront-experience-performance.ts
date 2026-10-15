import { router } from './router';
import { performancePageType } from './storefront-performance';
import { routeFromRouterLocation } from './storefront-router';

type RouteLocation = (typeof router)['state']['location'];
export type ExperienceMetric = 'NAV_RENDER' | 'NAV_READY' | 'NAV_ERROR' | 'IMAGE_PRESENT' | 'IMAGE_ERROR';
export type ExperienceReport = (
    sampleId: string,
    pageType: string,
    name: ExperienceMetric,
    value: number,
) => void;
const MAX_IMAGES = 32;
const IMAGE_OBSERVATION_MS = 30_000;
const MAX_NAVIGATION_MS = 120_000;

/** Observe declared state only. It never changes readiness, requests or image presentation. */
export function observeStorefrontExperience(report: ExperienceReport): () => void {
    let navigation:
        | {
              target: RouteLocation;
              routeName: string;
              sampleId: string;
              pageType: string;
              started: number;
              rendered: boolean;
              layoutSettled: boolean;
          }
        | undefined;
    let page: { sampleId: string; pageType: string } = {
        sampleId: crypto.randomUUID(),
        pageType: performancePageType(location.pathname),
    };
    let observer: MutationObserver | undefined;
    let visibility: IntersectionObserver | undefined;
    let imageDeadline: ReturnType<typeof setTimeout> | undefined;
    let commitFrame: number | undefined;
    const cancelCommitFrame = () => {
        if (commitFrame !== undefined) cancelAnimationFrame(commitFrame);
        commitFrame = undefined;
    };
    const images = new Map<HTMLElement, { visible: boolean; started?: number; done: boolean }>();
    let maximumImageTime = 0;
    let imageErrors = 0;
    const disconnectImages = () => {
        clearTimeout(imageDeadline);
        observer?.disconnect();
        visibility?.disconnect();
        observer = undefined;
        visibility = undefined;
        images.clear();
    };
    const inspect = (frame: HTMLElement) => {
        const sample = images.get(frame);
        if (!sample?.visible || sample.done) return;
        const state = frame.dataset.safeImage;
        if (sample.started === undefined) {
            // A frame already painted before observation is not a measured zero.
            if (frame.classList.contains('is-painted') || state === 'error' || state === 'timeout') {
                sample.done = true;
                return;
            }
            sample.started = performance.now();
        }
        if (state === 'error' || state === 'timeout') {
            sample.done = true;
            report(page.sampleId, page.pageType, 'IMAGE_ERROR', ++imageErrors);
        } else if (frame.classList.contains('is-painted')) {
            sample.done = true;
            maximumImageTime = Math.max(maximumImageTime, performance.now() - sample.started);
            report(page.sampleId, page.pageType, 'IMAGE_PRESENT', maximumImageTime);
        }
    };
    const observeImages = () => {
        disconnectImages();
        if (
            document.hidden ||
            typeof IntersectionObserver === 'undefined' ||
            typeof MutationObserver === 'undefined'
        )
            return;
        const add = (frame: HTMLElement) => {
            if (images.size >= MAX_IMAGES || images.has(frame)) return;
            images.set(frame, { visible: false, done: false });
            visibility?.observe(frame);
        };
        const added = (node: Node) => {
            if (!(node instanceof HTMLElement) || images.size >= MAX_IMAGES) return;
            if (node.matches('[data-safe-image]')) add(node);
            for (const frame of node.querySelectorAll<HTMLElement>('[data-safe-image]')) {
                add(frame);
                if (images.size >= MAX_IMAGES) break;
            }
        };
        visibility = new IntersectionObserver(entries => {
            for (const entry of entries) {
                const frame = entry.target as HTMLElement;
                const sample = images.get(frame);
                if (!sample) continue;
                sample.visible = entry.isIntersecting && entry.intersectionRatio > 0;
                if (!sample.visible) sample.started = undefined;
                else inspect(frame);
            }
        });
        observer = new MutationObserver(records => {
            for (const record of records) {
                if (record.type === 'attributes') inspect(record.target as HTMLElement);
                else {
                    for (const node of record.removedNodes)
                        if (node instanceof HTMLElement) {
                            for (const frame of images.keys())
                                if (node === frame || node.contains(frame)) {
                                    visibility?.unobserve(frame);
                                    images.delete(frame);
                                }
                        }
                    for (const node of record.addedNodes) added(node);
                }
            }
        });
        added(document.getElementById('root') ?? document.body);
        observer.observe(document.getElementById('root') ?? document.body, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ['data-safe-image', 'class'],
        });
        imageDeadline = setTimeout(disconnectImages, IMAGE_OBSERVATION_MS);
    };
    const ready = () => {
        if (
            !currentCommit() ||
            document.querySelector<HTMLElement>('[data-page-readiness]')?.dataset.pageReadiness !== 'ready'
        )
            return;
        if (!navigation) return;
        const elapsed = performance.now() - navigation.started;
        if (elapsed <= MAX_NAVIGATION_MS)
            report(navigation.sampleId, navigation.pageType, 'NAV_READY', elapsed);
        navigation = undefined;
    };
    const error = () => {
        if (
            currentCommit() &&
            navigation &&
            document.querySelector<HTMLElement>('[data-page-readiness]')?.dataset.pageReadiness === 'error'
        ) {
            report(navigation.sampleId, navigation.pageType, 'NAV_ERROR', 1);
            navigation = undefined;
        }
    };
    const currentCommit = () =>
        navigation?.rendered &&
        navigation.layoutSettled &&
        router.state.location === navigation.target &&
        !document.hidden &&
        document.querySelector<HTMLElement>('[data-route]')?.dataset.route === navigation.routeName;
    const begin = (target: RouteLocation) => {
        if (document.hidden || navigation?.target === target) return;
        disconnectImages();
        cancelCommitFrame();
        navigation = {
            target,
            routeName: routeFromRouterLocation(target.pathname, target.search).name,
            sampleId: crypto.randomUUID(),
            pageType: performancePageType(target.pathname),
            started: performance.now(),
            rendered: false,
            layoutSettled: false,
        };
    };
    const offBegin = router.subscribe('onBeforeNavigate', event => begin(event.toLocation));
    // Redirected loads can omit onBeforeNavigate; the same target must not restart its clock.
    const offLoad = router.subscribe('onBeforeLoad', event => begin(event.toLocation));
    const offRendered = router.subscribe('onRendered', event => {
        if (
            !navigation ||
            event.toLocation !== navigation.target ||
            router.state.location !== navigation.target ||
            document.hidden
        )
            return;
        navigation.rendered = true;
        const elapsed = performance.now() - navigation.started;
        if (elapsed > MAX_NAVIGATION_MS) {
            navigation = undefined;
            return;
        }
        report(navigation.sampleId, navigation.pageType, 'NAV_RENDER', elapsed);
        const committed = navigation;
        cancelCommitFrame();
        // onRendered comes from a ref callback, before descendant layout effects
        // have registered their required reads. Check their committed state on
        // the next frame; an old page-ready event cannot complete this target.
        commitFrame = requestAnimationFrame(() => {
            commitFrame = undefined;
            if (navigation !== committed) return;
            committed.layoutSettled = true;
            if (!currentCommit()) return;
            page = { sampleId: committed.sampleId, pageType: committed.pageType };
            maximumImageTime = 0;
            imageErrors = 0;
            observeImages();
            ready();
            error();
        });
    });
    const visible = () => {
        navigation = undefined;
        cancelCommitFrame();
        if (document.hidden) disconnectImages();
        else {
            page = { sampleId: crypto.randomUUID(), pageType: performancePageType(location.pathname) };
            maximumImageTime = 0;
            imageErrors = 0;
            observeImages();
        }
    };
    document.addEventListener('storefront:page-ready', ready);
    document.addEventListener('storefront:page-error', error);
    document.addEventListener('visibilitychange', visible);
    observeImages();
    return () => {
        navigation = undefined;
        cancelCommitFrame();
        disconnectImages();
        offBegin();
        offLoad();
        offRendered();
        document.removeEventListener('storefront:page-ready', ready);
        document.removeEventListener('storefront:page-error', error);
        document.removeEventListener('visibilitychange', visible);
    };
}
