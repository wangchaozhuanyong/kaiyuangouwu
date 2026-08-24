import { MigrationInterface, QueryRunner } from 'typeorm';

type NamedTranslation = readonly [id: number, name: string];
type ProductTranslation = readonly [id: number, name: string, description: string];

const productTranslations: readonly ProductTranslation[] = [
    [1, '笔记本电脑', '适合日常办公、学习与轻量创作的便携电脑，提供多种屏幕尺寸和内存配置。'],
    [2, '平板电脑', '兼顾移动办公、影音娱乐与触控操作的平板电脑，提供 32 GB 和 128 GB 容量。'],
    [3, '无线光电鼠标', '即插即用的无线光电鼠标，适合日常办公和家用电脑。'],
    [4, '32 英寸显示器', '32 英寸 4K 显示器，适合多窗口办公、影音和高清内容浏览。'],
    [5, '曲面显示器', '曲面屏设计，提供 24 英寸和 27 英寸规格，适合沉浸式影音与日常办公。'],
    [6, '高性能内存', '带散热片的台式机内存，提供 4 GB、8 GB 和 16 GB 容量。'],
    [7, '游戏电脑', '面向游戏和高负载应用的台式电脑，提供不同处理器和 SSD 容量配置。'],
    [8, '台式机硬盘', '适用于台式机和一体机的内置硬盘，提供 1 TB 至 6 TB 多种容量。'],
    [9, '机械键盘', '按键反馈清晰的机械键盘，适合办公输入和游戏使用。'],
    [10, 'Cat 6 网线', '5 米 Cat 6 网线，配备 RJ45 接头，适合家庭和办公网络连接。'],
    [11, 'USB 数据线', '适用于设备连接、充电和数据传输的 USB 线缆。'],
    [12, '拍立得相机', '操作简单的拍立得相机，适合即时成像和日常记录。'],
    [13, '相机镜头', '适用于数码或胶片单反相机的镜头，支持日常摄影使用。'],
    [14, '复古折叠相机摆件', '不能正常拍摄的复古折叠相机，适合作为家居或办公室装饰。'],
    [15, '相机三脚架', '轻量可调节的相机三脚架，便于稳定拍摄并调整取景高度和角度。'],
    [16, '便携胶片相机', '使用 126 胶卷的便携相机，配有内置闪光灯。'],
    [17, '便携数码相机', '支持眼部对焦、目标跟踪、高速连拍和 4K HDR 视频拍摄的便携数码相机。'],
    [18, 'Nikkormat 单反相机', 'Nikkormat FS 单反相机，配备 50 mm f/1.4 Nikkor 镜头和镜头盖。'],
    [19, '便携单反相机', '采用 2400 万像素 APS-C 传感器的便携相机，适合日常摄影和创意拍摄。'],
    [20, '双镜头反光相机', '经典双镜头反光结构相机，取景镜头和成像镜头相互独立。'],
    [21, '公路自行车', '采用碳纤维车架和前叉的公路自行车，兼顾轻量、效率和操控。'],
    [22, '训练跳绳', '不易缠绕的训练跳绳，适合日常有氧和体能训练。'],
    [23, '拳击手套', '贴合手部自然握拳形态，采用双层泡棉缓冲的训练拳击手套。'],
    [24, '四人帐篷', '内部空间最多可容纳 4 人，并提供较充足站立高度的户外帐篷。'],
    [25, '复古巡航滑板', '采用经典造型的 69 cm 巡航滑板，适合初学和日常代步练习。'],
    [26, '足球', '采用高对比度图案和机缝 TPU 外层的训练足球。'],
    [27, '网球', '适合日常练习和休闲使用的耐用网球。'],
    [28, '篮球', '适合新手训练的橡胶篮球，可用于球场练习和日常娱乐。'],
    [29, 'Ultraboost 跑鞋', '轻量缓震跑鞋，提供多个常用鞋码。'],
    [30, 'Freerun 跑鞋', '采用轻量鞋面设计的跑鞋，兼顾包裹和支撑。'],
    [31, '高帮篮球鞋', '采用缓震结构和动态系带设计的高帮篮球鞋。'],
    [32, 'Pureboost 跑鞋', '适合城市路面的跑鞋，提供稳定落地区域和弹性针织鞋面。'],
    [33, 'RunX 跑鞋', '采用透气网布鞋面、缓震中底和耐磨橡胶外底的跑鞋。'],
    [34, 'Allstar 帆布鞋', '经典高帮轮廓和星形踝标设计的休闲帆布鞋。'],
    [35, '仙人掌盆栽', '造型利落的室内仙人掌，适合家居或办公室摆放。'],
    [36, '郁金香盆栽', '红色花朵配深色花心的郁金香，适合盆栽、岩石花园和花境。'],
    [37, '垂吊绿植', '适合明亮环境摆放的垂吊绿植，可用于室内空间装饰。'],
    [38, '芦荟盆栽', '易于日常养护的室内芦荟盆栽，适合作为观叶植物摆放。'],
    [39, '迷你树蕨', '叶片茂密的绿色树蕨，可为室内空间增加热带植物氛围。'],
    [40, '室内多肉组合', '包含不同形态和颜色的多肉植物组合，适合光照充足的窗边养护。'],
    [41, '蝴蝶兰盆栽', '白色花朵的蝴蝶兰盆栽，适合多种室内装饰风格。'],
    [42, '盆景树', '适合室内或户外养护的半常绿盆景，冬季需要适当防护。'],
    [43, '石狮摆件', '适合摆放在家中或办公室的传统石狮造型装饰摆件。'],
    [44, '园艺手铲', '采用环氧涂层铲头的园艺手铲，适合松土、移栽和日常种植。'],
    [45, '气球椅', '白色木椅搭配可拆卸粉色气球的装饰座椅。'],
    [46, '灰色布艺沙发', '采用高回弹泡棉坐垫和可拆洗外套的灰色布艺沙发。'],
    [47, '皮质沙发', '带手动躺靠调节结构和厚实扶手的棕色皮质沙发。'],
    [48, '白色灯罩', '锥形白色布艺灯罩，内侧采用银色反光表面，可用于吊灯或台灯。'],
    [49, '木质边桌', '带抽屉限位和线缆收纳结构的木质边桌。'],
    [50, '软垫餐椅', '采用实木椅架和贴合背部造型的软垫餐椅。'],
    [51, '黑色弧背椅', '采用弧形靠背和碗形座面的黑色座椅，可通过座下结构快速组装。'],
    [52, '实木凳', '采用耐用实木制作，可按需要进行打磨和表面处理。'],
    [53, '木质床头柜', '保留天然木纹和色差的木质床头柜，每件纹理略有不同。'],
    [54, '现代咖啡椅', '轻便稳定的现代座椅，座面具有适度弹性，提供多种颜色。'],
] as const;

