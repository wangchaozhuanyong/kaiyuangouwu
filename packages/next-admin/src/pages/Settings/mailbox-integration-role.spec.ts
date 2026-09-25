import { describe, expect, it } from 'vitest';
import {
    isMailboxIntegrationRole,
    MAILBOX_INTEGRATION_PERMISSIONS,
    MAILBOX_INTEGRATION_ROLE_CODE,
} from './mailbox-integration-role';

const role = {
    id: 'role-1',
    code: MAILBOX_INTEGRATION_ROLE_CODE,
    permissions: ['Authenticated', ...MAILBOX_INTEGRATION_PERMISSIONS],
    channels: [{ id: 'default-channel', code: '__default_channel__' }],
};

describe('mailbox integration role', () => {
    it('accepts only the four mailbox permissions on the default channel', () => {
        expect(isMailboxIntegrationRole(role, 'default-channel')).toBe(true);
        expect(
            isMailboxIntegrationRole(
                { ...role, permissions: [...role.permissions, 'ReadOrder'] },
                'default-channel',
            ),
        ).toBe(false);
        expect(
            isMailboxIntegrationRole(
                { ...role, permissions: role.permissions.slice(0, -1) },
                'default-channel',
            ),
        ).toBe(false);
        expect(isMailboxIntegrationRole(role, 'other-channel')).toBe(false);
        expect(
            isMailboxIntegrationRole(
                { ...role, channels: [...role.channels, { id: 'store', code: 'store' }] },
                'default-channel',
            ),
        ).toBe(false);
    });
});
