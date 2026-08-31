import { gql } from '@apollo/client';

export const TEAM_MANAGEMENT_QUERY = gql`
    query NextAdminTeamManagement(
        $administratorOptions: AdministratorListOptions
        $roleOptions: RoleListOptions
        $channelOptions: ChannelListOptions
    ) {
        activeAdministrator {
            id
        }
        administrators(options: $administratorOptions) {
            totalItems
            items {
                id
                createdAt
                updatedAt
                firstName
                lastName
                emailAddress
                user {
                    id
                    identifier
                    lastLogin
                    roles {
                        id
                        code
                        description
                    }
                }
            }
        }
        roles(options: $roleOptions) {
            totalItems
            items {
                id
                createdAt
                updatedAt
                code
                description
                permissions
                channels {
                    id
                    code
                }
            }
        }
        channels(options: $channelOptions) {
            totalItems
            items {
                id
                code
            }
        }
        globalSettings {
            serverConfig {
                permissions {
                    name
                    description
                    assignable
                }
            }
        }
    }
`;

export const CREATE_ROLE_MUTATION = gql`
    mutation NextAdminCreateRole($input: CreateRoleInput!) {
        createRole(input: $input) {
            id
        }
    }
`;

export const UPDATE_ROLE_MUTATION = gql`
    mutation NextAdminUpdateRole($input: UpdateRoleInput!) {
        updateRole(input: $input) {
            id
        }
    }
`;

export const CREATE_ADMINISTRATOR_MUTATION = gql`
    mutation NextAdminCreateAdministrator($input: CreateAdministratorInput!) {
        createAdministrator(input: $input) {
            id
        }
    }
`;

export const UPDATE_ADMINISTRATOR_MUTATION = gql`
    mutation NextAdminUpdateAdministrator($input: UpdateAdministratorInput!) {
        updateAdministrator(input: $input) {
            id
        }
    }
`;

export const DELETE_ADMINISTRATOR_MUTATION = gql`
    mutation NextAdminDeleteAdministrator($id: ID!) {
        deleteAdministrator(id: $id) {
            result
            message
        }
    }
`;

const STORE_PROFILE_FIELDS = gql`
    fragment NextAdminStoreProfileFields on StoreProfile {
        id
        updatedAt
        status
        sortOrder
        descriptionZh
        descriptionEn
        internalNote
        primaryDomain
        storefrontUrl
        isOperational
        activationReadiness {
            ready
            checks {
                code
                ready
                message
                messageEn
            }
        }
        logoAsset {
            id
            preview
            source
        }
        channel {
            id
            code
            defaultCurrencyCode
            defaultLanguageCode
            seller {
                id
                name
            }
            customFields {
                storefrontNameZh
                storefrontNameEn
            }
        }
    }
`;

export const STORE_MANAGEMENT_QUERY = gql`
    ${STORE_PROFILE_FIELDS}
    query NextAdminStoreManagement(
        $sellerOptions: SellerListOptions
        $paymentMethodOptions: PaymentMethodListOptions
        $shippingMethodOptions: ShippingMethodListOptions
    ) {
        activeAdministrator {
            id
            user {
                roles {
                    id
                    code
                }
            }
        }
        storeProfiles {
            ...NextAdminStoreProfileFields
        }
        storeProvisioningTemplates {
            id
            code
            defaultLanguageCode
            defaultCurrencyCode
        }
        sellers(options: $sellerOptions) {
            totalItems
            items {
                id
                createdAt
                updatedAt
                name
            }
        }
        paymentMethods(options: $paymentMethodOptions) {
            totalItems
            items {
                id
                name
                description
                code
                enabled
                updatedAt
            }
        }
        shippingMethods(options: $shippingMethodOptions) {
            totalItems
            items {
                id
                name
                description
                code
                fulfillmentHandlerCode
                updatedAt
            }
        }
    }
`;

