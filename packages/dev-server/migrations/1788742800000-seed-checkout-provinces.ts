/* eslint-disable max-len -- Keep parameterized migration SQL as complete, reviewable statements. */
import { MigrationInterface, QueryRunner } from 'typeorm';

export interface CheckoutProvinceSeed {
    countryCode: 'CN' | 'MY';
    code: string;
    nameZh: string;
    nameEn: string;
}

export const checkoutProvinceSeeds: readonly CheckoutProvinceSeed[] = [
    { countryCode: 'CN', code: 'CN-BJ', nameZh: '北京市', nameEn: 'Beijing' },
    { countryCode: 'CN', code: 'CN-TJ', nameZh: '天津市', nameEn: 'Tianjin' },
    { countryCode: 'CN', code: 'CN-HE', nameZh: '河北省', nameEn: 'Hebei' },
    { countryCode: 'CN', code: 'CN-SX', nameZh: '山西省', nameEn: 'Shanxi' },
    { countryCode: 'CN', code: 'CN-NM', nameZh: '内蒙古自治区', nameEn: 'Inner Mongolia' },
    { countryCode: 'CN', code: 'CN-LN', nameZh: '辽宁省', nameEn: 'Liaoning' },
    { countryCode: 'CN', code: 'CN-JL', nameZh: '吉林省', nameEn: 'Jilin' },
    { countryCode: 'CN', code: 'CN-HL', nameZh: '黑龙江省', nameEn: 'Heilongjiang' },
    { countryCode: 'CN', code: 'CN-SH', nameZh: '上海市', nameEn: 'Shanghai' },
    { countryCode: 'CN', code: 'CN-JS', nameZh: '江苏省', nameEn: 'Jiangsu' },
    { countryCode: 'CN', code: 'CN-ZJ', nameZh: '浙江省', nameEn: 'Zhejiang' },
    { countryCode: 'CN', code: 'CN-AH', nameZh: '安徽省', nameEn: 'Anhui' },
    { countryCode: 'CN', code: 'CN-FJ', nameZh: '福建省', nameEn: 'Fujian' },
    { countryCode: 'CN', code: 'CN-JX', nameZh: '江西省', nameEn: 'Jiangxi' },
    { countryCode: 'CN', code: 'CN-SD', nameZh: '山东省', nameEn: 'Shandong' },
    { countryCode: 'CN', code: 'CN-HA', nameZh: '河南省', nameEn: 'Henan' },
    { countryCode: 'CN', code: 'CN-HB', nameZh: '湖北省', nameEn: 'Hubei' },
    { countryCode: 'CN', code: 'CN-HN', nameZh: '湖南省', nameEn: 'Hunan' },
    { countryCode: 'CN', code: 'CN-GD', nameZh: '广东省', nameEn: 'Guangdong' },
    { countryCode: 'CN', code: 'CN-GX', nameZh: '广西壮族自治区', nameEn: 'Guangxi' },
    { countryCode: 'CN', code: 'CN-HI', nameZh: '海南省', nameEn: 'Hainan' },
    { countryCode: 'CN', code: 'CN-CQ', nameZh: '重庆市', nameEn: 'Chongqing' },
    { countryCode: 'CN', code: 'CN-SC', nameZh: '四川省', nameEn: 'Sichuan' },
    { countryCode: 'CN', code: 'CN-GZ', nameZh: '贵州省', nameEn: 'Guizhou' },
    { countryCode: 'CN', code: 'CN-YN', nameZh: '云南省', nameEn: 'Yunnan' },
    { countryCode: 'CN', code: 'CN-XZ', nameZh: '西藏自治区', nameEn: 'Tibet' },
    { countryCode: 'CN', code: 'CN-SN', nameZh: '陕西省', nameEn: 'Shaanxi' },
    { countryCode: 'CN', code: 'CN-GS', nameZh: '甘肃省', nameEn: 'Gansu' },
    { countryCode: 'CN', code: 'CN-QH', nameZh: '青海省', nameEn: 'Qinghai' },
    { countryCode: 'CN', code: 'CN-NX', nameZh: '宁夏回族自治区', nameEn: 'Ningxia' },
    { countryCode: 'CN', code: 'CN-XJ', nameZh: '新疆维吾尔自治区', nameEn: 'Xinjiang' },
    { countryCode: 'CN', code: 'CN-TW', nameZh: '台湾省', nameEn: 'Taiwan' },
    { countryCode: 'CN', code: 'CN-HK', nameZh: '香港特别行政区', nameEn: 'Hong Kong' },
    { countryCode: 'CN', code: 'CN-MO', nameZh: '澳门特别行政区', nameEn: 'Macao' },
    { countryCode: 'MY', code: 'MY-01', nameZh: '柔佛', nameEn: 'Johor' },
    { countryCode: 'MY', code: 'MY-02', nameZh: '吉打', nameEn: 'Kedah' },
    { countryCode: 'MY', code: 'MY-03', nameZh: '吉兰丹', nameEn: 'Kelantan' },
    { countryCode: 'MY', code: 'MY-04', nameZh: '马六甲', nameEn: 'Melaka' },
    { countryCode: 'MY', code: 'MY-05', nameZh: '森美兰', nameEn: 'Negeri Sembilan' },
    { countryCode: 'MY', code: 'MY-06', nameZh: '彭亨', nameEn: 'Pahang' },
    { countryCode: 'MY', code: 'MY-07', nameZh: '槟城', nameEn: 'Pulau Pinang' },
    { countryCode: 'MY', code: 'MY-08', nameZh: '霹雳', nameEn: 'Perak' },
    { countryCode: 'MY', code: 'MY-09', nameZh: '玻璃市', nameEn: 'Perlis' },
    { countryCode: 'MY', code: 'MY-10', nameZh: '雪兰莪', nameEn: 'Selangor' },
    { countryCode: 'MY', code: 'MY-11', nameZh: '登嘉楼', nameEn: 'Terengganu' },
    { countryCode: 'MY', code: 'MY-12', nameZh: '沙巴', nameEn: 'Sabah' },
    { countryCode: 'MY', code: 'MY-13', nameZh: '砂拉越', nameEn: 'Sarawak' },
    { countryCode: 'MY', code: 'MY-14', nameZh: '吉隆坡', nameEn: 'Kuala Lumpur' },
    { countryCode: 'MY', code: 'MY-15', nameZh: '纳闽', nameEn: 'Labuan' },
    { countryCode: 'MY', code: 'MY-16', nameZh: '布城', nameEn: 'Putrajaya' },
];

