import {
    Body,
    Controller,
    ForbiddenException,
    Get,
    Header,
    HttpCode,
    HttpException,
    Inject,
    NotFoundException,
    Post,
    Req,
} from '@nestjs/common';
import type { Request } from 'express';

import { AddressToolError } from './identity';
import { TaxFreeAddressService } from './service';

export const ADDRESS_TOOL_ORIGIN = Symbol('ADDRESS_TOOL_ORIGIN');
const statuses: Record<string, number> = {
    COOLDOWN: 429,
    RATE_LIMIT: 429,
    RESULT_EXPIRED: 410,
    EXHAUSTED: 503,
    UNAVAILABLE: 503,
};

/** This host has dedicated JSON routes and never exposes either Vendure GraphQL API. */
@Controller('api/address')
export class TaxFreeAddressController {
    constructor(
        @Inject(TaxFreeAddressService) private readonly service: TaxFreeAddressService,
        @Inject(ADDRESS_TOOL_ORIGIN) private readonly origin: URL | null,
    ) {}

    @Get('status')
    @Header('Cache-Control', 'private, no-store')
    async status(@Req() req: Request) {
        this.checkHost(req);
        return this.respond(this.service.status(req));
    }

    @Post('claim')
    @HttpCode(200)
    @Header('Cache-Control', 'private, no-store')
    async claim(@Req() req: Request, @Body() body: { requestId?: unknown } | null = null) {
        this.checkHost(req);
        if (req.get('Origin') !== this.origin?.origin || !req.is('application/json'))
            throw new ForbiddenException();
        return this.respond(this.service.claimPublic(req, body?.requestId));
    }

    private checkHost(req: Request) {
        // Trust the exact incoming Host set by the isolated proxy, not a client forwarded host.
        if (!this.origin || !req.secure || req.get('Host') !== this.origin.host)
            throw new NotFoundException();
        const fetchSite = req.get('Sec-Fetch-Site');
        if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') throw new ForbiddenException();
    }

    private async respond<T>(work: Promise<T>): Promise<T> {
        try {
            return await work;
        } catch (error) {
            if (!(error instanceof AddressToolError)) throw error;
            throw new HttpException({ code: error.message }, statuses[error.code] ?? 400);
        }
    }
}