export const BUSINESS_SETTINGS_QUERY = gql`
    query NextAdminBusinessSettings(
        $zoneOptions: ZoneListOptions
        $countryOptions: CountryListOptions
        $taxCategoryOptions: TaxCategoryListOptions
        $taxRateOptions: TaxRateListOptions
    ) {
        activeChannel {
            id
            code
            defaultLanguageCode
            availableLanguageCodes
            defaultCurrencyCode
            availableCurrencyCodes
            pricesIncludeTax
            trackInventory
            outOfStockThreshold
            defaultTaxZone {
                id
                name
            }
            defaultShippingZone {
                id
                name
            }
        }
        zones(options: $zoneOptions) {
            totalItems
            items {
                id
                name
                members {
                    id
                    code
                    name
                    enabled
                }
            }
        }
        countries(options: $countryOptions) {
            totalItems
            items {
                id
                code
                name
                enabled
            }
        }
        taxCategories(options: $taxCategoryOptions) {
            totalItems
            items {
                id
                name
                isDefault
            }
        }
        taxRates(options: $taxRateOptions) {
            totalItems
            items {
                id
                name
                enabled
                value
                category {
                    id
                    name
                }
                zone {
                    id
                    name
                }
            }
        }
    }
`;

export const UPDATE_BUSINESS_CHANNEL_MUTATION = gql`
    mutation NextAdminUpdateBusinessChannel($input: UpdateChannelInput!) {
        updateChannel(input: $input) {
            ... on Channel {
                id
                code
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

export const CREATE_BUSINESS_ZONE_MUTATION = gql`
    mutation NextAdminCreateBusinessZone($input: CreateZoneInput!) {
        createZone(input: $input) {
            id
            name
        }
    }
`;

export const CREATE_BUSINESS_TAX_CATEGORY_MUTATION = gql`
    mutation NextAdminCreateBusinessTaxCategory($input: CreateTaxCategoryInput!) {
        createTaxCategory(input: $input) {
            id
            name
            isDefault
        }
    }
`;

export const CREATE_BUSINESS_TAX_RATE_MUTATION = gql`
    mutation NextAdminCreateBusinessTaxRate($input: CreateTaxRateInput!) {
        createTaxRate(input: $input) {
            id
            name
            enabled
            value
        }
    }
`;

export const UPDATE_BUSINESS_TAX_RATE_MUTATION = gql`
    mutation NextAdminUpdateBusinessTaxRate($input: UpdateTaxRateInput!) {
        updateTaxRate(input: $input) {
            id
            name
            enabled
            value
        }
    }
`;

export const PROVISION_STORE_MUTATION = gql`
    mutation NextAdminProvisionStore($input: ProvisionStoreInput!) {
        provisionStore(input: $input) {
            sellerId
            channelId
            roleId
            administratorId
            stockLocationId
            profileId
            channelCode
            temporaryPassword
        }
    }
`;

export const UPDATE_STORE_PROFILE_MUTATION = gql`
    ${STORE_PROFILE_FIELDS}
    mutation NextAdminUpdateStoreProfile($input: UpdateStoreProfileInput!) {
        updateStoreProfile(input: $input) {
            ...NextAdminStoreProfileFields
        }
    }
`;

export const CREATE_SELLER_MUTATION = gql`
    mutation NextAdminCreateSeller($input: CreateSellerInput!) {
        createSeller(input: $input) {
            id
        }
    }
`;

export const UPDATE_PAYMENT_METHOD_MUTATION = gql`
    mutation NextAdminTogglePaymentMethod($input: UpdatePaymentMethodInput!) {
        updatePaymentMethod(input: $input) {
            id
            enabled
        }
    }
`;

export const STORE_DOMAINS_QUERY = gql`
    query NextAdminStoreDomains($channelId: ID!) {
        storeDomains(channelId: $channelId) {
            id
            domain
            isPrimary
            status
            verificationRecordName
            verificationRecordValue
            verifiedAt
            lastVerificationError
        }
        storeDomainConfiguration {
            cnameTarget
            routingMode
        }
    }
`;

export const CREATE_STORE_DOMAIN_MUTATION = gql`
    mutation NextAdminCreateStoreDomain($input: CreateStoreDomainInput!) {
        createStoreDomain(input: $input) {
            id
        }
    }
`;

export const VERIFY_STORE_DOMAIN_MUTATION = gql`
    mutation NextAdminVerifyStoreDomain($id: ID!) {
        verifyStoreDomain(id: $id) {
            success
            message
            domain {
                id
                status
                verifiedAt
                lastVerificationError
            }
        }
    }
`;

export const SET_PRIMARY_STORE_DOMAIN_MUTATION = gql`
    mutation NextAdminSetPrimaryStoreDomain($id: ID!) {
        setPrimaryStoreDomain(id: $id) {
            id
            isPrimary
        }
    }
