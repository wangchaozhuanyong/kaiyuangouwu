import { describe, expect, it } from 'vitest';

import { IcloudAccessCodeService } from './icloud-access-code.service';

describe('IcloudAccessCodeService', () => {
    const codeService = new IcloudAccessCodeService();

    describe('generateCode', () => {
        it('should generate a BUY-prefixed code by default', () => {
            const code = codeService.generateCode();
            expect(code).toMatch(/^BUY-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
        });

        it('should generate a MSTR-prefixed code', () => {
            const code = codeService.generateCode('MSTR');
            expect(code).toMatch(/^MSTR-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
        });

        it('should generate unique codes', () => {
            const codes = new Set<string>();
            for (let i = 0; i < 100; i++) {
                codes.add(codeService.generateCode());
            }
            expect(codes.size).toBe(100);
        });

        it('should not contain ambiguous characters (0, O, 1, I, L)', () => {
            for (let i = 0; i < 50; i++) {
                const code = codeService.generateCode();
                const body = code.replace(/^(BUY|MSTR)-/, '').replace(/-/g, '');
                expect(body).not.toMatch(/[01OIL]/);
            }
        });
    });

    describe('calculateExpiration', () => {
        it('should return null for 0 or negative days', () => {
            expect(codeService.calculateExpiration(0)).toBeNull();
            expect(codeService.calculateExpiration(-1)).toBeNull();
        });

        it('should return a future date for positive days', () => {
            const exp = codeService.calculateExpiration(30);
            expect(exp).toBeInstanceOf(Date);
            expect(exp?.getTime()).toBeGreaterThan(Date.now());
        });
    });

    describe('isExpired', () => {
        it('should return false for null/undefined', () => {
            expect(codeService.isExpired(null)).toBe(false);
            expect(codeService.isExpired(undefined)).toBe(false);
        });

        it('should return true for past date', () => {
            const pastDate = new Date('2020-01-01');
            expect(codeService.isExpired(pastDate)).toBe(true);
        });

        it('should return false for future date', () => {
            const future = new Date();
            future.setDate(future.getDate() + 30);
            expect(codeService.isExpired(future)).toBe(false);
        });
    });

    describe('getRemainingDays', () => {
        it('should return null for null expiration', () => {
            expect(codeService.getRemainingDays(null)).toBeNull();
        });

        it('should return 0 for past expiration', () => {
            expect(codeService.getRemainingDays(new Date('2020-01-01'))).toBe(0);
        });

        it('should return positive number for future expiration', () => {
            const future = new Date();
            future.setDate(future.getDate() + 15);
            const remaining = codeService.getRemainingDays(future);
            expect(remaining).toBeGreaterThanOrEqual(14);
            expect(remaining).toBeLessThanOrEqual(16);
        });
    });
});
