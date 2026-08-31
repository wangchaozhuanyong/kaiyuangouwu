import 'reflect-metadata';

import { getMetadataArgsStorage } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { DashboardTwoFactorAccount } from './dashboard-two-factor-account.entity';

describe('DashboardTwoFactorAccount entity metadata', () => {
    it('registers encrypted database columns without a plaintext secret column', () => {
        const columns = getMetadataArgsStorage().columns.filter(
            column => column.target === DashboardTwoFactorAccount,
        );
        const propertyNames = columns.map(column => column.propertyName);

        expect(propertyNames).toEqual(
            expect.arrayContaining(['projectName', 'encryptedSecret', 'fingerprint', 'lastUsedAt']),
        );
        expect(propertyNames).not.toContain('secret');
    });

    it('prevents duplicate secrets for the same administrator', () => {
        const index = getMetadataArgsStorage().indices.find(
            item =>
                item.target === DashboardTwoFactorAccount &&
                item.name === 'IDX_dashboard_two_factor_owner_fingerprint',
        );

        expect(index).toMatchObject({
            columns: ['administratorId', 'fingerprint'],
            unique: true,
        });
    });

    it('deletes owned 2FA records when the administrator is deleted', () => {
        const relation = getMetadataArgsStorage().relations.find(
            item => item.target === DashboardTwoFactorAccount && item.propertyName === 'administrator',
        );

        expect(relation?.options).toMatchObject({ nullable: false, onDelete: 'CASCADE' });
    });
});
