import options from './official-options.json';

export type Fields = Record<string, string>;

export class PassportReadError extends Error {
    constructor(readonly code: 'image' | 'recognition') {
        super(code);
    }
}

export interface Draft {
    version: 1;
    travelers: Fields[];
    shared: Fields;
    departureSource?: 'suggested' | 'manual';
}
export const STORAGE_KEY = 'storefront-mdac:v1';
// A single non-personal value replaces the entire draft atomically on opt-out.
const SAVING_DISABLED = 'off';
export function draftSavingPreference(): boolean | null {
    try {
        return localStorage.getItem(STORAGE_KEY) !== SAVING_DISABLED;
    } catch {
        return null;
    }
}
export function disableDraftSaving(): boolean {
    try {
        localStorage.setItem(STORAGE_KEY, SAVING_DISABLED);
        return true;
    } catch {
        // Some browsers reject writes at quota but still allow removal of the personal data.
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch {
            // The caller reports a storage failure and keeps automatic saving off.
        }
        return false;
    }
}
export const OFFICIAL_URL = 'https://imigresen-online.imi.gov.my/mdac/register';
export interface Field {
    key: string;
    zh: string;
    en: string;
    type?: string;
    options?: string[][];
    optional?: boolean;
    maxLength?: number;
    pattern?: string;
}
export const personalFields: Field[] = [
    { key: 'name', zh: '护照英文姓名', en: 'Full name on passport', maxLength: 60, pattern: '[A-Za-z ]+' },
    { key: 'passNo', zh: '护照号码', en: 'Passport number', maxLength: 12, pattern: '[A-Za-z0-9]+' },
    { key: 'nationality', zh: '国籍', en: 'Nationality', options: options.nationality },
    { key: 'pob', zh: '出生地', en: 'Place of birth', options: options.pob },
    { key: 'dob', zh: '出生日期', en: 'Date of birth', type: 'date' },
    { key: 'sex', zh: '性别', en: 'Sex', options: options.sex },
    { key: 'passExpDte', zh: '护照到期日', en: 'Passport expiry', type: 'date' },
];
const priorityCallingCodes = ['60', '86'];
const callingCodes = [
    ...options.region.filter(([code]) => priorityCallingCodes.includes(code)),
    ...options.region.filter(([code]) => !priorityCallingCodes.includes(code)),
];
export const AIR_TRAVEL = '1';
export const HOTEL_STAY = '01';

