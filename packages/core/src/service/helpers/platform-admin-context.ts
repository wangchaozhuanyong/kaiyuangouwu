import { Permission } from '@vendure/common/lib/generated-types';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';

import { RequestContext } from '../../api/common/request-context';

/** A management view, never a substitute for the store owning a business operation. */
export function isPlatformAdminContext(ctx: RequestContext): boolean {
    return (
        ctx.apiType === 'admin' &&
        ctx.channel.code === DEFAULT_CHANNEL_CODE &&
        ctx.userHasPermissions([Permission.SuperAdmin])
    );
}
