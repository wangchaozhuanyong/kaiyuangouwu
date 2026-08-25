import { describe, expect, it } from 'vitest';

import { assertSafeDevPopulateEnvironment } from './populate-safety';

describe('development population safety', () => {
    it.each(['development', 'test'])('allows the %s environment with a development database', nodeEnv => {
        expect(() =>
            assertSafeDevPopulateEnvironment({
                NODE_ENV: nodeEnv,
                DB_NAME: 'vendure-dev',
            }),
        ).not.toThrow();
    });

    it.each([undefined, '', 'production', 'staging'])('blocks NODE_ENV=%s', nodeEnv => {
        expect(() =>
            assertSafeDevPopulateEnvironment({
                NODE_ENV: nodeEnv,
                DB_NAME: 'vendure-dev',
            }),
        ).toThrow(/Refusing to run the destructive development population command/);
    });

    it.each(['vendure_prod', 'vendure-production', 'prod', 'shop.prod.mysql'])(
        'blocks a production-shaped database name: %s',
        databaseName => {
            expect(() =>
                assertSafeDevPopulateEnvironment({
                    NODE_ENV: 'development',
                    DB_NAME: databaseName,
                }),
            ).toThrow(/DB_NAME looks like a production database/);
        },
    );
});
