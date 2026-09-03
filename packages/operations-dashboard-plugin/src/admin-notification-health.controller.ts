import { Controller, Get, Res } from '@nestjs/common';
import { TransactionalConnection } from '@vendure/core';

@Controller('health')
export class AdminNotificationHealthController {
    constructor(private readonly connection: TransactionalConnection) {}

    @Get('live')
    live() {
        return { status: 'ok' };
    }

    @Get('ready')
    async ready(@Res() response: any): Promise<void> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            await Promise.race([
                this.connection.rawConnection.query('SELECT 1'),
                new Promise<never>((_, reject) => {
                    timer = setTimeout(() => reject(new Error('database readiness timeout')), 3_000);
                }),
            ]);
            response.status(200).json({ status: 'ok', components: { database: 'up' } });
        } catch {
            response.status(503).json({ status: 'unavailable', components: { database: 'down' } });
        } finally {
            if (timer) clearTimeout(timer);
        }
    }
}
