import 'dotenv/config';

import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const LOGIN = `
mutation Login($username: String!, $password: String!) {
  login(username: $username, password: $password, rememberMe: false) {
    ... on CurrentUser { id channels { id code token } }
    ... on ErrorResult { errorCode message }
  }
}
`;
const SNAPSHOT = `
query CommerceMigrationSnapshot($skip: Int!) {
  products(options: { take: 100, skip: $skip }) {
    totalItems
    items {
      id
      name
      customFields { fulfillmentType refundPolicy manualDeliverySlaMinutes }
      variants {
        id
        sku
        trackInventory
        customFields { fulfillmentType digitalDeliveryMode digitalStockPolicy }
      }
      packaging {
        id
        enabled
        autoUnpack
        unitLabel
        packageLabel
        unitsPerPackage
        unitVariant { id }
        packageVariant { id }
      }
    }
  }
  orders(options: { take: 100, skip: $skip, sort: { createdAt: DESC } }) {
    totalItems
    items {
      id
      code
      state
      payments { state }
      lines { id customFields { fulfillmentTypeSnapshot digitalDeliveryModeSnapshot } }
    }
  }
}
`;
const UPDATE_PRODUCT = `mutation UpdateProduct($input:UpdateProductInput!){updateProduct(input:$input){id}}`;
const UPDATE_VARIANTS = `mutation UpdateVariants($input:[UpdateProductVariantInput!]!){updateProductVariants(input:$input){id}}`;
const UPDATE_PACKAGING = `mutation UpdatePackaging($input:UpdateProductPackagingInput!){updateProductPackaging(input:$input){id enabled}}`;
const UPDATE_MODE = `mutation UpdateMode($mode:StoreCommerceMode!){updateMyStoreCommerceMode(mode:$mode){mode}}`;
const TERMINAL_STATES = new Set(['Cancelled', 'Delivered']);
const PAID_PAYMENT_STATES = new Set(['Authorized', 'Settled']);

export function orderNeedsPaidMigrationReview(order) {
    return (
        !TERMINAL_STATES.has(order.state) &&
        order.payments?.some(payment => PAID_PAYMENT_STATES.has(payment.state)) === true
    );
}

export function digitalVariantMigrationInput(variant) {
    const mode = ['auto_card', 'file_download'].includes(variant.customFields.digitalDeliveryMode)
        ? variant.customFields.digitalDeliveryMode
        : 'manual_service';
    return {
        id: variant.id,
        trackInventory: mode === 'manual_service' ? 'TRUE' : 'FALSE',
        customFields: {
            // fulfillmentType is a read-only compatibility mirror. The ProductEvent/ProductVariantEvent
            // policy synchronizer derives it from Product.fulfillmentType, so Admin GraphQL must not write it.
            digitalDeliveryMode: mode,
            digitalStockPolicy:
                mode === 'auto_card' ? 'pool_derived' : mode === 'file_download' ? 'unlimited' : 'limited',
        },
    };
}

function parseArguments(argv) {
    return {
        apply: argv.includes('--apply'),
        allowRemote: argv.includes('--allow-remote'),
        channelCodes:
            valueAfter(argv, '--channels')
                ?.split(',')
                .map(value => value.trim())
                .filter(Boolean) ?? [],
    };
}

function valueAfter(argv, name) {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
}

function isLocal(value) {
    const host = new URL(value).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost');
}

