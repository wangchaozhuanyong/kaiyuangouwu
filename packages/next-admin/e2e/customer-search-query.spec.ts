import { Customer, ListQueryBuilder } from '@vendure/core';
import 'reflect-metadata';
import { DataSource, EntitySchema } from 'typeorm';
import { expect, it } from 'vitest';
import { customerFilter } from '../src/pages/Customers/customer-search';

it('filters the displayed full name before server count and pagination using the real query builder', async () => {
    const db = await new DataSource({
        type: 'sqljs',
        synchronize: true,
        entities: [
            new EntitySchema<Customer>({
                name: 'Customer',
                target: Customer,
                columns: {
                    id: { type: String, primary: true },
                    firstName: { type: String },
                    lastName: { type: String },
                    emailAddress: { type: String },
                    phoneNumber: { type: String },
                },
            }),
        ],
    }).initialize();
    try {
        await db.getRepository(Customer).save([
            {
                id: 'one',
                lastName: 'w',
                firstName: 'ww',
                emailAddress: 'one@example.invalid',
                phoneNumber: '100',
            },
            {
                id: 'two',
                lastName: 'ww',
                firstName: 'w',
                emailAddress: 'two@example.invalid',
                phoneNumber: '200',
            },
            {
                id: 'other',
                lastName: 'x',
                firstName: 'xx',
                emailAddress: 'other@example.invalid',
                phoneNumber: '300',
            },
        ]);
        const builder = new ListQueryBuilder(
            { rawConnection: db } as any,
            {
                customFields: { Customer: [] },
                apiOptions: { shopListQueryLimit: 100, adminListQueryLimit: 100 },
                defaultLanguageCode: 'en',
            } as any,
        );
        const [items, total] = await builder
            .build(Customer, { filter: customerFilter('www'), take: 1, skip: 1, sort: { id: 'ASC' } } as any)
            .getManyAndCount();
        expect(total).toBe(2);
        expect(items.map(item => item.id)).toEqual(['two']);
        const [byEmail, emailTotal] = await builder
            .build(Customer, { filter: customerFilter('one@example.invalid') } as any)
            .getManyAndCount();
        expect(emailTotal).toBe(1);
        expect(byEmail[0].id).toBe('one');
    } finally {
        await db.destroy();
    }
});
