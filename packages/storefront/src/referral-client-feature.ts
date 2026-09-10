import { ReferralProgram } from './types';

export function isReferralClientFeatureEnabled(
    program: Pick<ReferralProgram, 'enabled'> | null | undefined,
): boolean {
    return program?.enabled === true;
}

const REFERRAL_PROGRAM_CACHE_PREFIX = 'storefront:referral-program:';

function getStorage(): Storage | undefined {
    if (typeof localStorage !== 'undefined') return localStorage;
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
    return undefined;
}

export function readCachedReferralProgram(marketCode: string): ReferralProgram | undefined {
    const storage = getStorage();
    if (!storage) return undefined;
    try {
        const raw = storage.getItem(`${REFERRAL_PROGRAM_CACHE_PREFIX}${marketCode}`);
        if (!raw) return undefined;
        const parsed = JSON.parse(raw);
        if (typeof parsed?.enabled === 'boolean') {
            return parsed as ReferralProgram;
        }
    } catch {
        // Ignore storage read error
    }
    return undefined;
}

export function writeCachedReferralProgram(marketCode: string, program: ReferralProgram): void {
    const storage = getStorage();
    if (!storage) return;
    try {
        storage.setItem(`${REFERRAL_PROGRAM_CACHE_PREFIX}${marketCode}`, JSON.stringify(program));
    } catch {
        // Ignore storage write error
    }
}
