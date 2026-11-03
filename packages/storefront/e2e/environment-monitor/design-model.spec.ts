import { describe, expect, it } from 'vitest';

import { checkFollowUp, checks, sampleFor, scoreContributions, scoreRationale } from './design-model';

describe('environment monitor design specification', () => {
    it('reproduces the observed reference example using individual rounded contributions', () => {
        const sample = sampleFor('typical');
        expect(sample.contributions).toEqual([9, 20, 12, 16, 0, 0, 0, 6, 3, 1, 0, 0]);
        expect(sample.score).toBe(67);
    });
    it('caps the sum at 100 rather than normalizing the weights', () => {
        expect(scoreContributions(checks.map(() => 1)).score).toBe(100);
        expect(checks.reduce((sum, check) => sum + check.weight, 0)).toBe(112);
        expect(checks.find(check => check.id === 'timezoneOffset')?.weight).toBe(4);
    });
    it('keeps failed scoring inputs unknown and informational rows unscored', () => {
        expect(scoreContributions([0, 0, 0, null, 0, 0, 0, 0, 0, 0, null, null]).score).toBeNull();
        expect(scoreContributions([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, null, null]).score).toBe(0);
    });
    it('has complete bilingual content for all twelve rows and every scenario', () => {
        expect(checks).toHaveLength(12);
        expect(checks.filter(check => check.weight > 0)).toHaveLength(10);
        for (const check of checks) {
            for (const pair of [
                check.title,
                check.description,
                check.explanation,
                check.advice,
                scoreRationale[check.id],
                checkFollowUp[check.id],
            ]) {
                expect(pair).toHaveLength(2);
                expect(pair[0]).toMatch(/\p{Script=Han}/u);
                expect(pair[1]).toMatch(/[A-Za-z]/);
            }
        }
        expect(sampleFor('low').score).toBe(1);
        expect(sampleFor('high').score).toBe(100);
        expect(sampleFor('partial').score).toBe(67);
        expect(sampleFor('unavailable').score).toBeNull();
        expect(sampleFor('unavailable').contributions[3]).toBeNull();
    });
});
