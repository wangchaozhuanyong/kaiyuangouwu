import { MigrationInterface, QueryRunner } from 'typeorm';

interface ChannelRow {
    id: string | number;
}

interface ProfileOrderRow {
    channelId: string | number;
    sortOrder: number;
}

export class BackfillMissingStoreProfiles1787605200000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasTable('channel')) || !(await queryRunner.hasTable('store_profile'))) {
            return;
        }

        const channelRows = (await queryRunner.query(
            `SELECT ${this.quote('id', queryRunner)} FROM ${this.quote('channel', queryRunner)} ` +
                `ORDER BY ${this.quote('id', queryRunner)} ASC`,
        )) as ChannelRow[];
        const profileRows = (await queryRunner.query(
            `SELECT ${this.quote('channelId', queryRunner)}, ${this.quote('sortOrder', queryRunner)} ` +
                `FROM ${this.quote('store_profile', queryRunner)}`,
        )) as ProfileOrderRow[];
        const profiledChannelIds = new Set(profileRows.map(row => String(row.channelId)));
        const missingChannels = channelRows.filter(row => !profiledChannelIds.has(String(row.id)));
        if (missingChannels.length === 0) return;

        const highestSortOrder = profileRows.reduce(
            (highest, row) => Math.max(highest, Number(row.sortOrder) || 0),
            -1,
        );
        await queryRunner.manager
            .createQueryBuilder()
            .insert()
            .into('store_profile')
            .values(
                missingChannels.map((channel, index) => ({
                    channelId: channel.id,
                    status: 'DRAFT',
                    isPublished: false,
                    sortOrder: highestSortOrder + index + 1,
                    descriptionZh: '',
                    descriptionEn: '',
                    internalNote: null,
                    logoAssetId: null,
                })),
            )
            .execute();
    }

    public async down(): Promise<void> {
        // Existing and backfilled profiles are intentionally preserved to avoid deleting store data.
    }

    private quote(identifier: string, queryRunner: QueryRunner): string {
        const quote = ['mysql', 'mariadb'].includes(queryRunner.connection.options.type) ? '`' : '"';
        return `${quote}${identifier}${quote}`;
    }
}
