import { MigrationInterface, QueryRunner } from 'typeorm';

/** Materialize the existing 5-second fallback for the reviewed Flashcast storefront only. */
export class SeedFlashcastContentSettings1793952000000 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        const { driver, options } = runner.connection;
        const quote = (identifier: string) => driver.escape(identifier);
        const settings = quote('storefront_content_settings');
        const channelId = quote('channelId');
        const interval = quote('heroAutoplayIntervalSeconds');
        const code = `store.${quote('code')}`;
        const mysql = ['mysql', 'mariadb', 'aurora-mysql'].includes(options.type);
        const exactCode = mysql ? `CAST(${code} AS BINARY) = CAST(:code AS BINARY)` : `${code} = :code`;
        const preserveExisting = mysql
            ? `ON DUPLICATE KEY UPDATE ${interval} = ${settings}.${interval}`
            : `ON CONFLICT (${channelId}) DO NOTHING`;

        const [sql, parameters] = driver.escapeQueryWithParameters(
            `INSERT INTO ${settings} (${channelId}, ${interval})
             SELECT store.${quote('id')}, :interval FROM ${quote('channel')} store
             WHERE ${exactCode}
               AND EXISTS (
                   SELECT 1 FROM ${quote('store_profile')} profile
                   WHERE profile.${channelId} = store.${quote('id')} AND profile.${quote('status')} = 'ACTIVE'
               )
               AND EXISTS (
                   SELECT 1 FROM ${quote('store_domain')} binding
                   WHERE binding.${channelId} = store.${quote('id')}
                     AND binding.${quote('primaryChannelId')} = store.${quote('id')}
                     AND binding.${quote('domain')} = :domain
                     AND binding.${quote('status')} = 'ACTIVE'
                     AND binding.${quote('isPrimary')} = TRUE
                     AND binding.${quote('verifiedAt')} IS NOT NULL
               )
               AND NOT EXISTS (
                   SELECT 1 FROM ${settings} existing WHERE existing.${channelId} = store.${quote('id')}
               )
             ${preserveExisting}`,
            { interval: 5, code: 'flashcast-mall', domain: 'shop.flashcast.com.my' },
            {},
        );
        // The unique channel key protects an administrator's concurrent insert after the absence check.
        await runner.query(sql, parameters);
    }

    async down(): Promise<void> {
        // The settings row may already be managed by the store, so rollback preserves it.
    }
}