interface IdRow {
    id: string | number;
    parentId?: string | number | null;
}

export class SeedCheckoutProvinces1788742800000 implements MigrationInterface {
    async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasTable('region')) || !(await queryRunner.hasTable('region_translation'))) {
            return;
        }

        const q = (identifier: string) => queryRunner.connection.driver.escape(identifier);
        const driverType = queryRunner.connection.options.type;
        const now = ['sqlite', 'better-sqlite3', 'sqljs'].includes(driverType)
            ? new Date().toISOString()
            : new Date();
        for (const seed of checkoutProvinceSeeds) {
            const [country] = (await queryRunner.query(
                `SELECT ${q('id')} AS id FROM ${q('region')} WHERE ${q('discriminator')} = ${this.p(1, queryRunner)} AND ${q('code')} = ${this.p(2, queryRunner)} LIMIT 1`,
                ['Country', seed.countryCode],
            )) as IdRow[];
            if (!country) continue;

            let [province] = (await queryRunner.query(
                `SELECT ${q('id')} AS id, ${q('parentId')} AS parentId FROM ${q('region')} WHERE ${q('discriminator')} = ${this.p(1, queryRunner)} AND ${q('code')} = ${this.p(2, queryRunner)} LIMIT 1`,
                ['Province', seed.code],
            )) as IdRow[];
            if (!province) {
                await queryRunner.query(
                    `INSERT INTO ${q('region')} (${q('createdAt')}, ${q('updatedAt')}, ${q('code')}, ${q('type')}, ${q('enabled')}, ${q('parentId')}, ${q('discriminator')}) VALUES (${this.placeholders(queryRunner, 7)})`,
                    [now, now, seed.code, 'province', true, country.id, 'Province'],
                );
                [province] = (await queryRunner.query(
                    `SELECT ${q('id')} AS id, ${q('parentId')} AS parentId FROM ${q('region')} WHERE ${q('discriminator')} = ${this.p(1, queryRunner)} AND ${q('code')} = ${this.p(2, queryRunner)} LIMIT 1`,
                    ['Province', seed.code],
                )) as IdRow[];
            } else if (province.parentId == null) {
                await queryRunner.query(
                    `UPDATE ${q('region')} SET ${q('parentId')} = ${this.p(1, queryRunner)}, ${q('updatedAt')} = ${this.p(2, queryRunner)} WHERE ${q('id')} = ${this.p(3, queryRunner)} AND ${q('parentId')} IS NULL`,
                    [country.id, now, province.id],
                );
            }
            if (!province) continue;

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
    }

    async down(): Promise<void> {
        // Province codes can be saved in customer addresses after rollout, so rollback preserves this reference data.
    }

    private p(index: number, queryRunner: QueryRunner): string {
        return queryRunner.connection.options.type === 'postgres' ? `$${index}` : '?';
    }

    private placeholders(queryRunner: QueryRunner, count: number): string {
        return Array.from({ length: count }, (_, index) => this.p(index + 1, queryRunner)).join(', ');
    }
}
