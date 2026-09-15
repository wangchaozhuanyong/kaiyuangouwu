import { CurrencyCode, LanguageCode } from '@vendure/common/lib/generated-types';
import {
    Address,
    ChannelService,
    ConfigService,
    Customer,
    CustomerChannelAssignmentService,
    CustomerGroup,
    CustomerGroupService,
    CustomerService,
    CustomerStoreEntry,
    HistoryService,
    NativeAuthenticationMethod,
    Order,
    OrderService,
    RequestContext,
    RequestContextService,
    RoleService,
    TransactionalConnection,
    User,
    UserService,
    mergeConfig,
} from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import gql from 'graphql-tag';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { testConfig } from '../../../e2e-common/test-config';

const config = mergeConfig(testConfig(), {
    apiOptions: { port: 37385 },
    authOptions: { requireVerification: true },
});
const { server, shopClient, adminClient } = createTestEnvironment(config);
let connection: TransactionalConnection;
let contexts: RequestContextService;
let customers: CustomerService;
let users: UserService;
let groups: CustomerGroupService;
let admin: RequestContext;
let a: RequestContext;
let b: RequestContext;
let c: RequestContext;
let member: Customer;
const email = 'shared-member@example.test';
const password = 'synthetic-test-password';

function required<T>(value: T | null | undefined, label: string): T {
    if (value == null) throw new Error(`Expected ${label}`);
    return value;
}

async function globalMember(identifier: string): Promise<Customer> {
    return connection.getRepository(admin, Customer).findOneOrFail({
        where: { emailAddress: identifier },
        relations: ['user', 'user.authenticationMethods', 'channels'],
    });
}
beforeAll(async () => {
    await server.init({ initialData, customerCount: 0 });
    connection = server.app.get(TransactionalConnection);
    contexts = server.app.get(RequestContextService);
    customers = server.app.get(CustomerService);
    users = server.app.get(UserService);
    groups = server.app.get(CustomerGroupService);
    const credentials = required(config.authOptions.superadminCredentials, 'superadmin credentials');
    const operator = await connection.getRepository(RequestContext.empty(), User).findOneOrFail({
        where: { identifier: credentials.identifier },
        relations: ['roles', 'roles.channels'],
    });
    admin = await contexts.create({ apiType: 'admin', user: operator });
    for (const token of ['member-a', 'member-b', 'member-c']) {
        const result = await server.app.get(ChannelService).create(admin, {
            code: token,
            token,
            defaultLanguageCode: LanguageCode.en,
            currencyCode: CurrencyCode.GBP,
            pricesIncludeTax: true,
        });
        expect('id' in result).toBe(true);
    }
    a = await contexts.create({ apiType: 'shop', channelOrToken: 'member-a' });
    b = await contexts.create({ apiType: 'shop', channelOrToken: 'member-b' });
    c = await contexts.create({ apiType: 'shop', channelOrToken: 'member-c' });
    await customers.registerCustomerAccount(a, {
        emailAddress: email,
        password,
        firstName: 'Original',
        lastName: 'Member',
    });
    member = await globalMember(email);
}, 120000);
afterAll(async () => {
    await server.destroy();
});

it('reuses the global identity without overwriting data or joining a store on an unverified request', async () => {
    await customers.registerCustomerAccount(b, {
        emailAddress: email.toUpperCase(),
        password: 'different-password',
        firstName: 'Overwrite',
        lastName: 'Denied',
    });
    const after = await globalMember(email);
    expect(after.id).toBe(member.id);
    expect(after.firstName).toBe('Original');
    expect(after.channels.map(channel => String(channel.id))).not.toContain(String(b.channelId));
    expect(await connection.getRepository(admin, User).count({ where: { customerIdentifier: email } })).toBe(
        1,
    );
    expect(
        await customers.create(
            await contexts.create({ apiType: 'admin', channelOrToken: 'member-b' }),
            {
                emailAddress: email,
                firstName: 'Merchant overwrite',
                lastName: 'Denied',
            },
            password,
        ),
    ).toMatchObject({ errorCode: 'EMAIL_ADDRESS_CONFLICT_ERROR' });
});

