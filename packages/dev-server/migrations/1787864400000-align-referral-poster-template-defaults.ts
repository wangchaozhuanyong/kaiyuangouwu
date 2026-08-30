import { MigrationInterface, QueryRunner } from 'typeorm';

const tableName = 'referral_poster_template';

const currentDefaults = {
    titleZh: 'AI 工具一站式服务',
    titleEn: 'One-stop AI service',
    headlineZh: '热门 AI 工具\n一站轻松获取',
    headlineEn: 'Popular AI tools\nmade easy',
    siteIntroZh: 'ChatGPT、Claude、Gemini、Codex 等\n热门 AI 服务，一个网站轻松了解与选择',
    siteIntroEn: 'ChatGPT, Claude, Gemini, Codex and more\nExplore practical AI services in one place',
    foregroundColor: '#0E2A63',
    accentColor: '#1269E8',
    overlayOpacity: 0,
} as const;

const previousDefaults = {
    titleZh: '好友邀请函',
    titleEn: 'Invitation for friends',
    headlineZh: '发现好东西，一起分享',
    headlineEn: 'Discover something worth sharing',
    siteIntroZh: '',
    siteIntroEn: '',
    foregroundColor: '#FFFFFF',
    accentColor: '#FF4D4F',
    overlayOpacity: 28,
} as const;

type PosterTemplateDefaults = Record<keyof typeof currentDefaults, string | number>;

/**
 * Aligns the database defaults with ReferralPosterTemplate without changing existing rows.
 *
 * The mobile poster-copy migration updated built-in records but left the original column
 * defaults behind, causing TypeORM to report schema drift on production MySQL.
 */
export class AlignReferralPosterTemplateDefaults1787864400000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await this.alignDefaults(queryRunner, currentDefaults);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await this.alignDefaults(queryRunner, previousDefaults);
    }

    private async alignDefaults(queryRunner: QueryRunner, defaults: PosterTemplateDefaults): Promise<void> {
        for (const [columnName, expectedDefault] of Object.entries(defaults)) {
            const table = await queryRunner.getTable(tableName);
            const column = table?.findColumnByName(columnName);
            if (!table || !column || this.normalizeDefault(column.default) === String(expectedDefault))
                continue;

            const aligned = column.clone();
            aligned.default =
                typeof expectedDefault === 'number'
                    ? expectedDefault
                    : `'${expectedDefault.replace(/'/g, "''")}'`;
            await queryRunner.changeColumn(table, column, aligned);
        }
    }

    private normalizeDefault(value: string | number | boolean | null | undefined): string | undefined {
        if (value == null) return undefined;

        let normalized = String(value).trim();
        while (normalized.startsWith('(') && normalized.endsWith(')')) {
            normalized = normalized.slice(1, -1).trim();
        }
        if (
            (normalized.startsWith("'") && normalized.endsWith("'")) ||
            (normalized.startsWith('"') && normalized.endsWith('"'))
        ) {
            normalized = normalized.slice(1, -1);
        }
        return normalized.replace(/''/g, "'");
    }
}