async function graphql(origin, query, variables, headers = {}) {
    const response = await fetch(`${origin}/admin-api`, {
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

async function main() {
    const options = parseArguments(process.argv.slice(2));
    const origin = String(process.env.VENDURE_API_ORIGIN ?? 'http://127.0.0.1:3000').replace(/\/$/u, '');
    const username = process.env.SUPERADMIN_USERNAME;
    const password = process.env.SUPERADMIN_PASSWORD;
    assert.ok(username && password, 'SUPERADMIN_USERNAME and SUPERADMIN_PASSWORD are required');
    if (options.apply && (!isLocal(origin) || process.env.NODE_ENV === 'production')) {
        assert.ok(options.allowRemote, 'Remote or production writes require both --apply and --allow-remote');
    }
    const login = await graphql(origin, LOGIN, { username, password });
    assert.equal(login.data.login.errorCode, undefined, login.data.login.message);
    const authToken = login.response.headers.get('vendure-auth-token');
    assert.ok(authToken, 'Admin login did not return vendure-auth-token');
    const accessible = login.data.login.channels;
    const channels = options.channelCodes.length
        ? options.channelCodes.map(code => {
              const channel = accessible.find(item => item.code === code);
              assert.ok(channel, `Admin cannot access Channel ${code}`);
              return channel;
          })
        : accessible;
    const report = [];
    for (const channel of channels) {
        const headers = { authorization: `Bearer ${authToken}`, 'vendure-token': channel.token };
        const products = [];
        const orders = [];
        for (let skip = 0; ; skip += 100) {
            const snapshot = await graphql(origin, SNAPSHOT, { skip }, headers);
            products.push(...snapshot.data.products.items);
            orders.push(...snapshot.data.orders.items);
            if (
                products.length >= snapshot.data.products.totalItems &&
                orders.length >= snapshot.data.orders.totalItems
            ) {
                break;
            }
        }
        const paidReviewOrders = orders.filter(orderNeedsPaidMigrationReview);
        const plan = {
            channelCode: channel.code,
            products: products.length,
            productsToDigital: products.filter(product => product.customFields.fulfillmentType !== 'digital')
                .length,
            autoCardVariants: products
                .flatMap(product => product.variants)
                .filter(variant => variant.customFields.digitalDeliveryMode === 'auto_card').length,
            fileDownloadVariants: products
                .flatMap(product => product.variants)
                .filter(variant => variant.customFields.digitalDeliveryMode === 'file_download').length,
            manualVariants: products
                .flatMap(product => product.variants)
                .filter(
                    variant =>
                        !['auto_card', 'file_download'].includes(variant.customFields.digitalDeliveryMode),
                ).length,
            packagingRulesToDisable: products.filter(product => product.packaging?.enabled).length,
            paidOrdersNeedingReview: paidReviewOrders.map(order => ({
                id: order.id,
                code: order.code,
                state: order.state,
            })),
        };
        report.push(plan);
        if (!options.apply) continue;
        assert.equal(
            paidReviewOrders.length,
            0,
            `Channel ${channel.code} has paid unfinished orders; apply aborted`,
        );
        for (const product of products) {
            await graphql(
                origin,
                UPDATE_PRODUCT,
                {
                    input: {
                        id: product.id,
                        customFields: {
                            ...product.customFields,
                            fulfillmentType: 'digital',
                            refundPolicy: product.customFields.refundPolicy || 'MERCHANT_REVIEW',
                            manualDeliverySlaMinutes: product.customFields.manualDeliverySlaMinutes || 1440,
                        },
                    },
                },
                headers,
            );
            await graphql(
                origin,
                UPDATE_VARIANTS,
                {
                    input: product.variants.map(digitalVariantMigrationInput),
                },
                headers,
            );
            if (product.packaging?.enabled) {
                await graphql(
                    origin,
                    UPDATE_PACKAGING,
                    {
                        input: {
                            productId: product.id,
                            unitVariantId: product.packaging.unitVariant.id,
                            packageVariantId: product.packaging.packageVariant.id,
                            unitLabel: product.packaging.unitLabel,
                            packageLabel: product.packaging.packageLabel,
                            unitsPerPackage: product.packaging.unitsPerPackage,
                            enabled: false,
                            autoUnpack: product.packaging.autoUnpack,
                        },
                    },
                    headers,
                );
            }
        }
        await graphql(origin, UPDATE_MODE, { mode: 'DIGITAL_ONLY' }, headers);
    }
    process.stdout.write(
        `${JSON.stringify({ mode: options.apply ? 'apply' : 'dry-run', origin, report }, null, 2)}\n`,
    );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main();
}