it('verifies and signs in from another store, sharing one profile and independent orders', async () => {
    const current = await globalMember(email);
    const token = required(
        required(current.user, 'current member user').getNativeAuthenticationMethod().verificationToken,
        'verification token',
    );
    const verified = await customers.verifyCustomerEmailAddress(b, token);
    expect('id' in verified && verified.id).toBe(member.id);
    shopClient.setChannelToken('member-b');
    await shopClient.asUserWithCredentials(email, password);
    // The testing helper selects login.channels[0]; the actual requested storefront remains B.
    shopClient.setChannelToken('member-b');
    const response = await shopClient.query(gql`
        query {
            activeCustomer {
                id
                firstName
            }
        }
    `);
    expect(response.activeCustomer.firstName).toBe('Original');
    member = await globalMember(email);
    expect(member.channels.map(channel => String(channel.id))).toEqual(
        expect.arrayContaining([String(a.channelId), String(b.channelId)]),
    );
    const orderService = server.app.get(OrderService);
    const memberUser = required(member.user, 'member user');
    const orderA = await orderService.create(a, memberUser.id);
    const orderB = await orderService.create(b, memberUser.id);
    expect((await orderService.findByCustomerId(a, member.id)).items.map(order => order.id)).toEqual([
        orderA.id,
    ]);
    expect((await orderService.findByCustomerId(b, member.id)).items.map(order => order.id)).toEqual([
        orderB.id,
    ]);
});

it('shares address changes and clears the active customer on logout', async () => {
    const address = await customers.createAddress(a, member.id, {
        fullName: 'Shared Member',
        streetLine1: 'Local test street',
        countryCode: 'GB',
    });
    expect((await customers.findAddressesByCustomerId(b, member.id)).map(row => row.id)).toContain(
        address.id,
    );
    await customers.updateAddress(b, { id: address.id, streetLine1: 'Changed in store B' });
    expect(
        (await customers.findAddressesByCustomerId(a, member.id)).find(row => row.id === address.id)
            ?.streetLine1,
    ).toBe('Changed in store B');
    await shopClient.asAnonymousUser();
    const anonymous = await shopClient.query(gql`
        query {
            activeCustomer {
                id
            }
        }
    `);
    expect(anonymous.activeCustomer).toBeNull();
});

it('rejects another member address even when both accounts belong to the same stores', async () => {
    const other = await customers.create(
        admin.copy({ channel: a.channel }),
        { emailAddress: 'other-owner@example.test', firstName: 'Other', lastName: 'Member' },
        password,
    );
    if (!('id' in other)) throw new Error('Expected synthetic customer');
    await server.app.get(ChannelService).assignToChannels(admin, Customer, other.id, [b.channelId]);
    const otherAddress = await customers.createAddress(a, other.id, {
        fullName: 'Other',
        streetLine1: 'Private other street',
        countryCode: 'GB',
    });
    shopClient.setChannelToken('member-b');
    await shopClient.asUserWithCredentials(email, password);
    shopClient.setChannelToken('member-b');
    await expect(
        shopClient.query(
            gql`
                mutation ($input: UpdateAddressInput!) {
                    updateCustomerAddress(input: $input) {
                        id
                    }
                }
            `,
            { input: { id: 'T_' + otherAddress.id, streetLine1: 'Forbidden' } },
        ),
    ).rejects.toThrow();
    await expect(
        shopClient.query(
            gql`
                mutation ($id: ID!) {
                    deleteCustomerAddress(id: $id) {
                        success
                    }
                }
            `,
            { id: 'T_' + otherAddress.id },
        ),
    ).rejects.toThrow();
    expect(
        (await connection.getRepository(admin, Address).findOneByOrFail({ id: otherAddress.id })).streetLine1,
    ).toBe('Private other street');
    await shopClient.asAnonymousUser();
});

it('consumes a password reset token once under concurrent cross-store requests', async () => {
    const account = required(await users.setPasswordResetToken(a, email), 'password-reset account');
    const token = required(
        account.getNativeAuthenticationMethod().passwordResetToken,
        'password-reset token',
    );
    const results = await Promise.all([
        customers.resetPassword(a, token, password + '-concurrent-a'),
        customers.resetPassword(b, token, password + '-concurrent-b'),
    ]);
    expect(results.filter(result => 'id' in result)).toHaveLength(1);
    expect(results.filter(result => 'errorCode' in result)).toHaveLength(1);
});