const variantTranslations: readonly NamedTranslation[] = [
    [1, '13 英寸 8 GB 笔记本电脑'],
    [2, '15 英寸 8 GB 笔记本电脑'],
    [3, '13 英寸 16 GB 笔记本电脑'],
    [4, '15 英寸 16 GB 笔记本电脑'],
    [5, '32 GB 平板电脑'],
    [6, '128 GB 平板电脑'],
    [7, '无线光电鼠标'],
    [8, '32 英寸显示器'],
    [9, '24 英寸曲面显示器'],
    [10, '27 英寸曲面显示器'],
    [11, '4 GB 高性能内存'],
    [12, '8 GB 高性能内存'],
    [13, '16 GB 高性能内存'],
    [14, 'i7-8700 / 240 GB SSD 游戏电脑'],
    [15, 'R7-2700 / 240 GB SSD 游戏电脑'],
    [16, 'i7-8700 / 120 GB SSD 游戏电脑'],
    [17, 'R7-2700 / 120 GB SSD 游戏电脑'],
    [18, '1 TB 台式机硬盘'],
    [19, '2 TB 台式机硬盘'],
    [20, '3 TB 台式机硬盘'],
    [21, '4 TB 台式机硬盘'],
    [22, '6 TB 台式机硬盘'],
    [23, '机械键盘'],
    [24, '5 米 Cat 6 网线'],
    [25, 'USB 数据线'],
    [26, '拍立得相机'],
    [27, '相机镜头'],
    [28, '复古折叠相机摆件'],
    [29, '相机三脚架'],
    [30, '便携胶片相机'],
    [31, '便携数码相机'],
    [32, 'Nikkormat 单反相机'],
    [33, '便携单反相机'],
    [34, '双镜头反光相机'],
    [35, '公路自行车'],
    [36, '训练跳绳'],
    [37, '拳击手套'],
    [38, '四人帐篷'],
    [39, '复古巡航滑板'],
    [40, '足球'],
    [41, '网球'],
    [42, '篮球'],
    [43, 'Ultraboost 跑鞋 40 码'],
    [44, 'Ultraboost 跑鞋 42 码'],
    [45, 'Ultraboost 跑鞋 44 码'],
    [46, 'Ultraboost 跑鞋 46 码'],
    [47, 'Freerun 跑鞋 40 码'],
    [48, 'Freerun 跑鞋 42 码'],
    [49, 'Freerun 跑鞋 44 码'],
    [50, 'Freerun 跑鞋 46 码'],
    [51, '高帮篮球鞋 40 码'],
    [52, '高帮篮球鞋 42 码'],
    [53, '高帮篮球鞋 44 码'],
    [54, '高帮篮球鞋 46 码'],
    [55, 'Pureboost 跑鞋 40 码'],
    [56, 'Pureboost 跑鞋 42 码'],
    [57, 'Pureboost 跑鞋 44 码'],
    [58, 'Pureboost 跑鞋 46 码'],
    [59, 'RunX 跑鞋 40 码'],
    [60, 'RunX 跑鞋 42 码'],
    [61, 'RunX 跑鞋 44 码'],
    [62, 'RunX 跑鞋 46 码'],
    [63, 'Allstar 帆布鞋 40 码'],
    [64, 'Allstar 帆布鞋 42 码'],
    [65, 'Allstar 帆布鞋 44 码'],
    [66, 'Allstar 帆布鞋 46 码'],
    [67, '仙人掌盆栽'],
    [68, '郁金香盆栽'],
    [69, '垂吊绿植'],
    [70, '芦荟盆栽'],
    [71, '迷你树蕨'],
    [72, '室内多肉组合'],
    [73, '蝴蝶兰盆栽'],
    [74, '盆景树'],
    [75, '石狮摆件'],
    [76, '园艺手铲'],
    [77, '气球椅'],
    [78, '灰色布艺沙发'],
    [79, '皮质沙发'],
    [80, '白色灯罩'],
    [81, '木质边桌'],
    [82, '软垫餐椅'],
    [83, '黑色弧背椅'],
    [84, '实木凳'],
    [85, '木质床头柜'],
    [86, '现代咖啡椅（芥末黄）'],
    [87, '现代咖啡椅（薄荷绿）'],
    [88, '现代咖啡椅（珍珠白）'],
] as const;

