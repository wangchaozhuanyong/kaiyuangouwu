import { Controller, Get, Param, Res } from '@nestjs/common';
import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';

import { DigitalDeliveryService } from './digital-delivery.service';

@Controller('digital-delivery')
export class DigitalDeliveryController {
    constructor(private readonly deliveryService: DigitalDeliveryService) {}

    @Get(':token')
    async download(@Param('token') token: string, @Res() response: any): Promise<void> {
        const authorized = await this.deliveryService.authorizeDownload(token);
        if (!authorized) {
            response.status(404).send('Digital delivery link is invalid or expired');
            return;
        }
        const { resource } = authorized;
        const size = statSync(resource.path).size;
        response.setHeader('Content-Type', contentTypeFor(resource.path));
        response.setHeader('Content-Length', String(size));
        response.setHeader('Content-Disposition', contentDisposition(resource.downloadName));
        response.setHeader('Cache-Control', 'private, no-store, max-age=0');
        response.setHeader('X-Content-Type-Options', 'nosniff');
        createReadStream(resource.path).pipe(response);
    }
}

function contentTypeFor(filePath: string): string {
    const extension = path.extname(filePath).toLowerCase();
    if (extension === '.zip') return 'application/zip';
    if (extension === '.pdf') return 'application/pdf';
    if (extension === '.md') return 'text/markdown; charset=utf-8';
    return 'text/plain; charset=utf-8';
}

function contentDisposition(fileName: string): string {
    const asciiName = fileName.replace(/[^a-zA-Z0-9._-]/gu, '_');
    return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
