import { useNavigate } from '@tanstack/react-router';
import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    useSyncExternalStore,
    type PointerEvent as ReactPointerEvent,
} from 'react';

import {
    heroContentForViewport,
    heroImageForViewport,
} from '../../../storefront-content-plugin/src/shared/hero-image';
import {
    HeroScene,
    resolveHeroArtworkLayout,
} from '../../../storefront-content-plugin/src/shared/hero-scene';
import {
    HERO_HEIGHT_TRANSITION_MS,
    HERO_TRANSITION_MS,
    heroDirectionBetweenSlides,
    heroIndexAfterManualMove,
    heroSwipeAxis,
    isCompletedHeroSwipe,
} from '../hero-carousel';
import { storefrontPreviewParameters } from '../storefront-preview-parameters';
import { routeNavigateOptions } from '../storefront-router';
import { decodeStorefrontImage, SafeImage, shouldPrefetchMedia } from '../storefront-ui/product-display';
import {
    type StorefrontContentBlock,
    type StorefrontContentTargetType,
    type StorefrontLanguage,
} from '../types';

const phoneHeroQuery = '(max-width: 767px)';
function subscribeToPhoneHero(onChange: () => void) {
    const query = window.matchMedia(phoneHeroQuery);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
}

export function HomeHeroCarousel({
    managedHeroes,
    desktop,
    language,
    storefrontName,
    heroAutoplayIntervalSeconds,
    pageVisible,
    prefersReducedMotion,
    order,
    onContentTarget,
}: {
    managedHeroes: StorefrontContentBlock[];
    desktop: boolean;
    language: StorefrontLanguage;
    storefrontName: string;
    heroAutoplayIntervalSeconds: number;
    pageVisible: boolean;
    prefersReducedMotion: boolean;
    order: number;
    onContentTarget: (targetType: StorefrontContentTargetType, targetValue: string | null) => void;
}) {
    const isZh = language === 'zh';
    const navigate = useNavigate();
    const phoneHero = useSyncExternalStore(
        subscribeToPhoneHero,
        () => window.matchMedia(phoneHeroQuery).matches,
        () => false,
    );
    const [heroIndex, setHeroIndex] = useState(0);
    const [readyHeroImage, setReadyHeroImage] = useState('');
    const [heroMediaError, setHeroMediaError] = useState<number | null>(null);
    const [pendingSelection, setPendingSelection] = useState<number | null>(null);
    const [showPending, setShowPending] = useState(false);
    const [heroInView, setHeroInView] = useState(true);
    const preparation = useRef<{
        src: string;
        controller: AbortController;
        image?: HTMLImageElement;
        promise: Promise<void>;
    } | null>(null);
    const [heroInteractionPaused, setHeroInteractionPaused] = useState(false);
    const [heroGestureActive, setHeroGestureActive] = useState(false);
    const [heroMotion, setHeroMotion] = useState<{
        nextIndex: number;
        direction: -1 | 1;
        offset: number;
        phase: 'dragging' | 'prepared' | 'settling';
        completed: boolean;
        crossfade?: boolean;
    } | null>(null);
    const heroMotionRef = useRef(heroMotion);
    const heroMotionTimerRef = useRef<number | null>(null);
    const heroMotionFrameRef = useRef<number | null>(null);
    const heroViewportRef = useRef<HTMLElement>(null);
    const heroStageRef = useRef<HTMLDivElement>(null);
    const [heroStageHeight, setHeroStageHeight] = useState<number>();
    const [heroCopyScrollable, setHeroCopyScrollable] = useState(false);
    const heroStageHeightRef = useRef<number | undefined>(undefined);
    const heroHeightGrowthDeadlineRef = useRef(0);
    const heroQueuedSelectionRef = useRef<{ index: number; direction?: -1 | 1 } | null>(null);
    const [heroAutoplayStopped, setHeroAutoplayStopped] = useState(false);
    useEffect(() => {
        const focusId = storefrontPreviewParameters().get('storefrontPreviewBlockId');
        if (!focusId) return;
        const index = managedHeroes.findIndex(block => block.id === focusId);
        if (index >= 0) {
            setHeroIndex(index);
            setHeroAutoplayStopped(true);
        }
    }, [managedHeroes]);
    const reducedMotionRef = useRef(prefersReducedMotion);
    reducedMotionRef.current = prefersReducedMotion;
    const heroGestureRef = useRef({
        active: false,
        horizontal: false,
        suppressClick: false,
        startX: 0,
        startY: 0,
        pointerId: -1,
        width: 0,
    });
    const heroTransitionRef = useRef(0);
    const heroCount = managedHeroes.length;
    const heroInteractiveIndex =
        heroMotion?.phase === 'settling' && heroMotion.completed ? heroMotion.nextIndex : heroIndex;
    const managedHero = managedHeroes[heroIndex];
    const heroImage = heroImageForViewport(managedHero, !phoneHero).imageUrl;
    const updateHeroMotion = useCallback((motion: typeof heroMotion) => {
        heroMotionRef.current = motion;
        setHeroMotion(motion);
    }, []);

    const clearHeroMotionSchedule = useCallback(() => {
        if (heroMotionTimerRef.current !== null) window.clearTimeout(heroMotionTimerRef.current);
        if (heroMotionFrameRef.current !== null) window.cancelAnimationFrame(heroMotionFrameRef.current);
        heroMotionTimerRef.current = null;
        heroMotionFrameRef.current = null;
    }, []);

    const settleHeroMotion = useCallback(
        (motion: NonNullable<typeof heroMotion>) => {
            clearHeroMotionSchedule();
            if (motion.completed)
                setPendingSelection(selection => (selection === motion.nextIndex ? null : selection));
            const finish = () => {
                heroMotionTimerRef.current = null;
                if (motion.completed) setHeroIndex(motion.nextIndex);
                updateHeroMotion(null);
            };
            if (reducedMotionRef.current) {
                finish();
                return;
            }
            updateHeroMotion({ ...motion, offset: 0, phase: 'settling' });
            heroMotionTimerRef.current = window.setTimeout(finish, HERO_TRANSITION_MS);
        },
        [clearHeroMotionSchedule, updateHeroMotion],
    );

    const cancelPreparation = useCallback(() => {
        ++heroTransitionRef.current;
        preparation.current?.controller.abort();
        preparation.current = null;
        setPendingSelection(null);
    }, []);

    const cancelGesture = useCallback(() => {
        const gesture = heroGestureRef.current;
        gesture.active = false;
        gesture.horizontal = false;
        heroQueuedSelectionRef.current = null;
        const viewport = heroViewportRef.current;
        if (gesture.pointerId >= 0 && viewport?.hasPointerCapture(gesture.pointerId))
            viewport.releasePointerCapture(gesture.pointerId);
        cancelPreparation();
        clearHeroMotionSchedule();
        updateHeroMotion(null);
        setHeroGestureActive(false);
    }, [cancelPreparation, clearHeroMotionSchedule, updateHeroMotion]);

    const prepareImage = useCallback(
        (src: string, manual: boolean) => {
            const existing = preparation.current;
            if (existing?.src === src) {
                if (manual && existing.image) existing.image.fetchPriority = 'high';
                return existing.promise;
            }
            preparation.current?.controller.abort();
            const controller = new AbortController();
            let image: HTMLImageElement | undefined;
            const promise = decodeStorefrontImage(src, 'hero', phoneHero ? 'calc(100vw - 20px)' : undefined, {
                signal: controller.signal,
                priority: manual ? 'high' : 'low',
                onCreate: created => {
                    image = created;
                },
            }).catch(error => {
                if (preparation.current?.controller === controller) preparation.current = null;
                throw error;
            });
            preparation.current = { src, controller, image, promise };
            return promise;
        },
        [phoneHero],
    );

    const preparingSelection =
        heroMotion?.completed && heroMotion.nextIndex === pendingSelection ? null : pendingSelection;
    useEffect(() => {
        setShowPending(false);
        if (preparingSelection === null) return;
        const timer = window.setTimeout(() => setShowPending(true), 150);
        return () => window.clearTimeout(timer);
    }, [preparingSelection]);

    useEffect(() => {
        const viewport = heroViewportRef.current;
        if (!viewport || typeof IntersectionObserver === 'undefined') return;
        const observer = new IntersectionObserver(entries => {
            const entry = entries.find(value => value.target === viewport);
            if (entry) setHeroInView(entry.isIntersecting);
        });
        observer.observe(viewport);
        return () => observer.disconnect();
    }, []);

    const showPreparedHero = useCallback(
        async (nextIndex: number, direction?: -1 | 1, manual = false) => {
            const nextHero = managedHeroes[nextIndex];
            if (!nextHero || heroMotionRef.current?.phase === 'settling') return;
            const transitionId = ++heroTransitionRef.current;
            clearHeroMotionSchedule();
            if (nextIndex === heroIndex) {
                cancelPreparation();
                setHeroMediaError(null);
                return;
            }
            setPendingSelection(manual ? nextIndex : null);
            const nextImage = heroImageForViewport(nextHero, !phoneHero).imageUrl;
            setHeroMediaError(null);
            try {
                await prepareImage(nextImage, manual);
            } catch {
                if (heroTransitionRef.current !== transitionId) return;
                setPendingSelection(null);
                setHeroMediaError(nextIndex);
                setHeroAutoplayStopped(true);
                const current = heroMotionRef.current;
                if (current) settleHeroMotion({ ...current, completed: false });
                return;
            }
            if (heroTransitionRef.current !== transitionId) return;
            const dragging = heroMotionRef.current?.phase === 'dragging';
            const motion: NonNullable<typeof heroMotion> = {
                nextIndex,
                direction:
                    direction ?? heroDirectionBetweenSlides(heroIndex, nextIndex, managedHeroes.length),
                offset: dragging ? (heroMotionRef.current?.offset ?? 0) : 0,
                phase: 'prepared',
                completed: true,
                crossfade: !dragging,
            };
            if (reducedMotionRef.current) {
                settleHeroMotion(motion);
                return;
            }
            updateHeroMotion(motion);
            const start = (): void => {
                const remainingGrowth = Math.max(0, heroHeightGrowthDeadlineRef.current - performance.now());
                if (remainingGrowth > 0) {
                    heroMotionTimerRef.current = window.setTimeout(() => {
                        heroMotionTimerRef.current = null;
                        if (heroTransitionRef.current === transitionId) start();
                    }, remainingGrowth);
                } else {
                    settleHeroMotion(motion);
                }
            };
            if (dragging) {
                start();
                return;
            }
            // Paint both starting positions before applying their coordinated transition.
            heroMotionFrameRef.current = window.requestAnimationFrame(() => {
                heroMotionFrameRef.current = window.requestAnimationFrame(() => {
                    heroMotionFrameRef.current = null;
                    if (heroTransitionRef.current === transitionId) start();
                });
            });
        },
        [
            cancelPreparation,
            clearHeroMotionSchedule,
            heroIndex,
            managedHeroes,
            phoneHero,
            prepareImage,
            settleHeroMotion,
            updateHeroMotion,
        ],
    );

    useEffect(() => {
        cancelGesture();
        setHeroIndex(index => (index < managedHeroes.length ? index : 0));
        return () => {
            ++heroTransitionRef.current;
            preparation.current?.controller.abort();
            preparation.current = null;
            clearHeroMotionSchedule();
        };
    }, [managedHeroes, phoneHero, cancelGesture, clearHeroMotionSchedule]);

    useLayoutEffect(() => {
        const stage = heroStageRef.current;
        const viewport = heroViewportRef.current;
        if (!stage || !viewport) return;
        const heightSurfaces = Array.from(
            stage.querySelectorAll<HTMLElement>(desktop ? '.hero-rich-content' : '.hero-scene-wrapper'),
        );
        const carousel = viewport.closest<HTMLElement>('.hero-carousel');
        const gallery = desktop
            ? carousel
                  ?.closest('.home-intro-grid.is-grouped-intro')
                  ?.querySelector<HTMLElement>('.quick-grid')
            : null;
        let active = true;
        const measure = () => {
            if (!active) return;
            const paired =
                gallery &&
                carousel &&
                window.getComputedStyle(gallery).gridRowStart ===
                    window.getComputedStyle(carousel).gridRowStart;
            setHeroCopyScrollable(Boolean(paired));
            // The right-hand gallery owns the fixed desktop frame. Neither artwork
            // dimensions nor overflowing copy can change its height between slides.
            const height = paired
                ? gallery.getBoundingClientRect().height
                : Math.ceil(
                      Math.max(
                          Number.parseFloat(window.getComputedStyle(viewport).minHeight) || 0,
                          ...heightSurfaces.map(surface => {
                              const frameHeight = surface.getBoundingClientRect().height;
                              // Mobile overlay copy scrolls inside the fixed CSS frame.
                              // Its overflow must never resize the carousel stage.
                              return !desktop && surface.dataset.heroArtworkLayout === 'overlay'
                                  ? frameHeight
                                  : Math.max(frameHeight, surface.scrollHeight);
                          }),
                      ),
                  );
            if (height <= 0 || height === heroStageHeightRef.current) return;
            const previous = heroStageHeightRef.current ?? stage.getBoundingClientRect().height;
            heroStageHeightRef.current = height;
            // Make room for the taller copy before its final horizontal entrance.
            heroHeightGrowthDeadlineRef.current =
                !paired && height > previous && !reducedMotionRef.current
                    ? performance.now() + HERO_HEIGHT_TRANSITION_MS
                    : 0;
            setHeroStageHeight(height);
        };
        const observer = new ResizeObserver(measure);
        heightSurfaces.forEach(surface => observer.observe(surface));
        observer.observe(viewport);
        if (gallery) observer.observe(gallery);
        window.addEventListener('resize', measure);
        measure();
        return () => {
            active = false;
            observer.disconnect();
            window.removeEventListener('resize', measure);
        };
    }, [desktop, heroIndex, heroMotion?.nextIndex, managedHeroes]);

    useEffect(() => {
        const queued = heroQueuedSelectionRef.current;
        if (heroMotion || !queued) return;
        heroQueuedSelectionRef.current = null;
        void showPreparedHero(queued.index, queued.direction, true);
    }, [heroIndex, heroMotion, showPreparedHero]);

    useEffect(() => {
        const motion = heroMotionRef.current;
        if (!prefersReducedMotion || !motion || motion.phase === 'dragging') return;
        settleHeroMotion(motion);
    }, [prefersReducedMotion, settleHeroMotion]);

    useEffect(() => {
        if (
            heroCount < 2 ||
            heroInteractionPaused ||
            heroGestureActive ||
            heroMotion ||
            heroAutoplayStopped ||
            prefersReducedMotion ||
            !pageVisible ||
            !heroInView ||
            pendingSelection !== null
        ) {
            return;
        }
        const timer = window.setTimeout(
            () => void showPreparedHero(heroIndexAfterManualMove(heroIndex, heroCount, 1)),
            heroAutoplayIntervalSeconds * 1000,
        );
        return () => window.clearTimeout(timer);
    }, [
        heroAutoplayIntervalSeconds,
        heroAutoplayStopped,
        heroCount,
        heroGestureActive,
        heroMotion,
        heroIndex,
        heroInteractionPaused,
        pageVisible,
        heroInView,
        pendingSelection,
        prefersReducedMotion,
        showPreparedHero,
    ]);

    useEffect(() => {
        if (
            heroCount < 2 ||
            readyHeroImage !== heroImage ||
            !pageVisible ||
            !heroInView ||
            heroMotion ||
            pendingSelection !== null ||
            !shouldPrefetchMedia()
        )
            return;
        const nextIndex = heroIndexAfterManualMove(heroIndex, heroCount, 1);
        const nextHero = managedHeroes[nextIndex];
        if (!nextHero) return;
        const nextImage = heroImageForViewport(nextHero, !phoneHero).imageUrl;
        void prepareImage(nextImage, false).catch(() => undefined);
    }, [
        heroCount,
        heroImage,
        heroIndex,
        managedHeroes,
        phoneHero,
        readyHeroImage,
        pageVisible,
        heroInView,
        heroMotion,
        pendingSelection,
        prepareImage,
    ]);

    const selectHeroManually = (index: number, direction?: -1 | 1) => {
        setHeroAutoplayStopped(true);
        setPendingSelection(index === heroInteractiveIndex ? null : index);
        if (heroMotionRef.current?.phase === 'settling' || heroMotionRef.current?.phase === 'prepared') {
            heroQueuedSelectionRef.current = { index, direction };
            return;
        }
        heroQueuedSelectionRef.current = null;
        void showPreparedHero(index, direction, true);
    };

    const openHero = (slide: StorefrontContentBlock) => {
        if (slide.targetType !== 'NONE' && slide.targetValue) {
            onContentTarget(slide.targetType, slide.targetValue);
        } else {
            void navigate(routeNavigateOptions({ name: 'category' }) as never);
        }
    };

    const handleHeroImageOpen = (slide: StorefrontContentBlock) => {
        if (heroGestureRef.current.suppressClick) {
            heroGestureRef.current.suppressClick = false;
            return;
        }
        openHero(slide);
    };

    const beginHeroSwipe = (event: ReactPointerEvent<HTMLElement>) => {
        const interactiveTarget =
            event.target instanceof Element ? event.target.closest('button, a, input, label') : null;
        const isHeroImageLink = interactiveTarget?.classList.contains('hero-rich-image-link');
        if (
            heroCount < 2 ||
            event.button !== 0 ||
            event.isPrimary === false ||
            heroGestureRef.current.active ||
            heroMotionRef.current ||
            (interactiveTarget && !isHeroImageLink)
        ) {
            return;
        }
        cancelPreparation();
        heroGestureRef.current = {
            active: true,
            horizontal: false,
            suppressClick: false,
            startX: event.clientX,
            startY: event.clientY,
            pointerId: event.pointerId,
            width: event.currentTarget.getBoundingClientRect().width,
        };
        setHeroGestureActive(true);
    };

    const moveHeroSwipe = (event: ReactPointerEvent<HTMLElement>) => {
        const gesture = heroGestureRef.current;
        if (!gesture.active || gesture.pointerId !== event.pointerId) return;
        const deltaX = event.clientX - gesture.startX;
        const deltaY = event.clientY - gesture.startY;
        if (!gesture.horizontal) {
            const axis = heroSwipeAxis(deltaX, deltaY);
            if (axis === 'vertical') {
                gesture.active = false;
                setHeroGestureActive(false);
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId);
                }
                return;
            }
            if (axis !== 'horizontal') return;
            gesture.horizontal = true;
            event.currentTarget.setPointerCapture(event.pointerId);
        }
        const direction = deltaX < 0 ? 1 : -1;
        updateHeroMotion({
            nextIndex: heroIndexAfterManualMove(heroIndex, heroCount, direction),
            direction,
            offset: Math.max(-gesture.width, Math.min(gesture.width, deltaX)),
            phase: 'dragging',
            completed: false,
        });
        event.preventDefault();
    };

    const finishHeroSwipe = (event: ReactPointerEvent<HTMLElement>, cancelled = false) => {
        const gesture = heroGestureRef.current;
        if ((!gesture.active && !gesture.horizontal) || gesture.pointerId !== event.pointerId) return;
        const deltaX = event.clientX - gesture.startX;
        const deltaY = event.clientY - gesture.startY;
        const completed = !cancelled && gesture.horizontal && isCompletedHeroSwipe(deltaX, deltaY);
        const suppressClick = gesture.horizontal;
        gesture.active = false;
        gesture.horizontal = false;
        gesture.suppressClick = suppressClick;
        setHeroGestureActive(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
        if (completed) {
            const direction = deltaX < 0 ? 1 : -1;
            selectHeroManually(heroIndexAfterManualMove(heroIndex, heroCount, direction), direction);
        } else if (heroMotionRef.current) {
            settleHeroMotion({ ...heroMotionRef.current, completed: false });
        }
        if (suppressClick) {
            window.setTimeout(() => {
                gesture.suppressClick = false;
            }, 0);
        }
    };

    useEffect(() => {
        if (!pageVisible || !heroInView) cancelGesture();
        window.addEventListener('blur', cancelGesture);
        return () => window.removeEventListener('blur', cancelGesture);
    }, [pageVisible, heroInView, cancelGesture]);

    return (
        <div
            className="hero-carousel"
            style={{ order }}
            onMouseEnter={() => setHeroInteractionPaused(true)}
            onMouseLeave={() => setHeroInteractionPaused(false)}
            onFocus={() => setHeroInteractionPaused(true)}
            onBlur={event => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                    setHeroInteractionPaused(false);
                }
            }}
        >
            <section
                ref={heroViewportRef}
                className={
                    `hero hero-image-overlay${heroCount > 1 ? ' is-swipeable' : ''}` +
                    `${heroMotion?.phase === 'dragging' ? ' is-dragging' : ''}${desktop ? ' has-page-picker' : ''}`
                }
                role="region"
                aria-label={managedHeroes[heroInteractiveIndex]?.title || (isZh ? '精选推荐' : 'Featured')}
                aria-roledescription={isZh ? '轮播' : 'carousel'}
                onScrollCapture={event => {
                    if (
                        !desktop &&
                        event.target instanceof HTMLElement &&
                        event.target.matches(
                            '.hero-rich-copy-region, .hero-rich-copy-surface, .hero-rich-stats-row',
                        )
                    )
                        setHeroAutoplayStopped(true);
                }}
                onPointerDown={beginHeroSwipe}
                onPointerMove={moveHeroSwipe}
                onPointerUp={event => finishHeroSwipe(event)}
                onPointerCancel={event => finishHeroSwipe(event, true)}
                onPointerLeave={event => {
                    if (!heroGestureRef.current.horizontal) finishHeroSwipe(event, true);
                }}
                onLostPointerCapture={event => {
                    // Transferring implicit touch capture from a child also bubbles here.
                    if (event.target === event.currentTarget) finishHeroSwipe(event, true);
                }}
                onClickCapture={event => {
                    if (!heroGestureRef.current.suppressClick) return;
                    heroGestureRef.current.suppressClick = false;
                    event.preventDefault();
                    event.stopPropagation();
                }}
                onDragStart={event => event.preventDefault()}
                onKeyDown={event => {
                    if (!desktop || heroCount < 2 || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
                    event.preventDefault();
                    selectHeroManually(
                        heroIndexAfterManualMove(
                            heroInteractiveIndex,
                            heroCount,
                            event.key === 'ArrowLeft' ? -1 : 1,
                        ),
                        event.key === 'ArrowLeft' ? -1 : 1,
                    );
                }}
            >
                <div
                    ref={heroStageRef}
                    className={`hero-carousel-stage${heroMotion?.phase === 'settling' ? ' is-settling' : ''}`}
                    style={heroStageHeight ? { height: heroStageHeight } : undefined}
                >
                    {[heroIndex, ...(heroMotion ? [heroMotion.nextIndex] : [])].map(
                        (slideIndex, position) => {
                            const slide = managedHeroes[slideIndex];
                            if (!slide) return null;
                            const neighbor = position > 0;
                            const completing = heroMotion?.phase === 'settling' && heroMotion.completed;
                            const inactive = completing ? !neighbor : neighbor;
                            const offset = heroMotion?.offset ?? 0;
                            const direction = heroMotion?.direction ?? 1;
                            const translation = completing
                                ? `${neighbor ? 0 : -direction * 100}%`
                                : neighbor
                                  ? `calc(${direction * 100}% + ${offset}px)`
                                  : `${offset}px`;
                            const desktopImage = heroImageForViewport(slide, true);
                            const mobileImage = heroImageForViewport(slide, false);
                            const slideImage = (phoneHero ? mobileImage : desktopImage).imageUrl;
                            return (
                                <div
                                    key={slide.id}
                                    className={`hero-carousel-slide${neighbor ? ' is-neighbor' : ''}`}
                                    style={{
                                        transform: heroMotion?.crossfade
                                            ? 'none'
                                            : `translate3d(${translation}, 0, 0)`,
                                        opacity: heroMotion?.crossfade ? (inactive ? 0 : 1) : undefined,
                                    }}
                                    aria-hidden={inactive || undefined}
                                    inert={inactive || undefined}
                                >
                                    <HeroScene
                                        copyScrollable={
                                            heroCopyScrollable ||
                                            (!desktop &&
                                                resolveHeroArtworkLayout(slide.settings) === 'overlay')
                                        }
                                        content={slide}
                                        mobileContent={heroContentForViewport(slide, false, language)}
                                        mediaOverlay={
                                            <div className="hero-overlay-controls">
                                                <div
                                                    className="hero-page-picker"
                                                    role="group"
                                                    aria-label={isZh ? '选择轮播图片' : 'Choose a slide'}
                                                >
                                                    {heroCount === 1 ? (
                                                        <span
                                                            className="hero-page-static-number"
                                                            aria-current="true"
                                                            aria-label={
                                                                isZh ? '当前第 1 张图片' : 'Current slide 1'
                                                            }
                                                        >
                                                            1
                                                        </span>
                                                    ) : (
                                                        managedHeroes.map((item, index) => (
                                                            <button
                                                                key={item.id}
                                                                type="button"
                                                                aria-label={
                                                                    isZh
                                                                        ? `切换到第 ${index + 1} 张图片`
                                                                        : `Show slide ${index + 1}`
                                                                }
                                                                aria-busy={
                                                                    index === pendingSelection || undefined
                                                                }
                                                                aria-current={
                                                                    index === heroInteractiveIndex
                                                                        ? 'true'
                                                                        : undefined
                                                                }
                                                                onClick={() => selectHeroManually(index)}
                                                            >
                                                                <span className="hero-page-number">
                                                                    {index + 1}
                                                                </span>
                                                            </button>
                                                        ))
                                                    )}
                                                </div>
                                            </div>
                                        }
                                        imageLabel={`${isZh ? '查看推荐内容' : 'Open featured content'}：${slide.title || storefrontName}`}
                                        onImageOpen={() => handleHeroImageOpen(slide)}
                                        onOpen={() => openHero(slide)}
                                        image={
                                            <SafeImage
                                                src={desktopImage.imageUrl}
                                                previewSourceDimensions={desktopImage.imageAsset}
                                                mediaSources={
                                                    mobileImage.imageUrl !== desktopImage.imageUrl
                                                        ? [
                                                              {
                                                                  media: phoneHeroQuery,
                                                                  src: mobileImage.imageUrl,
                                                                  sizes: 'calc(100vw - 20px)',
                                                                  width: mobileImage.imageAsset?.width,
                                                                  height: mobileImage.imageAsset?.height,
                                                                  previewSourceDimensions:
                                                                      mobileImage.imageAsset,
                                                              },
                                                          ]
                                                        : undefined
                                                }
                                                alt={
                                                    slide.title ||
                                                    (isZh
                                                        ? `${storefrontName}精选`
                                                        : `${storefrontName} Featured`)
                                                }
                                                className="hero-rich-backdrop"
                                                imageKind="hero"
                                                width={slide.imageAsset?.width || undefined}
                                                height={slide.imageAsset?.height || undefined}
                                                loading="eager"
                                                fetchPriority={!neighbor && heroIndex === 0 ? 'high' : 'auto'}
                                                onImageReady={() => {
                                                    if (!neighbor) setReadyHeroImage(slideImage);
                                                }}
                                            />
                                        }
                                    />
                                </div>
                            );
                        },
                    )}
                </div>
                {preparingSelection !== null && showPending && (
                    <span className="hero-media-error hero-media-pending" role="status">
                        {isZh ? '正在准备图片…' : 'Preparing image…'}
                    </span>
                )}
                {heroMediaError !== null && (
                    <span className="hero-media-error" role="status">
                        {isZh ? '图片暂时无法加载，请重试' : 'Image unavailable. Please retry.'}
                        <button type="button" onClick={() => selectHeroManually(heroMediaError)}>
                            {isZh ? '重试' : 'Retry'}
                        </button>
                    </span>
                )}
                <span className="visually-hidden" aria-live={heroAutoplayStopped ? 'polite' : 'off'}>
                    {heroAutoplayStopped
                        ? isZh
                            ? `自动轮播已停止，当前为第 ${heroInteractiveIndex + 1} 张广告`
                            : `Autoplay stopped. Promotion ${heroInteractiveIndex + 1} is active.`
                        : ''}
                </span>
            </section>
        </div>
    );
}
