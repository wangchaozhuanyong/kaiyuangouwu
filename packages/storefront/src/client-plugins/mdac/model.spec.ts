// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    emptyDraft,
    exportConfig,
    isIsoDate,
    malaysiaToday,
    normalizeFlightNumber,
    persistDraft,
    readDraft,
    STORAGE_KEY,
    suggestedDepartureDate,
    validateDates,
} from './model';
import { passportFields } from './ocr';

afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
});

describe('MDAC local data and export', () => {
    it('persists only by opt-in and removes just its own key', () => {
        localStorage.setItem('another-tool', 'keep');
        const draft = emptyDraft();
        draft.travelers[0].name = 'SYNTHETIC TEST';
        expect(persistDraft(draft, true)).toBe(true);
        expect(readDraft()).toEqual(draft);
        expect(persistDraft(draft, false)).toBe(true);
        expect(readDraft()).toBeNull();
        expect(localStorage.getItem('another-tool')).toBe('keep');
    });
    it('rejects corrupt, oversized and incompatible saved data', () => {
        for (const raw of [
            '{',
            'x'.repeat(100001),
            JSON.stringify({ ...emptyDraft(), version: 2 }),
            JSON.stringify({ ...emptyDraft(), travelers: [] }),
            JSON.stringify({ ...emptyDraft(), shared: { photo: 'unexpected payload' } }),
        ]) {
            localStorage.setItem(STORAGE_KEY, raw);
            expect(readDraft()).toBeNull();
        }
    });
    it('reports blocked storage without throwing or uploading data', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw Error('blocked');
        });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw Error('quota');
        });
        expect(readDraft()).toBeNull();
        expect(persistDraft(emptyDraft(), true)).toBe(false);
    });
    it('exports dates and accommodation in the upstream userscript format', () => {
        const draft = emptyDraft();
        draft.travelers = [
            { name: 'TEST ONE', dob: '1990-02-03', passExpDte: '2030-05-06' },
            { name: 'TEST TWO' },
        ];
        draft.shared = {
            arrDt: '2026-11-17',
            depDt: '2026-11-20',
            accommodationCity: 'KUALA LUMPUR',
            email: 'test@example.com',
        };
        expect(exportConfig(draft)).toMatchObject({
            shared: {
                arrDt: '17/11/2026',
                accommodation: { city: 'KUALA LUMPUR' },
                email: 'test@example.com',
            },
            travelers: [
                { label: 'TEST ONE', dob: '03/02/1990', passExpDte: '06/05/2030' },
                { label: 'TEST TWO' },
            ],
        });
    });
    it('checks real dates and uses Malaysia midnight rather than the device date', () => {
        expect(isIsoDate('2026-02-30')).toBe(false);
        expect(isIsoDate('2024-02-29')).toBe(true);
        expect(malaysiaToday(new Date('2026-11-16T16:01:00Z'))).toBe('2026-11-17');
        const person = { dob: '1990-01-01', passExpDte: '2030-01-01' };
        expect(validateDates(person, { arrDt: '2026-11-17', depDt: '2026-11-20' }, '2026-11-16')).toBe(true);
        expect(validateDates(person, { arrDt: '2026-11-17', depDt: '2026-11-16' }, '2026-11-16')).toBe(false);
    });
    it('defaults a fresh trip and counts arrival as the first of 30 calendar days', () => {
        expect(emptyDraft().shared).toEqual({
            region: '86',
            trvlMode: '1',
            embark: 'CHN',
            accommodationStay: '01',
        });
        expect(suggestedDepartureDate('2026-11-01')).toBe('2026-11-30');
        expect(suggestedDepartureDate('2026-12-20')).toBe('2027-01-18');
        expect(suggestedDepartureDate('2028-02-01')).toBe('2028-03-01');
        expect(suggestedDepartureDate('2026-02-29')).toBe('');
        expect(normalizeFlightNumber(' mh 123 ')).toBe('MH123');
    });
    it('uses verified MRZ fields and refuses a damaged passport checksum', () => {
        const sample =
            'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\nL898902C36UTO7408122F1204159ZE184226B<<<<<10';
        // Standard public ICAO sample, never a real customer document.
        expect(passportFields(sample)).toMatchObject({ passNo: 'L898902C3', dob: '1974-08-12', sex: '2' });
        expect(() => passportFields(sample.replace('L898902C36', 'L898902C35'))).toThrow();
        expect(passportFields('A'.repeat(44) + '\n' + sample)).toMatchObject({ passNo: 'L898902C3' });
        expect(() => passportFields(sample.replace('P<UTO', 'I<UTO'))).toThrow();
    });
});