it('supports global password reset without recording unverified store entry and rejects admin tokens', async () => {
    await customers.requestPasswordReset(c, email);
    const current = await globalMember(email);
    expect(current.channels.map(channel => String(channel.id))).not.toContain(String(c.channelId));
    const token = required(
        required(current.user, 'current member user').getNativeAuthenticationMethod().passwordResetToken,
        'password-reset token',
    );
    expect('id' in (await customers.resetPassword(c, token, password + '-reset'))).toBe(true);
    expect(await customers.resetPassword(c, token, password)).toMatchObject({
        errorCode: 'PASSWORD_RESET_TOKEN_INVALID_ERROR',
    });
    const credentials = required(config.authOptions.superadminCredentials, 'superadmin credentials');
    const operator = required(
        await users.setPasswordResetToken(admin, credentials.identifier),
        'operator password-reset account',
    );
    const operatorToken = required(
        operator.getNativeAuthenticationMethod().passwordResetToken,
        'operator password-reset token',
    );
    expect(await customers.resetPassword(b, operatorToken, password)).toMatchObject({
        errorCode: 'PASSWORD_RESET_TOKEN_INVALID_ERROR',
    });
    await adminClient.asSuperAdmin();
});

it('serializes customer identity creation across stores without leaving orphan accounts or auth methods', async () => {
    const target = 'concurrent-member@example.test';
    const results = await Promise.all(
        Array.from({ length: 6 }, (_, index) =>
            customers.registerCustomerAccount(index % 2 ? a : b, {
                emailAddress: target,
                password,
                firstName: 'Concurrent',
                lastName: 'Member',
            }),
        ),
    );
    expect(results.every(result => 'success' in result && result.success)).toBe(true);
    const created = await globalMember(target);
    expect(await connection.getRepository(admin, User).count({ where: { customerIdentifier: target } })).toBe(
        1,
    );
    expect(await connection.getRepository(admin, Customer).count({ where: { emailAddress: target } })).toBe(
        1,
    );
    expect(
        await connection
            .getRepository(admin, NativeAuthenticationMethod)
            .count({ where: { user: { id: required(created.user, 'created member user').id } } }),
    ).toBe(1);
    expect(created.channels).toHaveLength(1);
});

it('keeps customer group membership, concurrent changes and cached eligibility per store', async () => {
    const groupA = await groups.create(a, { name: 'A activity' });
    const groupB = await groups.create(b, { name: 'B activity' });
    await Promise.all([
        groups.addCustomersToGroup(a, {
            customerGroupId: groupA.id,
            customerIds: [member.id as string],
        }),
        groups.addCustomersToGroup(b, {
            customerGroupId: groupB.id,
            customerIds: [member.id as string],
        }),
    ]);
    expect((await customers.getCustomerGroups(a, member.id)).map(group => group.id)).toEqual([groupA.id]);
    expect((await customers.getCustomerGroups(b, member.id)).map(group => group.id)).toEqual([groupB.id]);
    expect(await groups.findOne(b, groupA.id)).toBeUndefined();
    await expect(groups.update(b, { id: groupA.id, name: 'Wrong store' })).rejects.toThrow();
    await expect(
        groups.addCustomersToGroup(b, {
            customerGroupId: groupA.id,
            customerIds: [member.id as string],
        }),
    ).rejects.toThrow();
    const condition = required(
        server.app
            .get(ConfigService)
            .promotionOptions.promotionConditions.find(candidate => candidate.code === 'customer_group'),
        'customer group promotion condition',
    );
    const order = new Order({ customer: member, lines: [] });
    const args = [{ name: 'customerGroupId', value: String(groupA.id) }];
    expect(await condition.check(a, order, args, {} as any)).toBe(true);
    expect(await condition.check(b, order, args, {} as any)).toBe(false);
    await groups.removeCustomersFromGroup(a, {
        customerGroupId: groupA.id,
        customerIds: [member.id],
    });
    expect((await customers.getCustomerGroups(b, member.id)).map(group => group.id)).toEqual([groupB.id]);
    expect(await condition.check(a, order, args, {} as any)).toBe(false);
    await connection.getRepository(admin, CustomerGroup).update(groupB.id, { channelId: null });
    expect(await customers.getCustomerGroups(b, member.id)).toEqual([]);
});

