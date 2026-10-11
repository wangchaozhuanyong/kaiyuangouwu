/** One visible-page fallback for aggregate data. The supplied refresh already merges concurrent reads. */
export function publicRefreshScheduler(refresh: () => void, reconcile?: () => void) {
    let connected = false;
    let hasConnected = false;
    let visible = document.visibilityState !== 'hidden';
    let disposed = false;
    const run = (aggregate = true) => {
        if (!disposed && navigator.onLine && document.visibilityState !== 'hidden') {
            if (aggregate) refresh();
            reconcile?.();
        }
    };
    let tick = 0;
    const fallback = window.setInterval(() => {
        tick++;
        run(!connected && tick % 2 === 0);
    }, 30_000);
    const visibility = () => {
        const next = document.visibilityState !== 'hidden';
        if (next && !visible) run();
        visible = next;
    };
    const online = () => run();
    window.addEventListener('online', online);
    document.addEventListener('visibilitychange', visibility);
    return {
        connection(next: boolean) {
            const reconnected = next && !connected;
            connected = next;
            if (reconnected && hasConnected) run();
            if (next) hasConnected = true;
        },
        dispose() {
            disposed = true;
            window.clearInterval(fallback);
            window.removeEventListener('online', online);
            document.removeEventListener('visibilitychange', visibility);
        },
    };
}
