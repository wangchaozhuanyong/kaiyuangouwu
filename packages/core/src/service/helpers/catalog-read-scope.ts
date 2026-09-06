import { Permission } from '@vendure/common/lib/generated-types';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../api/common/request-context';

/** The platform owner's admin catalog is an aggregate; channel membership only grants sales access. */
export function catalogReadChannelId(ctx: RequestContext): ID | undefined {
    return ctx.apiType === 'admin' &&
        ctx.channel.code === DEFAULT_CHANNEL_CODE &&
        ctx.userHasPermissions([Permission.SuperAdmin])
        ? undefined
        : ctx.channelId;
}
