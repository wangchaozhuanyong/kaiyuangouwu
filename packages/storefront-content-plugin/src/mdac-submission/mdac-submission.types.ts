/**
 * Official MDAC field payload and validation shared by the shop API and the
 * submission worker. Field names mirror the element `name` attributes on
 * https://imigresen-online.imi.gov.my/mdac/register.
 */

export interface MdacOfficialPayload {
    name: string;
    passNo: string;
    nationality: string;
    pob: string;
    dob: string;
    sex: string;
    passExpDte: string;
    email: string;
    region: string;
    mobile: string;
    arrDt: string;
    depDt: string;
    vesselNm: string;
    trvlMode: string;
    embark: string;
    accommodationStay: string;
    accommodationAddress1: string;
    accommodationAddress2: string;
    accommodationState: string;
    accommodationPostcode: string;
    accommodationCity: string;
}

export type MdacSubmissionStatus = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED' | 'MANUAL';

export interface MdacSubmissionInput extends Partial<MdacOfficialPayload> {
    /** Storefront language at submission time, retained for support only. */
    language?: string;
}

export const mdacFieldOrder: Array<keyof MdacOfficialPayload> = [
    'name',
    'passNo',
    'nationality',
    'pob',
    'dob',
    'sex',
    'passExpDte',
    'email',
    'region',
    'mobile',
    'arrDt',
    'depDt',
    'vesselNm',
    'trvlMode',
    'embark',
    'accommodationStay',
    'accommodationAddress1',
    'accommodationAddress2',
    'accommodationState',
    'accommodationPostcode',
    'accommodationCity',
];

const addressPattern = /^[A-Za-z0-9 /@(),'.-]+$/;

const fieldRules: Partial<Record<keyof MdacOfficialPayload, { max: number; pattern: RegExp }>> = {
    name: { max: 60, pattern: /^[A-Za-z][A-Za-z ]*$/ },
    passNo: { max: 12, pattern: /^[A-Za-z0-9]+$/ },
    nationality: { max: 3, pattern: /^[A-Z]{3}$/ },
    pob: { max: 3, pattern: /^[A-Z]{3}$/ },
    sex: { max: 1, pattern: /^[12]$/ },
    email: { max: 100, pattern: /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/ },
    region: { max: 4, pattern: /^[0-9]{1,4}$/ },
    mobile: { max: 12, pattern: /^[0-9]{5,12}$/ },
    vesselNm: { max: 30, pattern: /^[A-Za-z0-9][A-Za-z0-9 ]*$/ },
    trvlMode: { max: 1, pattern: /^[123]$/ },
    embark: { max: 3, pattern: /^[A-Z]{3}$/ },
    accommodationStay: { max: 2, pattern: /^(0[12]|99)$/ },
    accommodationAddress1: { max: 100, pattern: addressPattern },
    accommodationState: { max: 2, pattern: /^[0-9]{1,2}$/ },
    accommodationPostcode: { max: 5, pattern: /^[0-9]{5}$/ },
};

const officialDatePattern = /^(0[1-9]|[12][0-9]|3[01])\/(0[1-9]|1[0-2])\/(19|20)[0-9]{2}$/;

/** Conversion keeps the same round-trip check the storefront uses for dates. */
export function officialDateToIso(value: string): string | null {
    if (!officialDatePattern.test(value)) return null;
    const [day, month, year] = value.split('/');
    const iso = `${year}-${month}-${day}`;
    const parsed = new Date(`${iso}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) return null;
    return iso;
}

export function isoDateToOfficial(value: string): string | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [year, month, day] = value.split('-');
    const official = `${day}/${month}/${year}`;
    return officialDateToIso(official) ? official : null;
}

export interface NormalizedSubmission {
    payload: MdacOfficialPayload;
    arrivalIso: string;
}

export function normalizeOfficialPayload(
    input: MdacSubmissionInput,
): { submission: NormalizedSubmission; errors: string[] } | { submission?: undefined; errors: string[] } {
    const errors: string[] = [];
    const payload = {} as MdacOfficialPayload;
    for (const key of mdacFieldOrder) {
        const raw = input[key];
        const value = typeof raw === 'string' ? raw.trim() : '';
        const upper = value.toUpperCase();
        payload[key] = key === 'name' ? upper.replace(/\s+/gu, ' ') : upper;
        if (key === 'accommodationAddress2') continue;
        if (!value) {
            errors.push(`${key} is required`);
            continue;
        }
        const rule = fieldRules[key];
        if (!rule) continue;
        if (value.length > rule.max) errors.push(`${key} exceeds ${rule.max} characters`);
        if (!rule.pattern.test(payload[key])) errors.push(`${key} has invalid characters`);
    }
    const address2 = payload.accommodationAddress2 ?? '';
    if (address2 && (address2.length > 100 || !addressPattern.test(address2)))
        errors.push('accommodationAddress2 is invalid');

    const dates = ['dob', 'passExpDte', 'arrDt', 'depDt'] as const;
    const iso: Record<(typeof dates)[number], string | null> = {
        dob: null,
        passExpDte: null,
        arrDt: null,
        depDt: null,
    };
    for (const key of dates) {
        if (!payload[key]) {
            iso[key] = null;
            continue;
        }
        iso[key] = officialDateToIso(payload[key]);
        if (!iso[key]) errors.push(`${key} must be DD/MM/YYYY`);
    }
    if (iso.arrDt && iso.depDt && iso.depDt < iso.arrDt) errors.push('depDt precedes arrDt');
    if (iso.dob && iso.arrDt && iso.dob >= iso.arrDt) errors.push('dob is not before arrival');

    const today = malaysiaTodayIso();
    if (iso.arrDt && iso.arrDt < today) errors.push('arrDt is in the past (Malaysia time)');

    if (errors.length || !iso.arrDt) return { errors };
    return { submission: { payload, arrivalIso: iso.arrDt }, errors };
}

export function malaysiaTodayIso(now = new Date()): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kuala_Lumpur',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(now);
    return parts;
}

/** The official form accepts a submission from three days before arrival. */
export function submissionWindowOpensAt(arrivalIso: string): number {
    return Date.parse(`${arrivalIso}T00:00:00Z`) - 3 * 86_400_000;
}

export function redemptionKey(payload: MdacOfficialPayload, arrivalIso: string): string {
    return `${payload.passNo}|${arrivalIso}`;
}
