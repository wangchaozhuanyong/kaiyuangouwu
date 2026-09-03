import { RequestContext, VendureEvent } from '@vendure/core';

import { type AdminNotificationInput } from './admin-notification.service';

export type AdminNotificationRequestMode = 'ONE_OFF' | 'INCIDENT_FIRING' | 'INCIDENT_RESOLVED';

export interface AdminNotificationRequest extends AdminNotificationInput {
    mode?: AdminNotificationRequestMode;
}

/**
 * A business-domain signal which asks the operations plugin to create a durable notification.
 * The event carries operational metadata only; callers must not include credentials or payment secrets.
 */
export class AdminNotificationRequestedEvent extends VendureEvent {
    constructor(
        public readonly ctx: RequestContext,
        public readonly notification: AdminNotificationRequest,
    ) {
        super();
    }
}
