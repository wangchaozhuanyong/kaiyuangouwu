// organize-imports-ignore -- This isolated Vite entry needs an explicit React import.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { StorefrontContentBlock, StorefrontContentItem } from '../../src/graphql/storefront.graphql';
import { newContentBlock, newContentItem } from '../../src/pages/Storefront/storefront-content-utils';
import { EditorialHomeClient } from './editorial-home-client';

/** Local synthetic content only: no accounts, API client, merchant assets or business writes. */
function illustration(width: number, height: number, background: string, subject: string): string {
    return `data:image/svg+xml,${encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 1600 900"><rect width="1600" height="900" fill="${background}"/><path d="M0 680H1600V900H0Z" fill="#cabba5"/><rect x="1010" y="80" width="440" height="540" rx="14" fill="#e8eee4"/><path d="M1230 80V620M1010 350H1450" stroke="#75816b" stroke-width="14"/><rect x="380" y="470" width="690" height="260" rx="42" fill="${subject}"/><rect x="440" y="430" width="270" height="180" rx="28" fill="#e9d6b9"/><rect x="750" y="430" width="260" height="180" rx="28" fill="#cdb89a"/><path d="M420 730V790M1030 730V790" stroke="#534c44" stroke-width="28"/><ellipse cx="1220" cy="780" rx="170" ry="38" fill="#aa947b"/><path d="M1130 760V840M1310 760V840" stroke="#534c44" stroke-width="20"/></svg>`,
    )}`;
}

const heroImage = illustration(1600, 660, '#8b8984', '#776b59');
const roomImages = [
    illustration(1600, 900, '#aaa68e', '#8d7355'),
    illustration(1600, 900, '#bac1ae', '#a78565'),
    illustration(1600, 900, '#b2a99d', '#847261'),
];
const productImages = [
    illustration(1000, 1000, '#ddd8c8', '#927b5f'),
    illustration(1000, 1000, '#dbc8b6', '#a66c47'),
    illustration(1000, 1000, '#cfcbc2', '#776b61'),
    illustration(1000, 1000, '#ddd3c5', '#857e5b'),
];

function floor(type: StorefrontContentBlock['type'], position: number, code: string): StorefrontContentBlock {
    return {
        ...newContentBlock(type, position, '本地布局合成示例'),
        id: `layout-repair-${code}`,
        code: `layout-repair-${code}`,
        enabled: true,
        createdAt: '2026-10-11T00:00:00Z',
        updatedAt: '2026-10-11T00:00:00Z',
    };
}

function item(
    position: number,
    zh: [string, string],
    en: [string, string],
    imageUrl: string,
    targetType: StorefrontContentItem['targetType'],
): StorefrontContentItem {
    return {
        ...newContentItem(position),
        id: `layout-repair-${targetType.toLowerCase()}-${position}`,
        imageUrl,
        targetType,
        targetValue: targetType === 'PRODUCT' ? `fixture-product-${position}` : `/category?room=${position}`,
        translations: [
            { languageCode: 'zh_Hans', label: zh[0], description: zh[1] },
            { languageCode: 'en', label: en[0], description: en[1] },
        ],
    };
}

function layoutBlocks(longCards: boolean): StorefrontContentBlock[] {
    const hero = floor('HERO', 0, 'hero');
    hero.imageUrl = heroImage;
    hero.imageAsset = {
        id: 'layout-repair-hero-art',
        name: '本地合成空间图',
        mimeType: 'image/svg+xml',
        source: heroImage,
        preview: heroImage,
        width: 1600,
        height: 660,
    };
    hero.targetType = 'PAGE';
    hero.targetValue = '/category';
    hero.settings = {
        heroArtworkLayout: 'overlay',
        mobileHeroTranslations: [
            {
                languageCode: 'zh_Hans',
                title: '选对家具，住得更舒服',
                subtitle: '本地布局示例 · HOME & LIVING',
                body: '按空间挑选家具，了解尺寸、材质与配送安排。',
                ctaLabel: '浏览家具系列',
            },
            {
                languageCode: 'en',
                title: 'Find furniture that feels like home',
                subtitle: 'LOCAL FIXTURE · HOME & LIVING',
                body: 'Explore pieces by room, with dimensions, materials and delivery details.',
                ctaLabel: 'Explore furniture',
            },
        ],
    };
    hero.translations = [
        {
            languageCode: 'zh_Hans',
            title: '选对家具，住得更舒服',
            subtitle: '本地布局示例 · HOME & LIVING',
            body: '从客厅到卧室，按空间挑选家具，了解尺寸、材质与配送安排。',
            ctaLabel: '浏览家具系列',
        },
        {
            languageCode: 'en',
            title: 'Find furniture that feels like home',
            subtitle: 'LOCAL FIXTURE · HOME & LIVING',
            body: 'From the living room to the bedroom, explore pieces by space, with dimensions, materials and delivery details.',
            ctaLabel: 'Explore furniture',
        },
    ];

    const shortcuts = floor('QUICK_LINKS', 1, 'shortcuts');
    shortcuts.items = [
        ['卧室', 'Bedroom'],
        ['餐厅', 'Dining room'],
        ['客厅', 'Living room'],
        ['书房', 'Study'],
        ['客服咨询', 'Get assistance'],
    ].map(([zh, en], position) =>
        item(position, [zh, ''], [en, ''], roomImages[position % roomImages.length], 'PAGE'),
    );

    const rooms = floor('CUSTOM', 2, 'rooms');
    rooms.settings = { displayMode: 'scrollingAds', scrollIntervalSeconds: 30 };
    rooms.translations = [
        {
            languageCode: 'zh_Hans',
            title: '按空间逛',
            subtitle: '客厅、餐厅与卧室的舒适灵感',
            body: '',
            ctaLabel: '',
        },
        {
            languageCode: 'en',
            title: 'Shop by room',
            subtitle: 'Comfortable ideas for the living room, dining room and bedroom',
            body: '',
            ctaLabel: '',
        },
    ];
    rooms.items = [
        item(
            0,
            ['客厅', '从沙发、茶几到收纳，找到适合日常相聚的家具。'],
            ['Living room', 'Find sofas, coffee tables and storage for everyday moments together.'],
            roomImages[0],
            'PAGE',
        ),
        item(
            1,
            ['餐厅', '餐桌椅与餐边家具，为家人的相聚留出舒适空间。'],
            ['Dining room', 'Make room for comfortable meals with dining sets and sideboards.'],
            roomImages[1],
            'PAGE',
        ),
        item(
            2,
            ['卧室', '从床具到卧室收纳，按空间和需求慢慢挑选。'],
            ['Bedroom', 'Explore beds and bedroom storage that suit your space and needs.'],
            roomImages[2],
            'PAGE',
        ),
    ];

    const products = floor('CUSTOM', 3, 'products');
    products.settings = { displayMode: 'scrollingAds', scrollIntervalSeconds: 30 };
    products.translations = [
        {
            languageCode: 'zh_Hans',
            title: '新品与预购灵感',
            subtitle: '看看近期上新的家具；预购款式可联系客服确认规格。',
            body: '',
            ctaLabel: '',
        },
        {
            languageCode: 'en',
            title: 'New arrivals and preorder ideas',
            subtitle:
                'Explore recent furniture arrivals; contact support to confirm preorder specifications.',
            body: '',
            ctaLabel: '',
        },
    ];
    products.items = [
        item(
            0,
            ['新品｜A015 实木书桌', '120 厘米实木书桌，为学习与居家办公留出舒适空间。'],
            [
                'New｜A015 solid wood desk',
                'A 120 cm solid wood desk for a comfortable home working or study space.',
            ],
            productImages[0],
            'PRODUCT',
        ),
        item(
            1,
            ['新品｜8120 三客厅沙发', '为客厅增添舒适座位，查看款式、尺寸与商品详情。'],
            [
                'New｜8120 living room sofa',
                'Add comfortable seating to your living room. Explore styles, sizes and details.',
            ],
            productImages[1],
            'PRODUCT',
        ),
        item(
            2,
            ['预购｜云朵悬浮床', 'MC-5011 款式展示。规格与价格请联系客服询价，暂不支持直接下单。'],
            [
                'Preorder｜Cloud floating bed',
                'MC-5011 style preview. Contact support for specifications and pricing. Direct checkout is unavailable.',
            ],
            productImages[2],
            'PRODUCT',
        ),
        item(
            3,
            ['预购｜大黑牛齐边床', '8021 款式展示。请联系客服确认规格、报价与交期，暂不支持直接下单。'],
            [
                'Preorder｜8021 flush-edge bed',
                '8021 style preview. Contact support to confirm specifications, pricing and delivery time. Direct checkout is unavailable.',
            ],
            productImages[3],
            'PRODUCT',
        ),
    ];

    if (longCards) {
        for (const block of [rooms, products]) {
            block.items = block.items.map(entry => ({
                ...entry,
                translations: entry.translations.map(translation => ({
                    ...translation,
                    label: `${translation.label} ${translation.languageCode === 'en' ? 'with complete editable specifications' : '与完整可编辑规格说明'}`,
                    description: `${translation.description} ${
                        translation.languageCode === 'en'
                            ? 'This is longer local fixture copy to verify that all details remain readable without clipping or overlap. Confirm dimensions and delivery arrangements before ordering.'
                            : '本地长文案用于检查完整信息自然换行，不裁切、不重叠。请在选购前确认实际尺寸、适用空间与配送安排。'
                    }`,
                })),
            }));
        }
    }
    return [hero, shortcuts, rooms, products];
}

function LayoutRepairFixture() {
    const [longCards, setLongCards] = useState(new URLSearchParams(location.search).has('longCards'));
    return (
        <React.Fragment>
            <label
                className="type-body"
                style={{ display: 'block', padding: 12, background: 'var(--surface)', color: 'var(--text)' }}
            >
                卡片文案{' '}
                <select
                    aria-label="卡片验收文案"
                    value={longCards ? 'long' : 'saved'}
                    onChange={event => setLongCards(event.target.value === 'long')}
                >
                    <option value="saved">后台长度示例</option>
                    <option value="long">长文案压力示例</option>
                </select>
            </label>
            <EditorialHomeClient
                blocks={layoutBlocks(longCards)}
                layoutReview
                configuredBlockTypes={['HERO', 'QUICK_LINKS', 'CUSTOM']}
            />
        </React.Fragment>
    );
}

createRoot(document.getElementById('root')!).render(<LayoutRepairFixture />);
