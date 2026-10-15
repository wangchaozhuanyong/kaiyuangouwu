import { trackFixedBottomBars, trackFixedBottomViewport } from './fixed-bottom-viewport';
import { trackStorefrontRouteFocus } from './route-focus';
import { router } from './router';

/** Non-rendering browser enhancements share one deferred mount/unmount lifecycle. */
export function trackStorefrontEnhancements(): () => void {
    const cleanups = [trackFixedBottomViewport(), trackFixedBottomBars(), trackStorefrontRouteFocus(router)];
    return () => cleanups.reverse().forEach(dispose => dispose());
}