`;

export const DELETE_STORE_DOMAIN_MUTATION = gql`
    mutation NextAdminDeleteStoreDomain($id: ID!) {
        deleteStoreDomain(id: $id) {
            result
            message
        }
    }
`;

export const SYSTEM_OPERATIONS_QUERY = gql`
    query NextAdminSystemOperations($jobOptions: JobListOptions, $apiKeyOptions: ApiKeyListOptions) {
        jobs(options: $jobOptions) {
            totalItems
            items {
                id
                queueName
                createdAt
                startedAt
                settledAt
                state
                isSettled
                progress
                duration
                error
                retries
                attempts
            }
        }
        jobQueues {
            name
            running
        }
        scheduledTasks {
            id
            description
            schedule
            scheduleDescription
            lastExecutedAt
            nextExecutionAt
            isRunning
            lastResult
            enabled
        }
        settingsStoreFieldDefinitions {
            key
            scopeType
            readonly
            currentValue
        }
        apiKeys(options: $apiKeyOptions) {
            totalItems
            items {
                id
                createdAt
                updatedAt
                lookupId
                lastUsedAt
                name
                owner {
                    id
                    identifier
                }
            }
        }
        activeAdministrator {
            id
            user {
                id
                roles {
                    id
                    code
                    description
                }
            }
        }
    }
`;

export const CANCEL_JOB_MUTATION = gql`
    mutation NextAdminCancelJob($jobId: ID!) {
        cancelJob(jobId: $jobId) {
            id
            state
            isSettled
            error
        }
    }
`;

export const UPDATE_SCHEDULED_TASK_MUTATION = gql`
    mutation NextAdminUpdateScheduledTask($input: UpdateScheduledTaskInput!) {
        updateScheduledTask(input: $input) {
            id
            enabled
        }
    }
`;

export const RUN_SCHEDULED_TASK_MUTATION = gql`
    mutation NextAdminRunScheduledTask($id: String!) {
        runScheduledTask(id: $id) {
            success
        }
    }
`;

export const SET_SETTINGS_STORE_VALUE_MUTATION = gql`
    mutation NextAdminSetSettingsStoreValue($input: SettingsStoreInput!) {
        setSettingsStoreValue(input: $input) {
            key
            result
            error
        }
    }
`;

export const CREATE_API_KEY_MUTATION = gql`
    mutation NextAdminCreateApiKey($input: CreateApiKeyInput!) {
        createApiKey(input: $input) {
            apiKey
            entityId
        }
    }
`;

export const ROTATE_API_KEY_MUTATION = gql`
    mutation NextAdminRotateApiKey($id: ID!) {
        rotateApiKey(id: $id) {
            apiKey
        }
    }
`;

export const DELETE_API_KEYS_MUTATION = gql`
    mutation NextAdminDeleteApiKeys($ids: [ID!]!) {
        deleteApiKeys(ids: $ids) {
            result
            message
        }
    }
