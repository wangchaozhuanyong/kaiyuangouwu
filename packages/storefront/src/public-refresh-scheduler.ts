/** One visible-page fallback for aggregate data. The supplied refresh already merges concurrent reads. */
export function publicRefreshScheduler(refresh: () => void) {
    let connected = false;
    let hasConnected = false;
    let visible = document.visibilityState !== 'hidden';
    let disposed = false;
    const run = () => {
        if (!disposed && navigator.onLine && document.visibilityState !== 'hidden') refresh();
    };
    const fallback = window.setInterval(() => {
        if (!connected) run();
    }, 60_000);
    const visibility = () => {
        const next = document.visibilityState !== 'hidden';
        if (next && !visible) run();
        visible = next;
    };
    window.addEventListener('online', run);
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
            window.removeEventListener('online', run);
            document.removeEventListener('visibilitychange', visibility);
        },
    };
}
