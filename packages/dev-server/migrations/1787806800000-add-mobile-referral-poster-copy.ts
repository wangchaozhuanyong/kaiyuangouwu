import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddMobileReferralPosterCopy1787806800000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasTable('referral_poster_template'))) return;
        const columns: Array<{ name: string; length: string; default: string }> = [
            { name: 'featureOneTitleZh', length: '100', default: "'热门工具汇集'" },
            { name: 'featureOneTitleEn', length: '100', default: "'精选 AI tools'" },
            { name: 'featureOneTextZh', length: '160', default: "'多种 AI 工具任你选'" },
            { name: 'featureOneTextEn', length: '160', default: "'A curated set of AI tools'" },
            { name: 'featureTwoTitleZh', length: '100', default: "'便捷开通服务'" },
            { name: 'featureTwoTitleEn', length: '100', default: "'Fast activation'" },
            { name: 'featureTwoTextZh', length: '160', default: "'快速开通 省时省心'" },
            { name: 'featureTwoTextEn', length: '160', default: "'Get started in a few clicks'" },
            { name: 'featureThreeTitleZh', length: '100', default: "'专属售后支持'" },
            { name: 'featureThreeTitleEn', length: '100', default: "'Dedicated support'" },
            { name: 'featureThreeTextZh', length: '160', default: "'专业客服 贴心服务'" },
            { name: 'featureThreeTextEn', length: '160', default: "'Friendly help when you need it'" },
            { name: 'qrEyebrowZh', length: '100', default: "'扫码访问云桥 AI'" },
            { name: 'qrEyebrowEn', length: '100', default: "'Scan CloudBridge AI'" },
            { name: 'qrTitleZh', length: '140', default: "'发现更多实用 AI 服务'" },
            { name: 'qrTitleEn', length: '140', default: "'Discover practical AI services'" },
            { name: 'qrDescriptionZh', length: '140', default: "'满足多种 AI 使用场景'" },
            {
                name: 'qrDescriptionEn',
                length: '140',
                default: "'Tools for work, creativity, learning and code'",
            },
            { name: 'sceneOneZh', length: '48', default: "'办公提效'" },
            { name: 'sceneOneEn', length: '48', default: "'Work'" },
            { name: 'sceneTwoZh', length: '48', default: "'内容创作'" },
            { name: 'sceneTwoEn', length: '48', default: "'Create'" },
            { name: 'sceneThreeZh', length: '48', default: "'学习辅助'" },
            { name: 'sceneThreeEn', length: '48', default: "'Learn'" },
            { name: 'sceneFourZh', length: '48', default: "'智能编程'" },
            { name: 'sceneFourEn', length: '48', default: "'Code'" },
            { name: 'ctaTextZh', length: '140', default: "'长按识别二维码，立即进入云桥 AI'" },
            { name: 'ctaTextEn', length: '140', default: "'Press and hold to enter CloudBridge AI'" },
            { name: 'footerTitleZh', length: '160', default: "'让好用的 AI，真正为你所用'" },
            { name: 'footerTitleEn', length: '160', default: "'AI that works for you'" },
            { name: 'footerTextZh', length: '220', default: "'热门 AI 工具与数字服务一站式平台'" },
            {
                name: 'footerTextEn',
                length: '220',
                default: "'One-stop platform for AI tools and digital services'",
            },
        ];
        let table = await queryRunner.getTable('referral_poster_template');
        for (const column of columns) {
            if (table?.findColumnByName(column.name)) continue;
            await queryRunner.addColumn(
                'referral_poster_template',
                new TableColumn({
                    name: column.name,
                    type: 'varchar',
                    length: column.length,
                    isNullable: false,
                    default: column.default,
                }),
            );
            table = await queryRunner.getTable('referral_poster_template');
        }
        // Migrate only the original built-in defaults so existing custom copy is preserved.
        await queryRunner.manager.update(
            'referral_poster_template',
            { titleZh: '好友邀请函' },
            { titleZh: 'AI 工具一站式服务', titleEn: 'One-stop AI service' },
        );
        await queryRunner.manager.update(
            'referral_poster_template',
            { headlineZh: '发现好东西，一起分享' },
            { headlineZh: '热门 AI 工具\n一站轻松获取', headlineEn: 'Popular AI tools\nmade easy' },
        );
        await queryRunner.manager.update(
            'referral_poster_template',
            { siteIntroZh: '' },
            {
                siteIntroZh: 'ChatGPT、Claude、Gemini、Codex 等\n热门 AI 服务，一个网站轻松了解与选择',
                siteIntroEn:
                    'ChatGPT, Claude, Gemini, Codex and more\nExplore practical AI services in one place',
            },
        );
        await queryRunner.manager.update(
            'referral_poster_template',
            { foregroundColor: '#FFFFFF', accentColor: '#FF4D4F' },
            { foregroundColor: '#0E2A63', accentColor: '#1269E8', overlayOpacity: 0 },
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasTable('referral_poster_template'))) return;
        const columns = [
            'featureOneTitleZh',
            'featureOneTitleEn',
            'featureOneTextZh',
            'featureOneTextEn',
            'featureTwoTitleZh',
            'featureTwoTitleEn',
            'featureTwoTextZh',
            'featureTwoTextEn',
            'featureThreeTitleZh',
            'featureThreeTitleEn',
            'featureThreeTextZh',
            'featureThreeTextEn',
            'qrEyebrowZh',
            'qrEyebrowEn',
            'qrTitleZh',
            'qrTitleEn',
            'qrDescriptionZh',
            'qrDescriptionEn',
            'sceneOneZh',
            'sceneOneEn',
            'sceneTwoZh',
            'sceneTwoEn',
            'sceneThreeZh',
            'sceneThreeEn',
            'sceneFourZh',
            'sceneFourEn',
            'ctaTextZh',
            'ctaTextEn',
            'footerTitleZh',
            'footerTitleEn',
            'footerTextZh',
            'footerTextEn',
        ];
        for (const name of columns) {
            const table = await queryRunner.getTable('referral_poster_template');
            if (table?.findColumnByName(name)) await queryRunner.dropColumn('referral_poster_template', name);
        }
    }
}
