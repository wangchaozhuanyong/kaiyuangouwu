import { gql } from '@apollo/client';

const CUSTOMER_LIST_FIELDS = gql`
    fragment AdminCustomerListFields on Customer {
        id
        createdAt
        updatedAt
        firstName
        lastName
        emailAddress
        phoneNumber
        groups {
            id
            name
        }
        user {
            id
            verified
            lastLogin
        }
        orders(
            options: { take: 1, sort: { orderPlacedAt: DESC, id: DESC }, filter: { active: { eq: false } } }
        ) {
            totalItems
            items {
                id
                code
                state
                orderPlacedAt
                totalWithTax
                currencyCode
            }
        }
    }
`;

export const CUSTOMERS_QUERY = gql`
    ${CUSTOMER_LIST_FIELDS}
    query AdminCustomers($options: CustomerListOptions) {
        customers(options: $options) {
            totalItems
            items {
                ...AdminCustomerListFields
            }
        }
    }
`;

export const CUSTOMER_GROUP_MEMBERS_QUERY = gql`
    ${CUSTOMER_LIST_FIELDS}
    query AdminCustomerGroupMembers($id: ID!, $options: CustomerListOptions) {
        customerGroup(id: $id) {
            id
            name
            customers(options: $options) {
                totalItems
                items {
                    ...AdminCustomerListFields
                }
            }
        }
    }
`;

export const CUSTOMER_GROUPS_QUERY = gql`
    query AdminCustomerGroups($options: CustomerGroupListOptions) {
        customerGroups(options: $options) {
            totalItems
            items {
                id
                name
                customers(options: { take: 1 }) {
                    totalItems
                }
            }
        }
    }
`;

export const CUSTOMER_DETAIL_QUERY = gql`
    query AdminCustomerDetail($id: ID!) {
        customer(id: $id) {
            id
            createdAt
            updatedAt
            title
            firstName
            lastName
            phoneNumber
            emailAddress
            groups {
                id
                name
            }
            user {
                id
                identifier
                verified
                lastLogin
            }
            addresses {
                id
                fullName
                company
                streetLine1
                streetLine2
                city
                province
                postalCode
                country {
                    id
                    code
                    name
                }
                phoneNumber
                defaultShippingAddress
                defaultBillingAddress
            }
            orders(
                options: {
                    take: 100
                    sort: { orderPlacedAt: DESC, id: DESC }
                    filter: { active: { eq: false } }
                }
            ) {
                totalItems
                items {
                    id
                    code
                    state
                    orderPlacedAt
                    totalWithTax
                    currencyCode
                }
            }
            history(options: { take: 30, sort: { createdAt: DESC, id: DESC } }) {
                totalItems
                items {
                    id
                    type
                    createdAt
                    isPublic
                    administrator {
                        id
                        firstName
                        lastName
                    }
                    data
                }
            }
        }
    }
`;

export const CUSTOMER_ADDRESS_COUNTRIES_QUERY = gql`
    query AdminCustomerAddressCountries {
        countries(options: { take: 250, sort: { name: ASC, id: ASC }, filter: { enabled: { eq: true } } }) {
            items {
                id
                code
                name
            }
        }
    }
`;

