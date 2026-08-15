import assert from 'node:assert/strict';

const apiOrigin = process.env.VENDURE_API_ORIGIN;
const channelToken = process.env.VENDURE_CHANNEL_TOKEN ?? 'cn-mainland';
const isolatedChannelToken = process.env.VENDURE_ISOLATED_CHANNEL_TOKEN ?? 'my-malaysia';

if (!apiOrigin) {
    throw new Error('VENDURE_API_ORIGIN is required');
}

async function graphql(query, variables, headers = {}) {
    const response = await fetch(`${apiOrigin}/shop-api?languageCode=zh_Hans`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'vendure-token': channelToken,
            ...headers,
        },
        body: JSON.stringify({ query, variables }),
    });
    const body = await response.json();
    return { body, response };
}

function assertData(result) {
    assert.equal(result.response.ok, true, `HTTP ${result.response.status}`);
    assert.equal(result.body.errors, undefined, result.body.errors?.map(error => error.message).join('; '));
    assert.ok(result.body.data, 'GraphQL response did not contain data');
    return result.body.data;
}

const activeOrderQuery = `
    query ActiveOrderNote {
        activeOrder {
            id
            code
            customFields { customerNote }
        }
    }
`;

const updateNoteMutation = `
    mutation UpdateOrderNote($input: UpdateOrderInput!) {
        setOrderCustomFields(input: $input) {
            __typename
            ... on Order {
                id
                code
                customFields { customerNote }
            }
            ... on ErrorResult { errorCode message }
        }
    }
`;

const products = assertData(
    await graphql(`
        query OrderNoteProduct {
            products(options: { take: 20 }) {
                items {
                    variants {
                        id
                    }
                }
            }
        }
    `),
).products.items;
const variantId = products.flatMap(product => product.variants).find(variant => variant.id)?.id;
assert.ok(variantId, `No product variant is available in ${channelToken}`);

const added = await graphql(
    `
        mutation AddOrderNoteItem($variantId: ID!) {
            addItemToOrder(productVariantId: $variantId, quantity: 1) {
                __typename
                ... on Order {
                    id
                    code
                    customFields {
                        customerNote
                    }
                }
                ... on ErrorResult {
                    errorCode
                    message
                }
            }
        }
    `,
    { variantId },
);
const addedOrder = assertData(added).addItemToOrder;
assert.equal(addedOrder.errorCode, undefined, addedOrder.message);
const shopAuthToken = added.response.headers.get('vendure-auth-token') ?? '';
assert.ok(shopAuthToken, 'Adding an item did not create an authenticated shop session');
const sessionHeaders = { authorization: `Bearer ${shopAuthToken}` };

const note = `e2e-order-note-${Date.now()}`;
const saved = assertData(
    await graphql(updateNoteMutation, { input: { customFields: { customerNote: note } } }, sessionHeaders),
).setOrderCustomFields;
assert.equal(saved.errorCode, undefined, saved.message);
assert.equal(saved.customFields.customerNote, note);

const restored = assertData(await graphql(activeOrderQuery, undefined, sessionHeaders)).activeOrder;
assert.equal(restored.id, saved.id);
assert.equal(restored.customFields.customerNote, note);

const otherSession = assertData(await graphql(activeOrderQuery)).activeOrder;
assert.equal(otherSession, null, 'A different anonymous session could read the active order');

const otherChannel = assertData(
    await graphql(activeOrderQuery, undefined, {
        ...sessionHeaders,
        'vendure-token': isolatedChannelToken,
    }),
).activeOrder;
assert.equal(otherChannel, null, 'The active order leaked into another Channel');

const overlong = await graphql(
    updateNoteMutation,
    { input: { customFields: { customerNote: 'x'.repeat(501) } } },
    sessionHeaders,
);
const validationMessage =
    overlong.body.errors?.map(error => error.message).join('; ') ??
    overlong.body.data?.setOrderCustomFields?.message ??
    '';
assert.match(validationMessage, /500/);

const unchanged = assertData(await graphql(activeOrderQuery, undefined, sessionHeaders)).activeOrder;
assert.equal(unchanged.customFields.customerNote, note);

const cleared = assertData(
    await graphql(updateNoteMutation, { input: { customFields: { customerNote: '' } } }, sessionHeaders),
).setOrderCustomFields;
assert.equal(cleared.errorCode, undefined, cleared.message);
assert.equal(cleared.customFields.customerNote, '');

console.log(
    JSON.stringify({
        ok: true,
        checks: [
            'owner-session-write',
            'same-session-restore',
            'other-session-isolation',
            'channel-isolation',
            'max-length-validation',
            'clear-note',
        ],
    }),
);
