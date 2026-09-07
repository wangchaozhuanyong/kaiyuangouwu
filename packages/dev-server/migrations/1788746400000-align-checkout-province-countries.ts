/* eslint-disable max-len -- Keep parameterized migration SQL as complete, reviewable statements. */
import { MigrationInterface, QueryRunner } from 'typeorm';

import { CheckoutProvinceSeed, checkoutProvinceSeeds } from './1788742800000-seed-checkout-provinces';

interface IdRow {
    id: string | number;
}

const checkoutCountryNames: Record<CheckoutProvinceSeed['countryCode'], readonly string[]> = {
    CN: ['中国', 'China', '中华人民共和国'],
    MY: ['马来西亚', 'Malaysia'],
};

export class AlignCheckoutProvinceCountries1788746400000 implements MigrationInterface {
    async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasTable('region')) || !(await queryRunner.hasTable('region_translation'))) {
            return;
        }

        const q = (identifier: string) => queryRunner.connection.driver.escape(identifier);
        const driverType = queryRunner.connection.options.type;
        const now = ['sqlite', 'better-sqlite3', 'sqljs'].includes(driverType)
            ? new Date().toISOString()
            : new Date();

        for (const countryCode of ['CN', 'MY'] as const) {
            const countryNames = checkoutCountryNames[countryCode];
            const countries = (await queryRunner.query(
                `SELECT DISTINCT country.${q('id')} AS id FROM ${q('region')} country LEFT JOIN ${q('region_translation')} translation ON translation.${q('baseId')} = country.${q('id')} WHERE country.${q('discriminator')} = ${this.p(1, queryRunner)} AND country.${q('enabled')} = ${this.p(2, queryRunner)} AND (country.${q('code')} = ${this.p(3, queryRunner)} OR translation.${q('name')} IN (${this.placeholders(queryRunner, countryNames.length, 4)}))`,
                ['Country', true, countryCode, ...countryNames],
            )) as IdRow[];

            for (const country of countries) {
                for (const seed of checkoutProvinceSeeds.filter(item => item.countryCode === countryCode)) {
                    await this.seedProvince(queryRunner, country.id, seed, now);
                }
            }
        }
    }

    async down(): Promise<void> {
        // Province codes can be saved in customer addresses after rollout, so rollback preserves this reference data.
    }

    private async seedProvince(
        queryRunner: QueryRunner,
        countryId: string | number,
        seed: CheckoutProvinceSeed,
        now: Date | string,
    ): Promise<void> {
        const q = (identifier: string) => queryRunner.connection.driver.escape(identifier);
        let [province] = (await queryRunner.query(
            `SELECT ${q('id')} AS id FROM ${q('region')} WHERE ${q('discriminator')} = ${this.p(1, queryRunner)} AND ${q('code')} = ${this.p(2, queryRunner)} AND ${q('parentId')} = ${this.p(3, queryRunner)} LIMIT 1`,
            ['Province', seed.code, countryId],
        )) as IdRow[];
        if (!province) {
            await queryRunner.query(
                `INSERT INTO ${q('region')} (${q('createdAt')}, ${q('updatedAt')}, ${q('code')}, ${q('type')}, ${q('enabled')}, ${q('parentId')}, ${q('discriminator')}) VALUES (${this.placeholders(queryRunner, 7)})`,
                [now, now, seed.code, 'province', true, countryId, 'Province'],
            );
            [province] = (await queryRunner.query(
                `SELECT ${q('id')} AS id FROM ${q('region')} WHERE ${q('discriminator')} = ${this.p(1, queryRunner)} AND ${q('code')} = ${this.p(2, queryRunner)} AND ${q('parentId')} = ${this.p(3, queryRunner)} LIMIT 1`,
                ['Province', seed.code, countryId],
            )) as IdRow[];
        }
        if (!province) return;

        for (const [languageCode, name] of [
            ['zh_Hans', seed.nameZh],
            ['en', seed.nameEn],
        ] as const) {
            const [translation] = (await queryRunner.query(
                `SELECT ${q('id')} AS id FROM ${q('region_translation')} WHERE ${q('baseId')} = ${this.p(1, queryRunner)} AND ${q('languageCode')} = ${this.p(2, queryRunner)} LIMIT 1`,
                [province.id, languageCode],
            )) as IdRow[];
            if (translation) continue;
            await queryRunner.query(
                `INSERT INTO ${q('region_translation')} (${q('createdAt')}, ${q('updatedAt')}, ${q('languageCode')}, ${q('name')}, ${q('baseId')}) VALUES (${this.placeholders(queryRunner, 5)})`,
                [now, now, languageCode, name, province.id],
            );
        }
    }

    private p(index: number, queryRunner: QueryRunner): string {
        return queryRunner.connection.options.type === 'postgres' ? `$${index}` : '?';
    }

    private placeholders(queryRunner: QueryRunner, count: number, start = 1): string {
        return Array.from({ length: count }, (_, index) => this.p(start + index, queryRunner)).join(', ');
    }
}
