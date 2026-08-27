export type ReferralSource = 'LINK' | 'POSTER' | 'CODE';

interface StoredReferralAttribution {
    code: string;
    source: ReferralSource;
    capturedAt: number;
}

const STORAGE_KEY = 'storefront-referral-attribution:v1';

export function normalizeReferralCode(value?: string | null): string {
    return (value ?? '').trim().toUpperCase().replace(/\s+/g, '').slice(0, 12);
}

export function captureReferralAttribution(
    location?: Pick<Location, 'search'>,
    storage?: Pick<Storage, 'getItem' | 'setItem'>,
    now = Date.now(),
): StoredReferralAttribution | null {
    const resolvedLocation = location ?? (typeof window === 'undefined' ? { search: '' } : window.location);
    const resolvedStorage = storage ?? (typeof localStorage === 'undefined' ? null : localStorage);
    if (!resolvedStorage) return null;
    const params = new URLSearchParams(resolvedLocation.search);
    const code = normalizeReferralCode(params.get('ref') ?? params.get('inviteCode'));
    if (!code) return readReferralAttribution(resolvedStorage);
    const rawSource = params.get('source')?.toUpperCase();
    const source: ReferralSource = rawSource === 'POSTER' ? 'POSTER' : 'LINK';
    const attribution = { code, source, capturedAt: now };
    resolvedStorage.setItem(STORAGE_KEY, JSON.stringify(attribution));
    return attribution;
}

export function readReferralAttribution(
    storage?: Pick<Storage, 'getItem'>,
): StoredReferralAttribution | null {
    try {
        const resolvedStorage = storage ?? (typeof localStorage === 'undefined' ? null : localStorage);
        if (!resolvedStorage) return null;
        const value = resolvedStorage.getItem(STORAGE_KEY);
        if (!value) return null;
        const parsed = JSON.parse(value) as Partial<StoredReferralAttribution>;
        const code = normalizeReferralCode(parsed.code);
        if (!code || typeof parsed.capturedAt !== 'number' || !Number.isFinite(parsed.capturedAt)) {
            return null;
        }
        return {
            code,
            source: parsed.source === 'POSTER' ? 'POSTER' : parsed.source === 'CODE' ? 'CODE' : 'LINK',
            capturedAt: parsed.capturedAt,
        };
    } catch {
        return null;
    }
}

export function attributionWithinWindow(
    attribution: StoredReferralAttribution | null,
    windowDays: number,
    now = Date.now(),
): StoredReferralAttribution | null {
    if (!attribution) return null;
    const elapsed = now - attribution.capturedAt;
    return elapsed >= 0 && elapsed <= windowDays * 86_400_000 ? attribution : null;
}

export function referralShareUrl(code: string, source: ReferralSource = 'LINK'): string {
    const url = new URL('/register', window.location.origin);
    url.searchParams.set('ref', normalizeReferralCode(code));
    url.searchParams.set('source', source);
    return url.href;
}

export function storefrontVisitorId(storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): string {
    const key = 'storefront-visitor-id:v1';
    const existing = storage.getItem(key);
    if (existing && /^[A-Za-z0-9_-]{16,128}$/.test(existing)) return existing;
    const generated = crypto.randomUUID().replace(/-/g, '');
    storage.setItem(key, generated);
    return generated;
}
