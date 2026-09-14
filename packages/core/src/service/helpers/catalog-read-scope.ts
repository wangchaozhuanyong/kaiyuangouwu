import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../api/common/request-context';

/** Every store, including the default store, reads only its explicitly assigned catalog. */
export function catalogReadChannelId(ctx: RequestContext): ID {
    return ctx.channelId;
}
