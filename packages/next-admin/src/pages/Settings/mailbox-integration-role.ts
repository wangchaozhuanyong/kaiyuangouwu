export const MAILBOX_INTEGRATION_ROLE_CODE = 'id-business-mailbox-integration';

export const MAILBOX_INTEGRATION_PERMISSIONS = [
    'CreateIcloudRelay',
    'ReadIcloudRelay',
    'UpdateIcloudRelay',
    'DeleteIcloudRelay',
] as const;

export interface MailboxIntegrationRole {
    id: string;
    code: string;
    permissions: string[];
    channels: Array<{ id: string; code: string }>;
}

export function isMailboxIntegrationRole(role: MailboxIntegrationRole, defaultChannelId: string): boolean {
    const permissions = new Set(role.permissions);
    return (
        role.code === MAILBOX_INTEGRATION_ROLE_CODE &&
        role.channels.length === 1 &&
        role.channels[0]?.id === defaultChannelId &&
        permissions.size === MAILBOX_INTEGRATION_PERMISSIONS.length + 1 &&
        permissions.has('Authenticated') &&
        MAILBOX_INTEGRATION_PERMISSIONS.every(permission => permissions.has(permission))
    );
}
