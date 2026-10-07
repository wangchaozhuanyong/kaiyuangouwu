import { describe, expect, it } from 'vitest';
import { normalizeBase32Secret } from '../../src/pages/Plugins/two-factor-utils';
import { adminRolloutFixtureData } from './admin-rollout-fixture-data';

const base = {
    activeChannel: { id: 'fixture-channel', code: 'fixture-store', defaultCurrencyCode: 'MYR' },
    jobQueues: [{ name: 'translate-content', running: true }],
    manageableAdministrators: [{ id: 'fixture-member' }],
    manageableRoles: [{ id: 'fixture-role' }],
};

describe('30-page synthetic rollout fixture', () => {
    it('preserves shared identity and does not mutate the original fixture', () => {
        const result = adminRolloutFixtureData(base, {}, false);
        expect(result.activeChannel).toMatchObject(base.activeChannel);
        expect(base).not.toHaveProperty('imageGenerationJobs');
        expect(result.myStoreProfile).toMatchObject({ channel: { id: 'fixture-channel' } });
    });

    it('models server pagination and state filtering independently', () => {
        expect(adminRolloutFixtureData(base, {}, false).imageGenerationJobs).toMatchObject({
            totalItems: 23,
        });
        const second = adminRolloutFixtureData(base, { skip: 20, take: 20 }, false).imageGenerationJobs as {
            items: unknown[];
        };
        expect(second.items).toHaveLength(3);
        const failed = adminRolloutFixtureData(base, { state: 'FAILED', take: 50 }, false)
            .imageGenerationJobs as { items: { state: string }[] };
        expect(failed.items.length).toBeGreaterThan(0);
        expect(failed.items.every(item => item.state === 'FAILED')).toBe(true);
    });

    it('supports empty lists while retaining form configuration and scope', () => {
        const result = adminRolloutFixtureData(base, {}, true);
        for (const root of [
            'imageGenerationJobs',
            'apiKeys',
            'countries',
            'zones',
            'taxCategories',
            'taxRates',
            'referralLedger',
            'referralWithdrawals',
        ]) {
            expect(result[root]).toMatchObject({ items: [], totalItems: 0 });
        }
        for (const root of [
            'dashboardTwoFactorAccounts',
            'systemAnnouncements',
            'imagePromptSkillReleases',
            'scheduledTasks',
            'manageableAdministrators',
            'manageableRoles',
        ]) {
            expect(result[root]).toEqual([]);
        }
        expect(result.imageGenerationAdminConfig).toMatchObject({ models: [] });
        expect(result.myStoreProfile).toBeTruthy();
    });

    it('uses nonfunctional secret placeholders and full synthetic rule hashes', () => {
        const result = adminRolloutFixtureData(base, {}, false);
        const accounts = result.dashboardTwoFactorAccounts as { secret: string }[];
        for (const account of accounts) expect(() => normalizeBase32Secret(account.secret)).toThrow();
        const releases = result.imagePromptSkillReleases as { sourceHash: string }[];
        expect(releases).toHaveLength(3);
        expect(releases.every(release => /^[a-f0-9]{64}$/.test(release.sourceHash))).toBe(true);
        const keys = result.apiKeys as { items: Record<string, unknown>[] };
        expect(keys.items.every(key => !('apiKey' in key) && !('secret' in key))).toBe(true);
    });
});