export const contactFields: Field[] = [
    { key: 'email', zh: '回执邮箱', en: 'Email', type: 'email', maxLength: 100 },
    { key: 'region', zh: '电话区号', en: 'Calling code', options: callingCodes },
    { key: 'mobile', zh: '电话号码', en: 'Phone number', type: 'tel', maxLength: 12, pattern: '[0-9]+' },
];
export const travelFields: Field[] = [
    { key: 'arrDt', zh: '抵达日期', en: 'Arrival date', type: 'date' },
    { key: 'depDt', zh: '离境日期', en: 'Departure date', type: 'date' },
    { key: 'vesselNm', zh: '航班／交通工具编号', en: 'Flight / transportation number', maxLength: 30 },
    { key: 'trvlMode', zh: '入境方式', en: 'Travel mode', options: options.trvlMode },
    { key: 'embark', zh: '抵马前最后出发地', en: 'Last port of embarkation', options: options.embark },
];
export const lodgingFields: Field[] = [
    {
        key: 'accommodationStay',
        zh: '住宿类型',
        en: 'Accommodation type',
        options: options.accommodationStay,
    },
    { key: 'accommodationAddress1', zh: '在马来西亚的住宿地址', en: 'Address in Malaysia', maxLength: 100 },
    { key: 'accommodationAddress2', zh: '地址补充', en: 'Address line 2', optional: true, maxLength: 100 },
    { key: 'accommodationState', zh: '州属', en: 'State', options: options.accommodationState },
    { key: 'accommodationCity', zh: '城市英文名称', en: 'City (English)' },
    { key: 'accommodationPostcode', zh: '邮编', en: 'Postcode', maxLength: 5, pattern: '[0-9]{5}' },
];
export const tripFields = [...contactFields, ...travelFields, ...lodgingFields];
export function invalidPersonalField(person: Fields, today: string): Field | undefined {
    return personalFields.find(field => {
        const raw = person[field.key];
        const value = raw?.trim();
        return (
            !value ||
            value.length > (field.maxLength ?? 250) ||
            (field.pattern && !new RegExp(`^${field.pattern}$`).test(value)) ||
            (field.options && !field.options.some(([code]) => code === value)) ||
            (field.type === 'date' && !isIsoDate(raw)) ||
            (field.key === 'dob' && value > today) ||
            (field.key === 'passExpDte' && value <= today)
        );
    });
}
export function emptyDraft(): Draft {
    return {
        version: 1,
        travelers: [{}],
        shared: { region: '86', trvlMode: AIR_TRAVEL, embark: 'CHN', accommodationStay: HOTEL_STAY },
    };
}
export function validDraft(value: unknown): value is Draft {
    if (!value || typeof value !== 'object') return false;
    const draft = value as Draft;
    if (
        Object.keys(draft).some(key => !['version', 'travelers', 'shared', 'departureSource'].includes(key))
    ) {
        return false;
    }
    const validFields = (fields: unknown, allowed: Field[]) =>
        Boolean(
            fields &&
            typeof fields === 'object' &&
            !Array.isArray(fields) &&
            Object.entries(fields).every(
                ([key, item]) =>
                    allowed.some(field => field.key === key) &&
                    typeof item === 'string' &&
                    item.length <= 250,
            ),
        );
    return (
        draft.version === 1 &&
        (draft.departureSource === undefined ||
            draft.departureSource === 'suggested' ||
            draft.departureSource === 'manual') &&
        Array.isArray(draft.travelers) &&
        draft.travelers.length > 0 &&
        draft.travelers.length <= 20 &&
        draft.travelers.every(traveler => validFields(traveler, personalFields)) &&
        validFields(draft.shared, tripFields)
    );
}
export function readDraft(): Draft | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw || raw === SAVING_DISABLED || raw.length > 100000) return null;
        const value: unknown = JSON.parse(raw);
        return validDraft(value) ? value : null;
    } catch {
        return null;
    }
}
export function persistDraft(draft: Draft, remember: boolean): boolean {
    try {
        if (remember) localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
        else localStorage.removeItem(STORAGE_KEY);
        return true;
    } catch {
        return false;
    }
}
export function dateForOfficial(value: string): string {
    return value ? value.split('-').reverse().join('/') : '';
}
export function exportConfig(draft: Draft) {
    const s = draft.shared;
    return {
        shared: {
            arrDt: dateForOfficial(s.arrDt),
            depDt: dateForOfficial(s.depDt),
            trvlMode: s.trvlMode,
            embark: s.embark,
            vesselNm: s.vesselNm,
            email: s.email,
            region: s.region,
            mobile: s.mobile,
            accommodation: {
                stay: s.accommodationStay,
                address1: s.accommodationAddress1,
                address2: s.accommodationAddress2,
                state: s.accommodationState,
                city: s.accommodationCity,
                postcode: s.accommodationPostcode,
            },
        },
        travelers: draft.travelers.map(t => ({
            ...t,
            label: t.name,
            dob: dateForOfficial(t.dob),
            passExpDte: dateForOfficial(t.passExpDte),
        })),
    };
}
export function invalidTripDate(shared: Fields, today: string): 'arrDt' | 'depDt' | undefined {
    if (!isIsoDate(shared.arrDt) || shared.arrDt < today) return 'arrDt';
    if (!isIsoDate(shared.depDt) || shared.depDt < shared.arrDt) return 'depDt';
}

export function isIsoDate(value: string | undefined): boolean {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function suggestedDepartureDate(arrival: string): string {
    if (!isIsoDate(arrival)) return '';
    const date = new Date(`${arrival}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 29);
    const result = date.toISOString().split('T')[0];
    return isIsoDate(result) ? result : '';
}

export function normalizeFlightNumber(value: string): string {
    return value.toUpperCase().replace(/\s+/gu, '');
}

export function malaysiaToday(now = new Date()): string {
    const parts = new Intl.DateTimeFormat('en', {
        timeZone: 'Asia/Kuala_Lumpur',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(now);
    return ['year', 'month', 'day']
        .map(type => {
            const part = parts.find(item => item.type === type);
            if (!part) throw new Error('Could not format the Malaysian date');
            return part.value;
        })
        .join('-');
}
