import { useEffect, useRef } from 'react';

/** Keep the mobile checkout action inside the visible area when browser chrome or the keyboard moves. */
export function useCheckoutViewport(enabled: boolean) {
    const pageRef = useRef<HTMLElement>(null);
    const actionBarRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const page = pageRef.current;
        const bar = actionBarRef.current;
        const viewport = window.visualViewport;
        if (!enabled || !page || !bar || !viewport) return;

        let frame = 0;
        let appliedOffset = 0;
        const update = () => {
            frame = 0;
            // Desktop uses an in-flow action. Pinch zoom must retain native viewport panning.
            const mobile = window.innerWidth < 1024 && viewport.scale === 1;
            // Measure the actual fixed edge, rather than assuming innerHeight is its containing height.
            // Adding back our previous correction prevents resize/scroll events from toggling the offset.
            const offset = mobile
                ? Math.max(
                      0,
                      Math.ceil(
                          bar.getBoundingClientRect().bottom +
                              appliedOffset -
                              viewport.offsetTop -
                              viewport.height,
                      ),
                  )
                : 0;
            if (offset === appliedOffset) return;
            appliedOffset = offset;
            page.style.setProperty('--checkout-viewport-bottom-offset', `${offset}px`);
        };
        const schedule = () => {
            if (!frame) frame = window.requestAnimationFrame(update);
        };

        update();
        viewport.addEventListener('resize', schedule);
        viewport.addEventListener('scroll', schedule);
        window.addEventListener('resize', schedule);
        return () => {
            window.cancelAnimationFrame(frame);
            viewport.removeEventListener('resize', schedule);
            viewport.removeEventListener('scroll', schedule);
            window.removeEventListener('resize', schedule);
            page.style.removeProperty('--checkout-viewport-bottom-offset');
        };
    }, [enabled]);

    return { pageRef, actionBarRef };
}
