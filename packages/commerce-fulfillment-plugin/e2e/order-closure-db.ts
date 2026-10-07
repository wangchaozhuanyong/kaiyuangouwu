import { registerInitializer, SqljsInitializer, TestDbInitializer } from '@vendure/testing';
import { Connection, createConnection } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { MysqlConnectionOptions } from 'typeorm/driver/mysql/MysqlConnectionOptions';

/** Never use the shared testing initializer, which drops deterministic database names. */
class IsolatedMysqlInitializer implements TestDbInitializer<MysqlConnectionOptions> {
    private connection: Connection;
    private database = '';
    constructor(private readonly directory: string) {}

    private phase(phase: string, details: object = {}) {
        mkdirSync(this.directory, { recursive: true });
        appendFileSync(
            resolve(this.directory, 'mysql-initializer-phases.jsonl'),
            JSON.stringify({ at: new Date().toISOString(), phase, ...details }) + '\n',
        );
    }
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
        this.phase('CONNECTED_OWNED_MYSQL');
        const database = 'order_closure_' + randomUUID().replace(/-/g, '');
        // New names only: no DROP, TRUNCATE or access to an existing database.
        await this.connection.query('CREATE DATABASE ?? CHARACTER SET utf8mb4', [database]);
        this.database = database;
        this.phase('CREATED_NEW_DATABASE', { database });
        // TestServer uses this object after init() and does not consume its return value.
        Object.assign(options, { database, synchronize: true });
        return options;
    }
    async populate(operation: () => Promise<void>) {
        this.phase('POPULATE_STARTED');
        let running = false;
        let diagnostic = Promise.resolve();
        const timer = setInterval(() => {
            if (running) return;
            running = true;
            diagnostic = (async () => {
                const [tables] = await this.connection.query(
                    'SELECT COUNT(*) AS count FROM information_schema.tables WHERE TABLE_SCHEMA = ?',
                    [this.database],
                );
                const [waits] = await this.connection.query(
                    'SELECT COUNT(*) AS count FROM performance_schema.data_lock_waits',
                );
                const [processes] = await this.connection.query(
                    'SELECT ID, COMMAND, TIME, STATE FROM INFORMATION_SCHEMA.PROCESSLIST WHERE DB = ?',
                    [this.database],
                );
                this.phase('POPULATE_PROGRESS', { tables, waits, processes, sqlParametersIncluded: false });
            })()
                .catch(error => this.phase('DIAGNOSTIC_ERROR', { code: error?.code ?? 'UNKNOWN' }))
                .finally(() => {
                    running = false;
                });
        }, 5000);
        try {
            await operation();
            this.phase('POPULATE_COMPLETE');
        } finally {
            clearInterval(timer);
            await diagnostic;
        }
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
        registerInitializer('mysql', new IsolatedMysqlInitializer(directory));
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