const collectionTranslations: readonly ProductTranslation[] = [
    [1, '全部商品', '系统商品分类的根节点。'],
    [2, '电子产品', '电脑、配件和消费电子产品。'],
    [3, '电脑及配件', '电脑、显示器、存储和输入设备。'],
    [4, '相机与摄影', '相机、镜头和摄影配件。'],
    [5, '家居园艺', '适用于家居空间和园艺养护的商品。'],
    [6, '家具', '沙发、桌椅和家居家具。'],
    [7, '绿植盆栽', '适合室内外养护和装饰的植物。'],
    [8, '运动户外', '运动训练和户外活动用品。'],
    [9, '运动装备', '球类、训练和户外装备。'],
    [10, '鞋类', '跑鞋、篮球鞋和休闲鞋。'],
] as const;

const facetTranslations: readonly NamedTranslation[] = [
    [1, '分类'],
    [2, '品牌'],
    [3, '颜色'],
    [4, '植物类型'],
] as const;

const facetValueTranslations: readonly NamedTranslation[] = [
    [1, '电子产品'],
    [2, '电脑及配件'],
    [3, 'Apple'],
    [4, 'Logitech'],
    [5, 'Samsung'],
    [6, 'Corsair'],
    [7, 'ADMI'],
    [8, 'Seagate'],
    [9, '相机与摄影'],
    [10, 'Polaroid'],
    [11, 'Nikon'],
    [12, 'Agfa'],
    [13, 'Manfrotto'],
    [14, 'Kodak'],
    [15, 'Sony'],
    [16, 'Rolleiflex'],
    [17, '运动户外'],
    [18, '运动装备'],
    [19, 'Pinarello'],
    [20, 'Everlast'],
    [21, 'Nike'],
    [22, 'Wilson'],
    [23, '鞋类'],
    [24, 'Adidas'],
    [25, '蓝色'],
    [26, '粉色'],
    [27, '黑色'],
    [28, '白色'],
    [29, 'Converse'],
    [30, '家居园艺'],
    [31, '绿植盆栽'],
    [32, '室内'],
    [33, '户外'],
    [34, '家具'],
    [35, '灰色'],
    [36, '棕色'],
    [37, '木色'],
    [38, '黄色'],
    [39, '绿色'],
] as const;

const optionGroupTranslations: readonly NamedTranslation[] = [
    [1, '鞋码'],
    [2, '屏幕尺寸'],
    [3, '内存容量'],
    [4, '存储容量'],
    [5, '显示器尺寸'],
    [6, '鞋码'],
    [7, '处理器'],
    [8, '硬盘容量'],
    [9, '硬盘容量'],
    [10, '颜色'],
] as const;