it('records first entry per store once and preserves unknown legacy entry dates', async () => {
    const entries = connection.getRepository(admin, CustomerStoreEntry);
    const entryA = await entries.findOneByOrFail({ customerId: member.id, channelId: a.channelId });
    const entryB = await entries.findOneByOrFail({ customerId: member.id, channelId: b.channelId });
    expect(entryA).toMatchObject({ source: 'REGISTRATION', firstSeenAt: null });
    expect(entryB.source).toBe('AUTHENTICATED_ENTRY');
    expect(entryB.firstSeenAt).toBeInstanceOf(Date);
    const assignment = server.app.get(CustomerChannelAssignmentService);
    const signedA = await contexts.create({
        apiType: 'shop',
        channelOrToken: 'member-a',
        user: required(member.user, 'member user'),
    });
    const signedB = await contexts.create({
        apiType: 'shop',
        channelOrToken: 'member-b',
        user: required(member.user, 'member user'),
    });
    await Promise.all(Array.from({ length: 5 }, () => assignment.tryAssignToActiveChannel(signedA)));
    expect((await entries.findOneByOrFail({ id: entryA.id })).firstSeenAt).toBeInstanceOf(Date);
    await assignment.tryAssignToActiveChannel(signedB);
    expect((await entries.findOneByOrFail({ id: entryB.id })).firstSeenAt).toEqual(entryB.firstSeenAt);
    await server.app.get(ChannelService).assignToChannels(admin, Customer, member.id, [c.channelId]);
    const signedC = await contexts.create({
        apiType: 'shop',
        channelOrToken: 'member-c',
        user: required(member.user, 'member user'),
    });
    await assignment.tryAssignToActiveChannel(signedC);
    expect(await entries.findOneByOrFail({ customerId: member.id, channelId: c.channelId })).toMatchObject({
        source: 'LEGACY_UNRESOLVED',
        firstSeenAt: null,
    });
    expect(await entries.count({ where: { customerId: member.id } })).toBe(3);
});

it('changes the shared email atomically across stores and preserves the token after rollback', async () => {
    const oldEmail = 'email-atomic-before@example.test';
    const newEmail = 'email-atomic-after@example.test';
    const created = await customers.create(
        admin.copy({ channel: a.channel }),
        { emailAddress: oldEmail, firstName: 'Email', lastName: 'Owner' },
        password,
    );
    if (!('id' in created)) throw new Error('Expected synthetic customer');
    const user = required((await globalMember(oldEmail)).user, 'email owner user');
    expect(await customers.requestUpdateEmailAddress(a, user.id, newEmail)).toBe(true);
    const token = required(
        required((await globalMember(oldEmail)).user, 'email owner user').getNativeAuthenticationMethod()
            .identifierChangeToken,
        'identifier-change token',
    );
    const history = server.app.get(HistoryService);
    const failure = vi
        .spyOn(history, 'createHistoryEntryForCustomer')
        .mockRejectedValueOnce(new Error('synthetic history write failure'));
    try {
        await expect(customers.updateEmailAddress(b, token)).rejects.toThrow(
            'synthetic history write failure',
        );
    } finally {
        failure.mockRestore();
    }
    const afterFailure = await globalMember(oldEmail);
    const afterFailureUser = required(afterFailure.user, 'email owner user after rollback');
    expect(afterFailureUser.identifier).toBe(oldEmail);
    expect(afterFailureUser.getNativeAuthenticationMethod().identifierChangeToken).toBe(token);
    expect(await customers.updateEmailAddress(b, token)).toBe(true);
    const updated = await globalMember(newEmail);
    expect(updated.id).toBe(created.id);
    const updatedUser = required(updated.user, 'updated email owner user');
    expect(updatedUser.identifier).toBe(newEmail);
    expect(updatedUser.customerIdentifier).toBe(newEmail);
    expect(updatedUser.getNativeAuthenticationMethod().identifier).toBe(newEmail);
    expect(updated.channels.map(channel => String(channel.id))).not.toContain(String(b.channelId));
    expect(await customers.updateEmailAddress(a, token)).toMatchObject({
        errorCode: 'IDENTIFIER_CHANGE_TOKEN_INVALID_ERROR',
    });
});

it('rejects ambiguous legacy identities rather than choosing or merging one', async () => {
    const role = await server.app.get(RoleService).getCustomerRole(admin);
    const duplicate = await connection.getRepository(admin, User).save(
        new User({
            identifier: email,
            customerIdentifier: null,
            verified: true,
            roles: [role],
        }),
    );
    await connection.getRepository(admin, Customer).save(
        new Customer({
            emailAddress: email,
            firstName: 'Legacy',
            lastName: 'Duplicate',
            user: duplicate,
            channels: [a.channel],
        }),
    );
    await expect(users.getUserByEmailAddress(a, email, 'customer')).rejects.toThrow('重复身份');
    await expect(users.getUserByEmailAddress(b, email, 'customer')).rejects.toThrow('重复身份');
});
