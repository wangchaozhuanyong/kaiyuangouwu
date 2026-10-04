import { MigrationInterface, QueryRunner } from 'typeorm';

/** Widen in place: TypeORM changeColumn can drop and recreate a changed type. */
export class ExpandIcloudMailBodies1791120600000 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        if (!['mysql', 'mariadb'].includes(runner.connection.options.type)) return;
        const table = await runner.getTable('icloud_received_mail');
        if (!table) throw new Error('Mail body migration requires icloud_received_mail');
        for (const name of ['bodyHtml', 'bodyText']) {
            const column = table.findColumnByName(name);
            if (!column || !['text', 'mediumtext', 'longtext'].includes(column.type)) {
                throw new Error(`Unexpected mail body column: ${name}`);
            }
            if (column.type === 'longtext') continue;
            if (!column.isNullable || column.comment || column.isGenerated) {
                throw new Error(`Unexpected mail body column attributes: ${name}`);
            }
            const encoding = [
                ['CHARACTER SET', column.charset],
                ['COLLATE', column.collation],
            ]
                .filter(([, value]) => value)
                .map(([keyword, value]) => {
                    if (typeof value !== 'string' || !/^[a-zA-Z0-9_]+$/.test(value)) {
                        throw new Error('Unexpected mail body encoding');
                    }
                    return ` ${keyword} ${value}`;
                })
                .join('');
            await runner.query(
                `ALTER TABLE \`icloud_received_mail\` MODIFY COLUMN \`${name}\` LONGTEXT${encoding} NULL`,
            );
        }
    }

    down(): Promise<void> {
        return Promise.reject(new Error('Retain complete mail bodies; use a forward migration.'));
    }
}