const optionTranslations: readonly NamedTranslation[] = [
    [1, '40 码'],
    [2, '42 码'],
    [3, '44 码'],
    [4, '46 码'],
    [5, '13 英寸'],
    [6, '15 英寸'],
    [7, '8 GB'],
    [8, '16 GB'],
    [9, '32 GB'],
    [10, '128 GB'],
    [11, '24 英寸'],
    [12, '27 英寸'],
    [13, '4 GB'],
    [14, '8 GB'],
    [15, '16 GB'],
    [16, 'i7-8700'],
    [17, 'R7-2700'],
    [18, '240 GB SSD'],
    [19, '120 GB SSD'],
    [20, '1 TB'],
    [21, '2 TB'],
    [22, '3 TB'],
    [23, '4 TB'],
    [24, '6 TB'],
    [25, '芥末黄'],
    [26, '薄荷绿'],
    [27, '珍珠白'],
] as const;

export class AddMainlandChineseCatalogContent1786515300000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await this.enableAnsiIdentifierQuotes(queryRunner);
        for (const [id, name, description] of productTranslations) {
            await this.insertProductLikeTranslation(
                queryRunner,
                'product_translation',
                id,
                name,
                description,
            );
        }
        for (const [id, name] of variantTranslations) {
            await this.insertNamedTranslation(queryRunner, 'product_variant_translation', id, name);
        }
        for (const [id, name, description] of collectionTranslations) {
            await this.insertProductLikeTranslation(
                queryRunner,
                'collection_translation',
                id,
                name,
                description,
            );
        }
        await this.insertNamedTranslations(queryRunner, 'facet_translation', facetTranslations);
        await this.insertNamedTranslations(queryRunner, 'facet_value_translation', facetValueTranslations);
        await this.insertNamedTranslations(
            queryRunner,
            'product_option_group_translation',
            optionGroupTranslations,
        );
        await this.insertNamedTranslations(queryRunner, 'product_option_translation', optionTranslations);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await this.enableAnsiIdentifierQuotes(queryRunner);
        for (const table of [
            'product_translation',
            'product_variant_translation',
            'collection_translation',
            'facet_translation',
            'facet_value_translation',
            'product_option_group_translation',
            'product_option_translation',
        ]) {
            await queryRunner.query(`DELETE FROM "${table}" WHERE "languageCode" = 'zh_Hans'`);
        }
    }

    private async insertProductLikeTranslation(
        queryRunner: QueryRunner,
        table: 'product_translation' | 'collection_translation',
        baseId: number,
        name: string,
        description: string,
    ): Promise<void> {
        await queryRunner.query(
            `
                INSERT INTO "${table}" ("languageCode", "name", "slug", "description", "baseId")
                SELECT 'zh_Hans', ?, source.slug, ?, source.baseId
                FROM "${table}" source
                WHERE source.baseId = ? AND source.languageCode = 'en'
                  AND NOT EXISTS (
                      SELECT 1 FROM "${table}" existing
                      WHERE existing.baseId = source.baseId AND existing.languageCode = 'zh_Hans'
                  )
            `,
            [name, description, baseId],
        );
    }

    private async insertNamedTranslations(
        queryRunner: QueryRunner,
        table: string,
        translations: readonly NamedTranslation[],
    ): Promise<void> {
        for (const [id, name] of translations) {
            await this.insertNamedTranslation(queryRunner, table, id, name);
        }
    }

    private async insertNamedTranslation(
        queryRunner: QueryRunner,
        table: string,
        baseId: number,
        name: string,
    ): Promise<void> {
        await queryRunner.query(
            `
                INSERT INTO "${table}" ("languageCode", "name", "baseId")
                SELECT 'zh_Hans', ?, source.baseId
                FROM "${table}" source
                WHERE source.baseId = ? AND source.languageCode = 'en'
                  AND NOT EXISTS (
                    SELECT 1 FROM "${table}"
                    WHERE baseId = source.baseId AND languageCode = 'zh_Hans'
                  )
            `,
            [name, baseId, baseId],
        );
    }

    private async enableAnsiIdentifierQuotes(queryRunner: QueryRunner): Promise<void> {
        if (['mysql', 'mariadb'].includes(queryRunner.connection.options.type)) {
            await queryRunner.query(
                `SET SESSION sql_mode = CONCAT_WS(',', @@SESSION.sql_mode, 'ANSI_QUOTES')`,
            );
        }
    }
}
