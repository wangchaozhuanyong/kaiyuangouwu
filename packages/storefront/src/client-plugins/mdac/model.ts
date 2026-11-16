import options from './official-options.json';

export type Fields = Record<string, string>;
export interface Draft {
    version: 1;
    travelers: Fields[];
    shared: Fields;
}
export const STORAGE_KEY = 'storefront-mdac:v1';
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
export const tripFields: Field[] = [
    { key: 'email', zh: '回执邮箱', en: 'Email', type: 'email', maxLength: 100 },
    { key: 'region', zh: '电话区号', en: 'Calling code', options: options.region },
    { key: 'mobile', zh: '电话号码', en: 'Phone number', type: 'tel', maxLength: 12, pattern: '[0-9]+' },
    { key: 'arrDt', zh: '抵达日期', en: 'Arrival date', type: 'date' },
    { key: 'depDt', zh: '离境日期', en: 'Departure date', type: 'date' },
    { key: 'vesselNm', zh: '航班／交通工具编号', en: 'Flight / transportation number', maxLength: 30 },
    { key: 'trvlMode', zh: '入境方式', en: 'Travel mode', options: options.trvlMode },
    { key: 'embark', zh: '抵马前最后出发地', en: 'Last port of embarkation', options: options.embark },
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
export function validPersonalFields(person: Fields): boolean {
    return personalFields.every(field => {
        const value = person[field.key]?.trim();
        return Boolean(
            value &&
            value.length <= (field.maxLength ?? 250) &&
            (!field.pattern || new RegExp(`^${field.pattern}$`).test(value)) &&
            (!field.options || field.options.some(([code]) => code === value)),
        );
    });
}
export function emptyDraft(): Draft {
    return { version: 1, travelers: [{}], shared: {} };
}
export function validDraft(value: unknown): value is Draft {
    if (!value || typeof value !== 'object') return false;
    const draft = value as Draft;
    if (Object.keys(draft).some(key => !['version', 'travelers', 'shared'].includes(key))) return false;
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
        if (!raw || raw.length > 100000) return null;
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
export function validateDates(person: Fields, shared: Fields, today: string): boolean {
    return Boolean(
        [person.dob, person.passExpDte, shared.arrDt, shared.depDt].every(isIsoDate) &&
        person.dob <= today &&
        person.passExpDte > shared.arrDt &&
        shared.depDt >= shared.arrDt &&
        shared.arrDt >= today,
    );
}

export function isIsoDate(value: string | undefined): boolean {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
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
