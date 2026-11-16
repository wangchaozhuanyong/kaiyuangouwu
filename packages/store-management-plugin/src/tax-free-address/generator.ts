import { createHash, randomInt } from 'node:crypto';

// Ported from ID业务管理系统/server/bitbrowser-addresses.mjs (38655046).
// These are templates, not independently verified postal delivery addresses.
const locations: Array<[string, string, string[]]> = [
    ['Portland', 'Oregon', ['97201', '97205', '97209', '97214']],
    ['Salem', 'Oregon', ['97301', '97302', '97306']],
    ['Eugene', 'Oregon', ['97401', '97402', '97404']],
    ['Wilmington', 'Delaware', ['19801', '19802', '19805']],
    ['Dover', 'Delaware', ['19901', '19904']],
    ['Billings', 'Montana', ['59101', '59102', '59105']],
    ['Missoula', 'Montana', ['59801', '59802']],
    ['Manchester', 'New Hampshire', ['03101', '03102', '03104']],
    ['Nashua', 'New Hampshire', ['03060', '03062']],
    ['Anchorage', 'Alaska', ['99501', '99503', '99508']],
    ['Fairbanks', 'Alaska', ['99701', '99709']],
];
const streets = [
    'Main St',
    'Oak Ave',
    'Maple Dr',
    'Cedar Ln',
    'Park Blvd',
    'Washington St',
    'Lake View Rd',
    'Highland Ave',
    'Pine St',
    'Elm St',
];
export const ADDRESS_CAPACITY = 89_000;
export const ADDRESS_LIMIT = 1_000;
export const ADDRESS_BATCH = 100;
export const ADDRESS_COOLDOWN_MS = 300_000;
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');

/** Stable v1 identity: preserve the reference's street-only uniqueness, independent of city. */
export function addressFingerprint(line1: string): string {
    return digest(line1.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase());
}

/** Coprime permutation visits the original 89,000 street combinations exactly once, without retry starvation. */
export function addressAt(cursor: number) {
    if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor >= ADDRESS_CAPACITY)
        throw new Error('TAX_ADDRESS_EXHAUSTED');
    const ordinal = (cursor * 7919 + 23717) % ADDRESS_CAPACITY;
    const line1 = `${100 + Math.floor(ordinal / streets.length)} ${streets[ordinal % streets.length]}`;
    const [city, state, codes] = locations[randomInt(locations.length)];
    return {
        country: 'United States',
        line1,
        city,
        state,
        postalCode: codes[randomInt(codes.length)],
        fingerprint: addressFingerprint(line1),
    };
}
