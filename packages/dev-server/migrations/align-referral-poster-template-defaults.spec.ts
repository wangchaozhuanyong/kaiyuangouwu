import { DataSource, QueryRunner, Table, TableColumn } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AlignReferralPosterTemplateDefaults1787864400000 } from './1787864400000-align-referral-poster-template-defaults';

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

function quoted(value: string | number): string | number {
    return typeof value === 'number' ? value : `'${value}'`;
}

function createTable(defaults: typeof currentDefaults | typeof previousDefaults): Table {
    return new Table({
        name: 'referral_poster_template',
        columns: [
            new TableColumn({ name: 'id', type: 'int', isPrimary: true }),
            ...Object.entries(defaults).map(
                ([name, defaultValue]) =>
                    new TableColumn({
                        name,
                        type: typeof defaultValue === 'number' ? 'int' : 'varchar',
                        ...(typeof defaultValue === 'string' ? { length: '260' } : {}),
                        default: quoted(defaultValue),
                    }),
            ),
        ],
    });
}

function normalizeDefault(value: string | number | undefined): string | undefined {
    if (value == null) return undefined;
    return String(value)
        .replace(/^['"]|['"]$/gu, '')
        .replaceAll("''", "'");
}

describe('referral poster template default alignment', () => {
    it.each(['mysql', 'mariadb'] as const)(
        'aligns all stale defaults for %s without data writes',
        async type => {
            const table = createTable(previousDefaults);
            const changeColumn = vi.fn((_table: Table, current: TableColumn, aligned: TableColumn) => {
                current.default = aligned.default;
            });
            const queryRunner = {
                connection: { options: { type } },
                getTable: vi.fn().mockResolvedValue(table),
                changeColumn,
            } as unknown as QueryRunner;

            const migration = new AlignReferralPosterTemplateDefaults1787864400000();
            await migration.up(queryRunner);

            expect(changeColumn).toHaveBeenCalledTimes(9);
            expect(
                Object.fromEntries(
                    changeColumn.mock.calls.map(([, , aligned]) => [aligned.name, aligned.default]),
                ),
            ).toEqual(
                Object.fromEntries(
                    Object.entries(currentDefaults).map(([name, value]) => [name, quoted(value)]),
                ),
            );

            changeColumn.mockClear();
            await migration.up(queryRunner);
            expect(changeColumn).not.toHaveBeenCalled();
        },
    );

    it('restores the previous defaults on rollback', async () => {
        const table = createTable(currentDefaults);
        const changeColumn = vi.fn((_table: Table, current: TableColumn, aligned: TableColumn) => {
            current.default = aligned.default;
        });
        const queryRunner = {
            connection: { options: { type: 'mysql' } },
            getTable: vi.fn().mockResolvedValue(table),
            changeColumn,
        } as unknown as QueryRunner;

        await new AlignReferralPosterTemplateDefaults1787864400000().down(queryRunner);

        expect(changeColumn).toHaveBeenCalledTimes(9);
        expect(
            Object.fromEntries(
                changeColumn.mock.calls.map(([, , aligned]) => [aligned.name, aligned.default]),
            ),
        ).toEqual(
            Object.fromEntries(
                Object.entries(previousDefaults).map(([name, value]) => [name, quoted(value)]),
            ),
        );
    });

    it('leaves existing rows unchanged in a real SQL.js database', async () => {
        const dataSource = new DataSource({ type: 'sqljs', entities: [], synchronize: false });
        await dataSource.initialize();
        const queryRunner = dataSource.createQueryRunner();
        try {
            await queryRunner.createTable(createTable(previousDefaults));
            await queryRunner.query('INSERT INTO "referral_poster_template" ("id") VALUES (1)');
            const before = await queryRunner.query('SELECT * FROM "referral_poster_template" WHERE "id" = 1');

            const migration = new AlignReferralPosterTemplateDefaults1787864400000();
            await migration.up(queryRunner);

            const after = await queryRunner.query('SELECT * FROM "referral_poster_template" WHERE "id" = 1');
            expect(after).toEqual(before);
            const alignedTable = await queryRunner.getTable('referral_poster_template');
            for (const [name, value] of Object.entries(currentDefaults)) {
                expect(normalizeDefault(alignedTable?.findColumnByName(name)?.default)).toBe(String(value));
            }
        } finally {
            await queryRunner.release();
            await dataSource.destroy();
        }
    });

    it('does nothing when the table is absent', async () => {
        const changeColumn = vi.fn();
        const queryRunner = {
            connection: { options: { type: 'mysql' } },
            getTable: vi.fn().mockResolvedValue(undefined),
            changeColumn,
        } as unknown as QueryRunner;

        await new AlignReferralPosterTemplateDefaults1787864400000().up(queryRunner);

        expect(changeColumn).not.toHaveBeenCalled();
    });
});
