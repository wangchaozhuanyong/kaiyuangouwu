const spoken = new Set<string>();
const pending = new Map<string, Promise<void>>();
const preferences = new Map<
    string,
    {
        listeners: Set<(muted: boolean) => void>;
        channel?: BroadcastChannel;
        storage: (event: StorageEvent) => void;
    }
>();

const preferenceKey = (administratorId: string) => `next-admin:order-voice:${administratorId}`;
const receiptKey = (administratorId: string, orderId: string, storeId?: string) =>
    storeId
        ? `next-admin:order-announced:${administratorId}:${storeId}:${orderId}`
        : `next-admin:order-announced:${administratorId}:${orderId}`;

/** Some browsers populate their voice list after the first page render. */
export function waitForOrderAnnouncementVoices(synthesis: SpeechSynthesis, signal: AbortSignal) {
    return new Promise<SpeechSynthesisVoice[]>(resolve => {
        if (signal.aborted || typeof synthesis.getVoices !== 'function') return resolve([]);
        const existing = synthesis.getVoices();
        if (existing.length) return resolve(existing);
        let finished = false;
        const finish = () => {
            if (finished) return;
            finished = true;
            window.clearTimeout(timer);
            synthesis.removeEventListener('voiceschanged', change);
            signal.removeEventListener('abort', finish);
            resolve(signal.aborted ? [] : synthesis.getVoices());
        };
        const change = () => {
            if (synthesis.getVoices().length) finish();
        };
        const timer = window.setTimeout(finish, 1500);
        synthesis.addEventListener('voiceschanged', change);
        signal.addEventListener('abort', finish, { once: true });
        // Cover voices becoming available between the initial read and listener registration.
        change();
    });
}

export function readOrderVoiceMuted(administratorId: string) {
    try {
        return localStorage.getItem(preferenceKey(administratorId)) === 'muted';
    } catch {
        return false;
    }
}

export function subscribeOrderVoicePreference(administratorId: string, listener: (muted: boolean) => void) {
    let entry = preferences.get(administratorId);
    if (!entry) {
        const listeners = new Set<(muted: boolean) => void>();
        const channel =
            typeof BroadcastChannel !== 'undefined'
                ? new BroadcastChannel(`next-admin:order-voice:${administratorId}`)
                : undefined;
        const notify = (muted: boolean) => {
            for (const callback of listeners) callback(muted);
        };
        const storage = (event: StorageEvent) => {
            if (event.key === preferenceKey(administratorId)) notify(event.newValue === 'muted');
        };
        if (channel)
            channel.onmessage = event => {
                if (event.data?.type === 'mute' && typeof event.data.muted === 'boolean')
                    notify(event.data.muted);
                else if (event.data?.type === 'spoken' && typeof event.data.orderId === 'string')
                    spoken.add(
                        receiptKey(
                            administratorId,
                            event.data.orderId,
                            typeof event.data.storeId === 'string' ? event.data.storeId : undefined,
                        ),
                    );
            };
        window.addEventListener('storage', storage);
        entry = { listeners, channel, storage };
        preferences.set(administratorId, entry);
    }
    entry.listeners.add(listener);
    const current = entry;
    return () => {
        current.listeners.delete(listener);
        if (current.listeners.size > 0) return;
        current.channel?.close();
        window.removeEventListener('storage', current.storage);
        if (preferences.get(administratorId) === current) preferences.delete(administratorId);
    };
}

export function setOrderVoiceMuted(administratorId: string, muted: boolean) {
    try {
        localStorage.setItem(preferenceKey(administratorId), muted ? 'muted' : 'enabled');
    } catch {
        // Browser preference storage can be disabled; live tabs still receive the change.
    }
    const entry = preferences.get(administratorId);
    for (const listener of entry?.listeners ?? []) listener(muted);
    entry?.channel?.postMessage({ type: 'mute', muted });
}

/** A receipt is written only once playback starts; blocked/cancelled attempts remain retryable. */
export async function announceOrderOnce(
    administratorId: string,
    orderId: string,
    signal: AbortSignal,
    announce: (started: () => void) => Promise<void>,
    storeId?: string,
) {
    const key = receiptKey(administratorId, orderId, storeId);
    const legacyKey = receiptKey(administratorId, orderId);
    const run = async () => {
        let recorded = spoken.has(key) || spoken.has(legacyKey);
        try {
            recorded ||=
                localStorage.getItem(key) === 'spoken' || localStorage.getItem(legacyKey) === 'spoken';
        } catch {
            // The in-memory/BroadcastChannel receipt still avoids replay in live tabs.
        }
        if (signal.aborted || readOrderVoiceMuted(administratorId) || recorded) return;
        await announce(() => {
            if (signal.aborted) return;
            spoken.add(key);
            try {
                localStorage.setItem(key, 'spoken');
            } catch {
                // Sound is usable without persistent browser storage.
            }
            preferences.get(administratorId)?.channel?.postMessage({ type: 'spoken', orderId, storeId });
        });
    };
    if (navigator.locks) {
        await navigator.locks.request(`next-admin:order-sound:${key}`, { signal }, run).catch(() => {});
    } else {
        const existing = pending.get(key);
        if (existing) return existing;
        const work = run();
        pending.set(key, work);
        try {
            await work;
        } finally {
            if (pending.get(key) === work) pending.delete(key);
        }
    }
}
