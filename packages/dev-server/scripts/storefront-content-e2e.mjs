import assert from 'node:assert/strict';

const apiOrigin = process.env.VENDURE_API_ORIGIN;
const username = process.env.SUPERADMIN_USERNAME;
const password = process.env.SUPERADMIN_PASSWORD;

if (!apiOrigin || !username || !password) {
    throw new Error('VENDURE_API_ORIGIN, SUPERADMIN_USERNAME and SUPERADMIN_PASSWORD are required');
}

async function graphql(path, query, variables, headers = {}) {
    const response = await fetch(`${apiOrigin}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ query, variables }),
    });
    const body = await response.json();
    if (!response.ok || body.errors?.length || !body.data) {
        throw new Error(body.errors?.map(error => error.message).join('; ') || `HTTP ${response.status}`);
    }
    return { data: body.data, response };
}

const loginMutation = `
    mutation Login($username: String!, $password: String!) {
        login(username: $username, password: $password, rememberMe: false) {
            ... on CurrentUser { id }
            ... on ErrorResult { errorCode message }
        }
    }
`;

const createMutation = `
    mutation CreateContent($input: CreateStorefrontContentBlockInput!) {
        createStorefrontContentBlock(input: $input) {
            id code enabled title
            items { id enabled label }
            translations { languageCode title }
        }
    }
`;

const updateMutation = `
    mutation UpdateContent($input: UpdateStorefrontContentBlockInput!) {
        updateStorefrontContentBlock(input: $input) { id enabled }
    }
`;

const deleteMutation = `
    mutation DeleteContent($id: ID!) {
        deleteStorefrontContentBlock(id: $id) { result message }
    }
`;

const adminByIdQuery = `
    query AdminContent($id: ID!) {
        storefrontContentBlock(id: $id) { id code }
    }
`;

const adminListQuery = `
    query AdminContentList {
        storefrontContentBlocks { id code }
    }
`;

const shopQuery = `
    query PublishedContent {
        storefrontContent {
            id code enabled title subtitle body ctaLabel
            items { id enabled label description }
        }
    }
`;

const createdIds = [];
const createdCodes = [];
let authToken = '';

function adminHeaders(channelToken) {
    return {
        authorization: `Bearer ${authToken}`,
        'vendure-token': channelToken,
        'language-code': 'zh_Hans',
    };
}

function shopHeaders(channelToken, languageCode) {
    return { 'vendure-token': channelToken, 'accept-language': languageCode };
}

async function createBlock(input) {
    createdCodes.push(input.code);
    const { data } = await graphql('/admin-api', createMutation, { input }, adminHeaders('cn-mainland'));
    createdIds.push(data.createStorefrontContentBlock.id);
    return data.createStorefrontContentBlock;
}

async function published(channelToken, languageCode) {
    const { data } = await graphql(
        `/shop-api?languageCode=${encodeURIComponent(languageCode)}`,
        shopQuery,
        undefined,
        shopHeaders(channelToken, languageCode),
    );
    return data.storefrontContent;
}

try {
    const login = await graphql(
        '/admin-api',
        loginMutation,
        { username, password },
        { 'vendure-token': 'cn-mainland' },
    );
    assert.equal(login.data.login.errorCode, undefined, login.data.login.message);
    authToken = login.response.headers.get('vendure-auth-token') ?? '';
    assert.ok(authToken, 'Admin login did not return a bearer token');

    const stale = await graphql('/admin-api', adminListQuery, undefined, adminHeaders('cn-mainland'));
    for (const block of stale.data.storefrontContentBlocks) {
        if (block.code.startsWith('e2e-visible-') || block.code.startsWith('e2e-future-')) {
            await graphql('/admin-api', deleteMutation, { id: block.id }, adminHeaders('cn-mainland'));
        }
    }

    const runId = Date.now();
    const visibleCode = `e2e-visible-${runId}`;
    const futureCode = `e2e-future-${runId}`;
    const visible = await createBlock({
        code: visibleCode,
        type: 'HERO',
        enabled: true,
        position: 9000,
        targetType: 'URL',
        targetValue: '#/category',
        translations: [
            {
                languageCode: 'zh_Hans',
                title: '端到端中文标题',
                subtitle: '中文副标题',
                body: '中文正文',
                ctaLabel: '查看商品',
            },
            {
                languageCode: 'en',
                title: 'End-to-end English title',
                subtitle: 'English subtitle',
                body: 'English body',
                ctaLabel: 'Browse products',
            },
        ],
        items: [
            {
                enabled: true,
                position: 0,
                targetType: 'SEARCH',
                targetValue: 'coffee',
                translations: [
                    { languageCode: 'zh_Hans', label: '咖啡', description: '中文条目' },
                    { languageCode: 'en', label: 'Coffee', description: 'English item' },
                ],
            },
            {
                enabled: false,
                position: 1,
                targetType: 'NONE',
                translations: [
                    { languageCode: 'zh_Hans', label: '隐藏条目', description: '' },
                    { languageCode: 'en', label: 'Hidden item', description: '' },
                ],
            },
        ],
    });
    assert.equal(visible.translations.length, 2);

    await createBlock({
        code: futureCode,
        type: 'NOTICE',
        enabled: true,
        position: 9001,
        startsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        targetType: 'NONE',
        translations: [
            { languageCode: 'zh_Hans', title: '未来内容', subtitle: '', body: '', ctaLabel: '' },
            { languageCode: 'en', title: 'Future content', subtitle: '', body: '', ctaLabel: '' },
        ],
    });

    const chinese = await published('cn-mainland', 'zh_Hans');
    const chineseVisible = chinese.find(block => block.code === visibleCode);
    assert.equal(chineseVisible?.title, '端到端中文标题');
    assert.deepEqual(
        chineseVisible?.items.map(item => item.label),
        ['咖啡'],
    );
    assert.equal(
        chinese.some(block => block.code === futureCode),
        false,
    );

    const english = await published('cn-mainland', 'en');
    const englishVisible = english.find(block => block.code === visibleCode);
    assert.equal(englishVisible?.title, 'End-to-end English title');
    assert.deepEqual(
        englishVisible?.items.map(item => item.label),
        ['Coffee'],
    );

    const malaysia = await published('my-malaysia', 'en');
    assert.equal(
        malaysia.some(block => block.code === visibleCode || block.code === futureCode),
        false,
    );

    const crossChannel = await graphql(
        '/admin-api',
        adminByIdQuery,
        { id: visible.id },
        adminHeaders('my-malaysia'),
    );
    assert.equal(crossChannel.data.storefrontContentBlock, null);

    await graphql(
        '/admin-api',
        updateMutation,
        { input: { id: visible.id, enabled: false } },
        adminHeaders('cn-mainland'),
    );
    const disabled = await published('cn-mainland', 'zh_Hans');
    assert.equal(
        disabled.some(block => block.code === visibleCode),
        false,
    );

    console.log(
        JSON.stringify({
            ok: true,
            checks: [
                'admin-create-and-update',
                'zh-en-translation',
                'disabled-item-filter',
                'future-schedule-filter',
                'shop-channel-isolation',
                'admin-channel-isolation',
            ],
        }),
    );
} finally {
    let cleanupIds = [...createdIds];
    if (authToken && createdCodes.length) {
        try {
            const remaining = await graphql(
                '/admin-api',
                adminListQuery,
                undefined,
                adminHeaders('cn-mainland'),
            );
            cleanupIds = [
                ...new Set([
                    ...cleanupIds,
                    ...remaining.data.storefrontContentBlocks
                        .filter(block => createdCodes.includes(block.code))
                        .map(block => block.id),
                ]),
            ];
        } catch (error) {
            console.error('Could not inspect remaining test content:', error);
        }
    }
    for (const id of cleanupIds.reverse()) {
        try {
            await graphql('/admin-api', deleteMutation, { id }, adminHeaders('cn-mainland'));
        } catch (error) {
            console.error(`Could not clean up test content ${id}:`, error);
        }
    }
}
