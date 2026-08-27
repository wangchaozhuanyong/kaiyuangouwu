import { Controller, Get, Param, Res } from '@nestjs/common';
import { createReadStream, statSync } from 'node:fs';

import { ImagePrivateStorageService } from './image-private-storage.service';

@Controller('image-generation/private')
export class ImagePrivateController {
    constructor(private readonly storage: ImagePrivateStorageService) {}

    @Get(':token')
    async serve(@Param('token') token: string, @Res() response: any): Promise<void> {
        const authorized = await this.storage.authorize(token);
        if (!authorized) {
            response.status(404).send('Image link is invalid or expired');
            return;
        }
        const { asset, path, download } = authorized;
        response.setHeader('Content-Type', asset.mimeType);
        response.setHeader('Content-Length', String(statSync(path).size));
        response.setHeader(
            'Content-Disposition',
            `${download ? 'attachment' : 'inline'}; filename="${asciiFileName(asset.originalName)}"`,
        );
        response.setHeader('Cache-Control', 'private, no-store, max-age=0');
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        createReadStream(path).pipe(response);
    }
}

function asciiFileName(value: string): string {
    return value.replace(/[^a-zA-Z0-9._-]/gu, '_');
}
