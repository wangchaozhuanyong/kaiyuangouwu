import type { createContentRevealController } from './content-reveal-animation';

type Controller = ReturnType<typeof createContentRevealController>;

/** Optional motion never joins startup or holds a ready page. Only the latest
 * committed observation is replayed, so a late module cannot animate old content. */
export function createDeferredContentReveal() {
    let controller: Controller | undefined;
    let latest: Parameters<Controller['update']>;
    let started = false;
    let disposed = false;
    return {
        update(...observation: Parameters<Controller['update']>) {
            disposed = false;
            latest = observation;
            if (controller) controller.update(...observation);
            else if (!started) {
                started = true;
                void import('./content-reveal-animation')
                    .then(module => {
                        if (disposed) return;
                        controller = module.createContentRevealController();
                        controller.update(...latest);
                    })
                    .catch(() => undefined);
            }
        },
        dispose() {
            disposed = true;
            controller?.dispose();
        },
    };
}
