import { MigrationInterface, QueryRunner, TableColumn, TableColumnOptions } from 'typeorm';

const mobilePosterCopyColumns: Array<Pick<TableColumnOptions, 'name' | 'type' | 'length' | 'default'>> = [
    { name: 'featureOneTitleZh', type: 'varchar', length: '100', default: "'热门工具汇集'" },
    { name: 'featureOneTitleEn', type: 'varchar', length: '100', default: "'精选 AI tools'" },
    { name: 'featureOneTextZh', type: 'varchar', length: '160', default: "'多种 AI 工具任你选'" },
    { name: 'featureOneTextEn', type: 'varchar', length: '160', default: "'A curated set of AI tools'" },
    { name: 'featureTwoTitleZh', type: 'varchar', length: '100', default: "'便捷开通服务'" },
    { name: 'featureTwoTitleEn', type: 'varchar', length: '100', default: "'Fast activation'" },
    { name: 'featureTwoTextZh', type: 'varchar', length: '160', default: "'快速开通 省时省心'" },
    { name: 'featureTwoTextEn', type: 'varchar', length: '160', default: "'Get started in a few clicks'" },
    { name: 'featureThreeTitleZh', type: 'varchar', length: '100', default: "'专属售后支持'" },
    { name: 'featureThreeTitleEn', type: 'varchar', length: '100', default: "'Dedicated support'" },
    { name: 'featureThreeTextZh', type: 'varchar', length: '160', default: "'专业客服 贴心服务'" },
    {
        name: 'featureThreeTextEn',
        type: 'varchar',
        length: '160',
        default: "'Friendly help when you need it'",
    },
    { name: 'qrEyebrowZh', type: 'varchar', length: '100', default: "'扫码访问云桥 AI'" },
    { name: 'qrEyebrowEn', type: 'varchar', length: '100', default: "'Scan CloudBridge AI'" },
    { name: 'qrTitleZh', type: 'varchar', length: '140', default: "'发现更多实用 AI 服务'" },
    { name: 'qrTitleEn', type: 'varchar', length: '140', default: "'Discover practical AI services'" },
    { name: 'qrDescriptionZh', type: 'varchar', length: '140', default: "'满足多种 AI 使用场景'" },
    {
        name: 'qrDescriptionEn',
        type: 'varchar',
        length: '140',
        default: "'Tools for work, creativity, learning and code'",
    },
    { name: 'sceneOneZh', type: 'varchar', length: '48', default: "'办公提效'" },
    { name: 'sceneOneEn', type: 'varchar', length: '48', default: "'Work'" },
    { name: 'sceneTwoZh', type: 'varchar', length: '48', default: "'内容创作'" },
    { name: 'sceneTwoEn', type: 'varchar', length: '48', default: "'Create'" },
    { name: 'sceneThreeZh', type: 'varchar', length: '48', default: "'学习辅助'" },
    { name: 'sceneThreeEn', type: 'varchar', length: '48', default: "'Learn'" },
    { name: 'sceneFourZh', type: 'varchar', length: '48', default: "'智能编程'" },
    { name: 'sceneFourEn', type: 'varchar', length: '48', default: "'Code'" },
    {
        name: 'ctaTextZh',
        type: 'varchar',
        length: '140',
        default: "'长按识别二维码，立即进入云桥 AI'",
    },
    {
        name: 'ctaTextEn',
        type: 'varchar',
        length: '140',
        default: "'Press and hold to enter CloudBridge AI'",
    },
    { name: 'footerTitleZh', type: 'varchar', length: '160', default: "'让好用的 AI，真正为你所用'" },
    { name: 'footerTitleEn', type: 'varchar', length: '160', default: "'AI that works for you'" },
    {
        name: 'footerTextZh',
        type: 'varchar',
        length: '220',
        default: "'热门 AI 工具与数字服务一站式平台'",
    },
    {
        name: 'footerTextEn',
        type: 'varchar',
        length: '220',
        default: "'One-stop platform for AI tools and digital services'",
    },
];

/**
 * Repairs databases where AddMobileReferralPosterCopy was recorded as applied before a later
 * SQLite alignment recreated referral_poster_template without the mobile poster copy columns.
 */
export class RepairReferralPosterTemplateCopy1788274800000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasTable('referral_poster_template'))) return;
        const table = await queryRunner.getTable('referral_poster_template');
        const missingColumns = mobilePosterCopyColumns.filter(
            column => !table?.findColumnByName(column.name),
        );
        if (!missingColumns.length) return;

        await queryRunner.addColumns(
            'referral_poster_template',
            missingColumns.map(
                column =>
                    new TableColumn({
                        ...column,
                        isNullable: false,
                    }),
            ),
        );
    }

    public async down(): Promise<void> {
        // Deliberately non-destructive: these columns may have been created by the original migration,
        // and removing them would delete merchant-authored poster copy from already healthy databases.
    }
}
