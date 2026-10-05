import { registerInitializer, SqljsInitializer, TestDbInitializer } from '@vendure/testing';
import { Connection, createConnection } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { MysqlConnectionOptions } from 'typeorm/driver/mysql/MysqlConnectionOptions';

/** Never use the shared testing initializer, which drops deterministic database names. */
class IsolatedMysqlInitializer implements TestDbInitializer<MysqlConnectionOptions> {
    private connection: Connection;
    async init(_file: string, options: MysqlConnectionOptions) {
        if (
            options.host !== '127.0.0.1' ||
            options.port !== 37406 ||
            !process.env.ORDER_CLOSURE_MYSQL_PASSWORD
        )
            throw new Error('Only the owned order-closure MySQL runner is allowed');
        this.connection = await createConnection({
            host: options.host,
            port: options.port,
            user: options.username,
            password: options.password,
        });
        const database = 'order_closure_' + randomUUID().replace(/-/g, '');
        // New names only: no DROP, TRUNCATE or access to an existing database.
        await this.connection.query('CREATE DATABASE ?? CHARACTER SET utf8mb4', [database]);
        // TestServer uses this object after init() and does not consume its return value.
        Object.assign(options, { database, synchronize: true });
        return options;
    }
    async populate(operation: () => Promise<void>) {
        await operation();
    }
    async destroy() {
        await this.connection?.end();
    }
}

export function closureDatabase(directory: string) {
    if (process.env.DB === 'sqljs') {
        registerInitializer('sqljs', new SqljsInitializer(directory));
        return { type: 'sqljs' as const, autoSave: false, logging: false };
    }
    if (process.env.DB === 'mysql' && process.env.ORDER_CLOSURE_MYSQL === '1') {
        registerInitializer('mysql', new IsolatedMysqlInitializer());
        return {
            type: 'mysql' as const,
            host: '127.0.0.1',
            port: 37406,
            username: 'root',
            password: process.env.ORDER_CLOSURE_MYSQL_PASSWORD,
            timezone: 'Z',
            logging: false,
        };
    }
    throw new Error('Use DB=sqljs or the isolated order-closure MySQL runner');
}
