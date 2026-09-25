// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    clearProductVisitTimes,
    filterProductsByVisitDate,
    groupProductsByVisitDate,
    readProductVisitTimes,
    recordProductVisit,
} from './browsing-history';

afterEach(() => {
    localStorage.clear();
    vi.useRealTimers();
});

describe('dated browsing history', () => {
    it('keeps legacy dates unknown and stores only real visits, isolated by store', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 8, 24, 12));
        expect(readProductVisitTimes('a', ['legacy'])).toEqual({});
        recordProductVisit('a', 'new', ['legacy'], 2);
        expect(readProductVisitTimes('a', ['new', 'legacy'])).toEqual({ new: Date.now() });
        expect(readProductVisitTimes('b', ['new'])).toEqual({});
        vi.advanceTimersByTime(60_000);
        recordProductVisit('a', 'new', ['new', 'legacy'], 2);
        expect(readProductVisitTimes('a', ['new']).new).toBe(Date.now());
        clearProductVisitTimes('a');
        expect(readProductVisitTimes('a', ['new'])).toEqual({});
    });
    it('groups visits by local calendar date and leaves unknown dates last', () => {
        const recent = new Date(2026, 8, 24, 1).getTime();
        const earlier = new Date(2026, 8, 23, 23).getTime();
        const groups = groupProductsByVisitDate([{ id: 'old' }, { id: 'a' }, { id: 'b' }, { id: 'c' }], {
            a: recent,
            b: earlier,
            c: recent + 1000,
        });
        expect(groups.map(group => group.products.map(product => product.id))).toEqual([
            ['a', 'c'],
            ['b'],
            ['old'],
        ]);
        expect(groups[2].date).toBeNull();
    });
    it('filters by calendar date across midnight and includes undated legacy records under earlier', () => {
        const now = new Date(2026, 8, 24, 0, 1);
        const products = ['old', 'today', 'yesterday', 'two', 'earlier'].map(id => ({ id }));
        const times = {
            today: now.getTime(),
            yesterday: new Date(2026, 8, 23, 23, 59).getTime(),
            two: new Date(2026, 8, 22, 23).getTime(),
            earlier: new Date(2026, 8, 10).getTime(),
        };
        const ids = (period: Parameters<typeof filterProductsByVisitDate>[2]) =>
            filterProductsByVisitDate(products, times, period, now).map(p => p.id);
        expect(ids('today')).toEqual(['today']);
        expect(ids('yesterday')).toEqual(['yesterday']);
        expect(ids('two-days-ago')).toEqual(['two']);
        expect(ids('earlier')).toEqual(['earlier', 'old']);
        expect(ids('all')).toEqual(['today', 'yesterday', 'two', 'earlier', 'old']);
        expect(filterProductsByVisitDate(products, {}, 'today', now)).toEqual([]);
    });
    it('limits stored visit timestamps and ignores corrupt storage', () => {
        recordProductVisit('a', 'a', [], 2);
        recordProductVisit('a', 'b', ['a'], 2);
        recordProductVisit('a', 'c', ['b', 'a'], 2);
        expect(Object.keys(readProductVisitTimes('a', ['a', 'b', 'c']))).toEqual(['b', 'c']);
        const key = localStorage.key(0);
        if (!key) throw new Error('Expected a stored visit key');
        localStorage.setItem(key, 'invalid JSON');
        expect(readProductVisitTimes('a', ['c'])).toEqual({});
    });
});
