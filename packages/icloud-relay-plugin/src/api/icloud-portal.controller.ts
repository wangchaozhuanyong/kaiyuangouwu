import { Controller, Get, Res } from '@nestjs/common';

import { PORTAL_HTML } from './portal-html';
import { PORTAL_JS } from './portal-script';

/**
 * Serves the static buyer mail inquiry portal at /mail-query and /mail-query/portal.js
 */
@Controller('mail-query')
export class IcloudPortalController {
    @Get()
    servePortal(@Res() res: any) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.send(PORTAL_HTML);
    }

    @Get('portal.js')
    serveScript(@Res() res: any) {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=300');
        res.send(PORTAL_JS);
    }
}
