import { describe, expect, it } from 'vitest';

import { supportsReferralPessimisticLock } from './referral.service';

describe('referral database locking', () => {
    it.each(['postgres', 'mysql', 'mariadb', 'mssql'])('keeps row locking enabled for %s', driverType => {
        expect(supportsReferralPessimisticLock(driverType)).toBe(true);
    });

    it.each(['sqljs', 'sqlite', 'better-sqlite3', 'unknown'])(
        'skips unsupported row locking for %s',
        driverType => {
            expect(supportsReferralPessimisticLock(driverType)).toBe(false);
        },
    );
});