export const UPDATE_CUSTOMER_MUTATION = gql`
    mutation AdminUpdateCustomer($input: UpdateCustomerInput!) {
        updateCustomer(input: $input) {
            __typename
            ... on Customer {
                id
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

export const CREATE_CUSTOMER_MUTATION = gql`
    mutation AdminCreateCustomer($input: CreateCustomerInput!) {
        createCustomer(input: $input) {
            __typename
            ... on Customer {
                id
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

export const DELETE_CUSTOMERS_MUTATION = gql`
    mutation AdminDeleteCustomers($ids: [ID!]!) {
        deleteCustomers(ids: $ids) {
            result
            message
        }
    }
`;

export const ADD_CUSTOMERS_TO_GROUP_MUTATION = gql`
    mutation AdminAddCustomersToGroup($customerIds: [ID!]!, $groupId: ID!) {
        addCustomersToGroup(customerIds: $customerIds, customerGroupId: $groupId) {
            id
        }
    }
`;

export const REMOVE_CUSTOMERS_FROM_GROUP_MUTATION = gql`
    mutation AdminRemoveCustomersFromGroup($customerIds: [ID!]!, $groupId: ID!) {
        removeCustomersFromGroup(customerIds: $customerIds, customerGroupId: $groupId) {
            id
        }
    }
`;

export const CREATE_CUSTOMER_ADDRESS_MUTATION = gql`
    mutation AdminCreateCustomerAddress($customerId: ID!, $input: CreateAddressInput!) {
        createCustomerAddress(customerId: $customerId, input: $input) {
            id
        }
    }
`;

export const UPDATE_CUSTOMER_ADDRESS_MUTATION = gql`
    mutation AdminUpdateCustomerAddress($input: UpdateAddressInput!) {
        updateCustomerAddress(input: $input) {
            id
        }
    }
`;

export const DELETE_CUSTOMER_ADDRESS_MUTATION = gql`
    mutation AdminDeleteCustomerAddress($id: ID!) {
        deleteCustomerAddress(id: $id) {
            success
        }
    }
`;

export const ADD_CUSTOMER_NOTE_MUTATION = gql`
    mutation AdminAddCustomerNote($customerId: ID!, $note: String!) {
        addNoteToCustomer(input: { id: $customerId, note: $note, isPublic: false }) {
            id
        }
    }
`;

export const ADD_CUSTOMER_TO_GROUP_MUTATION = gql`
    mutation AdminAddCustomerToGroup($customerId: ID!, $groupId: ID!) {
        addCustomersToGroup(customerIds: [$customerId], customerGroupId: $groupId) {
            id
        }
    }
`;

export const REMOVE_CUSTOMER_FROM_GROUP_MUTATION = gql`
    mutation AdminRemoveCustomerFromGroup($customerId: ID!, $groupId: ID!) {
        removeCustomersFromGroup(customerIds: [$customerId], customerGroupId: $groupId) {
            id
        }
    }
`;

export const CREATE_CUSTOMER_GROUP_MUTATION = gql`
    mutation AdminCreateCustomerGroup($name: String!) {
        createCustomerGroup(input: { name: $name }) {
            id
            name
        }
    }
`;

export const UPDATE_CUSTOMER_GROUP_MUTATION = gql`
    mutation AdminUpdateCustomerGroup($id: ID!, $name: String!) {
        updateCustomerGroup(input: { id: $id, name: $name }) {
            id
            name
        }
    }
`;

export const DELETE_CUSTOMER_GROUP_MUTATION = gql`
    mutation AdminDeleteCustomerGroup($id: ID!) {
        deleteCustomerGroup(id: $id) {
            result
            message
        }
    }
`;

export interface CustomerGroupRecord {
    id: string;
    name: string;
    customers: { totalItems: number };
}

export interface CustomerOrderRecord {
    id: string;
    code: string;
    state: string;
    orderPlacedAt: string | null;
    totalWithTax: number;
    currencyCode: string;
}

export interface CustomerListRecord {
    id: string;
    createdAt: string;
    updatedAt: string;
    firstName: string;
    lastName: string;
    emailAddress: string;
    phoneNumber: string | null;
    groups: Array<{ id: string; name: string }>;
    user: { id: string; verified: boolean; lastLogin: string | null } | null;
    orders: { totalItems: number; items: CustomerOrderRecord[] };
}

export interface CustomersResult {
    customers: { totalItems: number; items: CustomerListRecord[] };
}

export interface CustomerGroupMembersResult {
    customerGroup: {
        id: string;
        name: string;
        customers: { totalItems: number; items: CustomerListRecord[] };
    } | null;
}

export interface CustomerGroupsResult {
    customerGroups: { totalItems: number; items: CustomerGroupRecord[] };
}

export interface CustomerAddressRecord {
    id: string;
    fullName: string | null;
    company: string | null;
    streetLine1: string;
    streetLine2: string | null;
    city: string | null;
    province: string | null;
    postalCode: string | null;
    country: { id: string; code: string; name: string } | null;
    phoneNumber: string | null;
    defaultShippingAddress: boolean | null;
    defaultBillingAddress: boolean | null;
}

export interface CustomerAddressCountriesResult {
    countries: {
        items: Array<{ id: string; code: string; name: string }>;
    };
}

export interface CustomerHistoryRecord {
    id: string;
    type: string;
    createdAt: string;
    isPublic: boolean;
    administrator: { id: string; firstName: string; lastName: string } | null;
    data: Record<string, unknown> | null;
}

export interface CustomerDetailRecord extends Omit<CustomerListRecord, 'orders'> {
    title: string | null;
    addresses: CustomerAddressRecord[] | null;
    orders: { totalItems: number; items: CustomerOrderRecord[] };
    history: { totalItems: number; items: CustomerHistoryRecord[] };
    customFields?: Record<string, unknown> | null;
}

export interface CustomerDetailResult {
    customer: CustomerDetailRecord | null;
}
