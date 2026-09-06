import type { SimpleGraphQLClient } from '@vendure/testing';
import gql from 'graphql-tag';

/** Creates synthetic administrators in the isolated E2E database. */
export async function createScopedAdminFixture(
    client: SimpleGraphQLClient,
    code: string,
    permissions: string[],
) {
    await client.asSuperAdmin();
    const { activeChannel } = await client.query(gql`
        query {
            activeChannel {
                id
            }
        }
    `);
    const { createRole } = await client.query(
        gql`
            mutation CreateScopedRole($input: CreateRoleInput!) {
                createRole(input: $input) {
                    id
                }
            }
        `,
        {
            input: {
                code,
                description: 'Isolated permission regression fixture',
                permissions: ['Authenticated', ...permissions],
                channelIds: [activeChannel.id],
            },
        },
    );
    const emailAddress = `${code}@example.test`;
    const password = 'ScopedFixture123!';
    await client.query(
        gql`
            mutation CreateScopedAdmin($input: CreateAdministratorInput!) {
                createAdministrator(input: $input) {
                    id
                }
            }
        `,
        {
            input: {
                emailAddress,
                password,
                firstName: 'Permission',
                lastName: 'Fixture',
                roleIds: [createRole.id],
            },
        },
    );
    return { emailAddress, password };
}
