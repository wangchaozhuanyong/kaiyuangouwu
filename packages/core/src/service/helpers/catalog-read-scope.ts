import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../api/common/request-context';

/**
 * Catalog reads always follow the selected Channel, including SuperAdmin requests.
 * Platform-wide summaries must use an explicit aggregate API so that switching into
 * an operating store can never expose or mutate another store's catalog.
 */
export function catalogReadChannelId(ctx: RequestContext): ID | undefined {
    return ctx.channelId;
}
