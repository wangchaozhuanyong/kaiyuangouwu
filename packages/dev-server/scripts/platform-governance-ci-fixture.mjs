import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

/** Connect only to the disposable, loopback MySQL service declared by the CI job. */
export function ciFixtureOptions(env = process.env) {
    assert.equal(env.CI, 'true', 'CI-only disposable fixture');
    assert.equal(env.PLATFORM_GOVERNANCE_CI_MYSQL, '1', 'Explicit CI fixture opt-in required');
    assert.match(env.E2E_MYSQL_PORT ?? '', /^[0-9]{1,5}$/u, 'Runner service port required');
    const port = Number(env.E2E_MYSQL_PORT);
    assert.ok(port > 1024 && port <= 65535, 'Invalid runner service port');
    return { host: '127.0.0.1', port, user: 'root', password: 'password' };
}
export async function createCiGovernanceDatabase() {
    const { createConnection } = await import('mysql2/promise');
    const options = ciFixtureOptions();
    const database = `governance_ci_${randomBytes(8).toString('hex')}`;
    const connection = await createConnection(options);
    try {
        await connection.query(`CREATE DATABASE \`${database}\``);
    } finally {
        await connection.end();
    }
    return {
        type: 'mysql',
        connectorPackage: 'mysql2',
        host: options.host,
        port: options.port,
        username: options.user,
        password: options.password,
        database,
        synchronize: false,
        logging: false,
    };
}
