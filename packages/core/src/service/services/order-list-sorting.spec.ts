import 'reflect-metadata';

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { DataSource, EntitySchema } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RequestContext } from '../../api/common/request-context';
import { generateListOptions } from '../../api/config/generate-list-options';
import { ConfigService } from '../../config/config.service';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { Order } from '../../entity/order/order.entity';
import { ListQueryBuilder } from '../helpers/list-query-builder/list-query-builder';

import { OrderService } from './order.service';

// Use the same GraphQL instance as the production schema generator.
const { parse, print, getVariableValues } = createRequire(import.meta.url)('graphql');

describe('OrderService recent orders after GraphQL input coercion', () => {
    const db = new DataSource({
        type: 'sqljs',
        synchronize: true,
        entities: [
            new EntitySchema({
                name: 'Order',
                target: Order,
                columns: {
                    id: { type: Number, primary: true },
                    orderPlacedAt: { type: Date },
                    salesChannelId: { type: Number },
                    active: { type: Boolean },
                },
            }),
        ],
    });
    let builder: ListQueryBuilder;
    const ctx = { apiType: 'admin', channelId: 1, channel: { code: 'test-store' } } as RequestContext;
    const source = parse(
        readFileSync(new URL('../../api/schema/common/order.type.graphql', import.meta.url), 'utf8'),
    );
    const orderType = source.definitions.find((item: any) => item.name?.value === 'Order');
    const orderFields = orderType.fields.filter((field: any) =>
        ['id', 'createdAt', 'updatedAt', 'orderPlacedAt', 'active'].includes(field.name.value),
    );
    const schema = generateListOptions(`
        scalar DateTime
        interface Node { id: ID! }
        interface PaginatedList { items: [Node!]! totalItems: Int! }
        enum SortOrder { ASC DESC }
        input IDOperators { eq: ID }
        input StringOperators { eq: String }
        input BooleanOperators { eq: Boolean }
        input NumberRange { start: Int end: Int }
        input NumberOperators { eq: Int }
        input DateRange { start: DateTime end: DateTime }
        input DateOperators { eq: DateTime }
        ${print({ ...orderType, fields: orderFields })}
        type OrderList implements PaginatedList { items: [Order!]! totalItems: Int! }
        type Query { orders(options: OrderListOptions): OrderList! }
        input OrderListOptions
    `);

    beforeAll(async () => {
        await db.initialize();
        builder = new ListQueryBuilder(
            {
                rawConnection: db,
                getRepository: (_ctx: RequestContext, entity: typeof Order) => db.getRepository(entity),
            } as unknown as TransactionalConnection,
            {
                customFields: {},
                apiOptions: { shopListQueryLimit: 100, adminListQueryLimit: 100 },
            } as ConfigService,
        );
        await db.getRepository(Order).save([
            { id: 90, orderPlacedAt: new Date('2026-10-01'), salesChannelId: 1, active: false },
            { id: 10, orderPlacedAt: new Date('2026-10-26'), salesChannelId: 1, active: false },
            { id: 11, orderPlacedAt: new Date('2026-10-26'), salesChannelId: 1, active: false },
            { id: 99, orderPlacedAt: new Date('2026-10-27'), salesChannelId: 2, active: false },
            { id: 98, orderPlacedAt: new Date('2026-10-27'), salesChannelId: 1, active: true },
        ]);
    });
    afterAll(async () => {
        if (db.isInitialized) await db.destroy();
    });

    it.each(['DESC', 'ASC'])(
        'sorts by placement time then ID (%s), retaining channel and active filters',
        async direction => {
            const query = parse(
                'query Recent($options: OrderListOptions) { orders(options: $options) { totalItems } }',
            );
            const coerced = getVariableValues(schema, query.definitions[0].variableDefinitions, {
                options: {
                    take: 8,
                    sort: { orderPlacedAt: direction, id: direction },
                    filter: { active: { eq: false } },
                },
            });
            expect(coerced.errors).toBeUndefined();
            // Demonstrates why reordering the frontend JSON object cannot establish precedence.
            expect(Object.keys(coerced.coerced.options.sort)).toEqual(['id', 'orderPlacedAt']);
            const result = await OrderService.prototype.findAll.call(
                { listQueryBuilder: builder } as OrderService,
                ctx,
                coerced.coerced.options,
                [],
            );
            expect(result.totalItems).toBe(3);
            expect(result.items.map(order => order.id)).toEqual(
                direction === 'DESC' ? [11, 10, 90] : [90, 10, 11],
            );
        },
    );
});
