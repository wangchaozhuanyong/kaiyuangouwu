import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../api/common/request-context';

import { isPlatformAdminContext } from './platform-admin-context';

/** The platform owner's admin catalog is an aggregate; channel membership only grants sales access. */
export function catalogReadChannelId(ctx: RequestContext): ID | undefined {
    return isPlatformAdminContext(ctx) ? undefined : ctx.channelId;
}
