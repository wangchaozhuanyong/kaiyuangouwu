import { Controller, Get, Param, Req, Res } from '@nestjs/common';

import { AfterSalesEvidenceService } from './after-sales-evidence.service';

@Controller('after-sales/evidence')
export class AfterSalesEvidenceController {
    constructor(private readonly evidence: AfterSalesEvidenceService) {}

    @Get(':token')
    async serve(@Param('token') token: string, @Req() request: any, @Res() response: any): Promise<void> {
        const row = await this.evidence.authorize(
            token,
            request.headers?.['x-forwarded-host'] ?? request.headers?.host,
        );
        if (!row) {
            response.status(404).send('Evidence unavailable');
            return;
        }
        try {
            const bytes = await this.evidence.read(row);
            response.setHeader('Content-Type', row.mimeType);
            response.setHeader('Content-Length', String(bytes.length));
            response.setHeader('Cache-Control', 'private, no-store, max-age=0');
            response.setHeader('X-Content-Type-Options', 'nosniff');
            response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
            response.setHeader('Content-Disposition', 'inline; filename="after-sales-evidence"');
            response.send(bytes);
        } catch {
            response.status(404).send('Evidence unavailable');
        }
    }
}