`;

export interface RoleRecord {
    id: string;
    createdAt: string;
    updatedAt: string;
    code: string;
    description: string;
    permissions: string[];
    channels: Array<{ id: string; code: string }>;
}

export interface AdministratorRecord {
    id: string;
    createdAt: string;
    updatedAt: string;
    firstName: string;
    lastName: string;
    emailAddress: string;
    user: {
        id: string;
        identifier: string;
        lastLogin: string | null;
        roles: Array<{ id: string; code: string; description: string }>;
    };
}

export interface TeamManagementResult {
    activeAdministrator: { id: string } | null;
    administrators: { totalItems: number; items: AdministratorRecord[] };
    roles: { totalItems: number; items: RoleRecord[] };
    channels: { totalItems: number; items: Array<{ id: string; code: string }> };
    globalSettings: {
        serverConfig: {
            permissions: Array<{ name: string; description: string; assignable: boolean }>;
        };
    };
}

export interface StoreProfileRecord {
    id: string;
    updatedAt: string;
    status: 'DRAFT' | 'ACTIVE' | 'SUSPENDED';
    sortOrder: number;
    descriptionZh: string;
    descriptionEn: string;
    internalNote: string | null;
    primaryDomain: string | null;
    storefrontUrl: string | null;
    isOperational: boolean;
    activationReadiness: {
        ready: boolean;
        checks: Array<{ code: string; ready: boolean; message: string; messageEn: string }>;
    };
    logoAsset: { id: string; preview: string; source: string } | null;
    channel: {
        id: string;
        code: string;
        defaultCurrencyCode: string;
        defaultLanguageCode: string;
        seller: { id: string; name: string } | null;
        customFields: { storefrontNameZh: string; storefrontNameEn: string };
    };
}

export interface StoreManagementResult {
    activeAdministrator: {
        id: string;
        user: { roles: Array<{ id: string; code: string }> };
    } | null;
    storeProfiles: StoreProfileRecord[];
    storeProvisioningTemplates: Array<{
        id: string;
        code: string;
        defaultLanguageCode: string;
        defaultCurrencyCode: string;
    }>;
    sellers: {
        totalItems: number;
        items: Array<{ id: string; createdAt: string; updatedAt: string; name: string }>;
    };
    paymentMethods: {
        totalItems: number;
        items: Array<{
            id: string;
            name: string;
            description: string;
            code: string;
            enabled: boolean;
            updatedAt: string;
        }>;
    };
    shippingMethods: {
        totalItems: number;
        items: Array<{
            id: string;
            name: string;
            description: string;
            code: string;
            fulfillmentHandlerCode: string;
            updatedAt: string;
        }>;
    };
}

export interface BusinessSettingsResult {
    activeChannel: {
        id: string;
        code: string;
        defaultLanguageCode: string;
        availableLanguageCodes: string[];
        defaultCurrencyCode: string;
        availableCurrencyCodes: string[];
        pricesIncludeTax: boolean;
        trackInventory: boolean | null;
        outOfStockThreshold: number | null;
        defaultTaxZone: { id: string; name: string } | null;
        defaultShippingZone: { id: string; name: string } | null;
    };
    zones: {
        totalItems: number;
        items: Array<{
            id: string;
            name: string;
            members: Array<{ id: string; code: string; name: string; enabled: boolean }>;
        }>;
    };
    countries: {
        totalItems: number;
        items: Array<{ id: string; code: string; name: string; enabled: boolean }>;
    };
    taxCategories: { totalItems: number; items: Array<{ id: string; name: string; isDefault: boolean }> };
    taxRates: {
        totalItems: number;
        items: Array<{
            id: string;
            name: string;
            enabled: boolean;
            value: number;
            category: { id: string; name: string };
            zone: { id: string; name: string };
        }>;
    };
}

export interface StoreDomainRecord {
    id: string;
    domain: string;
    isPrimary: boolean;
    status: 'PENDING' | 'ACTIVE';
    verificationRecordName: string;
    verificationRecordValue: string;
    verifiedAt: string | null;
    lastVerificationError: string | null;
}

export interface StoreDomainsResult {
    storeDomains: StoreDomainRecord[];
    storeDomainConfiguration: { cnameTarget: string; routingMode: string };
}

export interface SystemJobRecord {
    id: string;
    queueName: string;
    createdAt: string;
    startedAt: string | null;
    settledAt: string | null;
    state: string;
    isSettled: boolean;
    progress: number;
    duration: number;
    error: string | null;
    retries: number;
    attempts: number;
}

export interface ScheduledTaskRecord {
    id: string;
    description: string;
    schedule: string;
    scheduleDescription: string;
    lastExecutedAt: string | null;
    nextExecutionAt: string | null;
    isRunning: boolean;
    lastResult: unknown;
    enabled: boolean;
}

export interface SettingsStoreFieldRecord {
    key: string;
    scopeType: 'GLOBAL' | 'USER' | 'CHANNEL' | 'USER_AND_CHANNEL' | 'CUSTOM';
    readonly: boolean;
    currentValue: unknown;
}

export interface ApiKeyRecord {
    id: string;
    createdAt: string;
    updatedAt: string;
    lookupId: string;
    lastUsedAt: string | null;
    name: string;
    owner: { id: string; identifier: string } | null;
}

export interface SystemOperationsResult {
    jobs: { totalItems: number; items: SystemJobRecord[] };
    jobQueues: Array<{ name: string; running: boolean }>;
    scheduledTasks: ScheduledTaskRecord[];
    settingsStoreFieldDefinitions: SettingsStoreFieldRecord[];
    apiKeys: { totalItems: number; items: ApiKeyRecord[] };
    activeAdministrator: {
        id: string;
        user: { id: string; roles: Array<{ id: string; code: string; description: string }> };
    } | null;
}
