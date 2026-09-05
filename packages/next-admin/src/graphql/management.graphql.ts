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

export const DELETE_ROLE_MUTATION = gql`
    mutation NextAdminDeleteRole($id: ID!) {
        deleteRole(id: $id) {
            result
            message
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
        taglineZh
        taglineEn
        brandBackgroundColor
        brandPrimaryColor
        brandAccentColor
        brandHighlightColor
        legalEntityName
        legalRegistrationCountry
        supportEmail
        privacyEmail
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
        logoOnLightAsset {
            id
            preview
            source
        }
        logoOnDarkAsset {
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
    fragment NextAdminSellerManagementFields on Seller {
        id
        createdAt
        updatedAt
        name
    }
    fragment NextAdminPaymentMethodManagementFields on PaymentMethod {
        id
        name
        description
        code
        enabled
        updatedAt
        translations {
            id
            languageCode
            name
            description
        }
        checker {
            code
            args {
                name
                value
            }
        }
        handler {
            code
            args {
                name
                value
            }
        }
    }
    fragment NextAdminShippingMethodManagementFields on ShippingMethod {
        id
        name
        description
        code
        fulfillmentHandlerCode
        updatedAt
        translations {
            id
            languageCode
            name
            description
        }
        checker {
            code
            args {
                name
                value
            }
        }
        calculator {
            code
            args {
                name
                value
            }
        }
    }
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
        activeChannel {
            id
            defaultLanguageCode
            defaultCurrencyCode
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
                ...NextAdminSellerManagementFields
            }
        }
        paymentMethods(options: $paymentMethodOptions) {
            totalItems
            items {
                ...NextAdminPaymentMethodManagementFields
            }
        }
        shippingMethods(options: $shippingMethodOptions) {
            totalItems
            items {
                ...NextAdminShippingMethodManagementFields
            }
        }
        paymentMethodEligibilityCheckers {
            code
            description
            args {
                name
                type
                required
                defaultValue
                label
                description
            }
        }
        paymentMethodHandlers {
            code
            description
            args {
                name
                type
                required
                defaultValue
                label
                description
            }
        }
        shippingEligibilityCheckers {
            code
            description
            args {
                name
                type
                required
                defaultValue
                label
                description
            }
        }
        shippingCalculators {
            code
            description
            args {
                name
                type
                required
                defaultValue
                label
                description
            }
        }
        fulfillmentHandlers {
            code
            description
            args {
                name
                type
                required
                defaultValue
                label
                description
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
        globalSettings {
            availableLanguages
            trackInventory
            outOfStockThreshold
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

export const STORE_DEPROVISION_IMPACT_QUERY = gql`
    query NextAdminStoreDeprovisionImpact($profileId: ID!) {
        storeDeprovisionImpact(profileId: $profileId) {
            profileId
            channelId
            channelCode
            status
            isDefaultChannel
            isProvisioningTemplate
            isActiveChannel
            orderCount
            productCount
            customerCount
            administratorCount
            domainCount
            extensionRecordCount
            sellerWillBeDeleted
            roleWillBeDeleted
            blockers
            canDeprovision
        }
    }
`;

export const SUSPEND_STORE_MUTATION = gql`
    mutation NextAdminSuspendStore(
        $profileId: ID!
        $expectedUpdatedAt: DateTime!
        $currentPassword: String!
    ) {
        suspendStore(
            profileId: $profileId
            expectedUpdatedAt: $expectedUpdatedAt
            currentPassword: $currentPassword
        ) {
            id
            updatedAt
            status
        }
    }
`;

export const DEPROVISION_STORE_MUTATION = gql`
    mutation NextAdminDeprovisionStore($input: DeprovisionStoreInput!) {
        deprovisionStore(input: $input) {
            channelId
            channelCode
            deletedAdministratorCount
            deletedRole
            deletedSeller
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

export const UPDATE_SELLER_MUTATION = gql`
    mutation NextAdminUpdateSeller($input: UpdateSellerInput!) {
        updateSeller(input: $input) {
            id
            name
        }
    }
`;

export const DELETE_SELLER_MUTATION = gql`
    mutation NextAdminDeleteSeller($id: ID!) {
        deleteSeller(id: $id) {
            result
            message
        }
    }
`;

export const CREATE_PAYMENT_METHOD_MUTATION = gql`
    mutation NextAdminCreatePaymentMethod($input: CreatePaymentMethodInput!) {
        createPaymentMethod(input: $input) {
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

export const DELETE_PAYMENT_METHOD_MUTATION = gql`
    mutation NextAdminDeletePaymentMethod($id: ID!, $force: Boolean) {
        deletePaymentMethod(id: $id, force: $force) {
            result
            message
        }
    }
`;

export const CREATE_SHIPPING_METHOD_MUTATION = gql`
    mutation NextAdminCreateShippingMethod($input: CreateShippingMethodInput!) {
        createShippingMethod(input: $input) {
            id
        }
    }
`;

export const UPDATE_SHIPPING_METHOD_MUTATION = gql`
    mutation NextAdminUpdateShippingMethod($input: UpdateShippingMethodInput!) {
        updateShippingMethod(input: $input) {
            id
        }
    }
`;

export const DELETE_SHIPPING_METHOD_MUTATION = gql`
    mutation NextAdminDeleteShippingMethod($id: ID!) {
        deleteShippingMethod(id: $id) {
            result
            message
        }
    }
`;

export const UPDATE_BUSINESS_TAX_CATEGORY_MUTATION = gql`
    mutation NextAdminUpdateBusinessTaxCategory($input: UpdateTaxCategoryInput!) {
        updateTaxCategory(input: $input) {
            id
            name
            isDefault
        }
    }
`;

export const DELETE_BUSINESS_TAX_CATEGORY_MUTATION = gql`
    mutation NextAdminDeleteBusinessTaxCategory($id: ID!) {
        deleteTaxCategory(id: $id) {
            result
            message
        }
    }
`;

export const DELETE_BUSINESS_TAX_RATE_MUTATION = gql`
    mutation NextAdminDeleteBusinessTaxRate($id: ID!) {
        deleteTaxRate(id: $id) {
            result
            message
        }
    }
`;

export const UPDATE_BUSINESS_ZONE_MUTATION = gql`
    mutation NextAdminUpdateBusinessZone($input: UpdateZoneInput!) {
        updateZone(input: $input) {
            id
            name
        }
    }
`;

export const DELETE_BUSINESS_ZONE_MUTATION = gql`
    mutation NextAdminDeleteBusinessZone($id: ID!) {
        deleteZone(id: $id) {
            result
            message
        }
    }
`;

export const ADD_BUSINESS_ZONE_MEMBERS_MUTATION = gql`
    mutation NextAdminAddBusinessZoneMembers($zoneId: ID!, $memberIds: [ID!]!) {
        addMembersToZone(zoneId: $zoneId, memberIds: $memberIds) {
            id
        }
    }
`;

export const REMOVE_BUSINESS_ZONE_MEMBERS_MUTATION = gql`
    mutation NextAdminRemoveBusinessZoneMembers($zoneId: ID!, $memberIds: [ID!]!) {
        removeMembersFromZone(zoneId: $zoneId, memberIds: $memberIds) {
            id
        }
    }
`;

export const CREATE_BUSINESS_COUNTRY_MUTATION = gql`
    mutation NextAdminCreateBusinessCountry($input: CreateCountryInput!) {
        createCountry(input: $input) {
            id
            code
            name
            enabled
        }
    }
`;

export const UPDATE_BUSINESS_COUNTRY_MUTATION = gql`
    mutation NextAdminUpdateBusinessCountry($input: UpdateCountryInput!) {
        updateCountry(input: $input) {
            id
            code
            name
            enabled
        }
    }
`;

export const DELETE_BUSINESS_COUNTRY_MUTATION = gql`
    mutation NextAdminDeleteBusinessCountry($id: ID!) {
        deleteCountry(id: $id) {
            result
            message
        }
    }
`;

export const UPDATE_GLOBAL_SETTINGS_MUTATION = gql`
    mutation NextAdminUpdateGlobalSettings($input: UpdateGlobalSettingsInput!) {
        updateGlobalSettings(input: $input) {
            ... on GlobalSettings {
                id
                availableLanguages
                trackInventory
                outOfStockThreshold
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

export const STORE_DOMAINS_QUERY = gql`
    query NextAdminStoreDomains($channelId: ID!) {
        storeDomains(channelId: $channelId) {
            id
            updatedAt
            domain
            channel {
                id
                code
            }
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

export const STORE_DOMAIN_TRANSFER_IMPACT_QUERY = gql`
    query NextAdminStoreDomainTransferImpact($id: ID!, $targetChannelId: ID!) {
        storeDomainTransferImpact(id: $id, targetChannelId: $targetChannelId) {
            sourceReplacementDomain
            targetPrimaryDomain
            preservesVerification
            canTransfer
            blocker
            sourceChannel {
                id
                code
            }
            targetChannel {
                id
                code
            }
        }
    }
`;

export const TRANSFER_STORE_DOMAIN_MUTATION = gql`
    mutation NextAdminTransferStoreDomain($input: TransferStoreDomainInput!) {
        transferStoreDomain(input: $input) {
            id
            updatedAt
            domain
            isPrimary
            status
            channel {
                id
                code
            }
        }
    }
`;

const API_KEY_FIELDS = gql`
    fragment NextAdminApiKeyFields on ApiKey {
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
        user {
            id
            roles {
                id
                code
                description
            }
        }
        translations {
            id
            languageCode
            name
        }
    }
`;

export const SYSTEM_OPERATIONS_QUERY = gql`
    ${API_KEY_FIELDS}
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
                ...NextAdminApiKeyFields
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

export const UPDATE_API_KEY_MUTATION = gql`
    ${API_KEY_FIELDS}
    mutation NextAdminUpdateApiKey($input: UpdateApiKeyInput!) {
        updateApiKey(input: $input) {
            ...NextAdminApiKeyFields
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

export const TEST_SHIPPING_METHOD_QUERY = gql`
    query NextAdminTestShippingMethod($input: TestShippingMethodInput!) {
        testShippingMethod(input: $input) {
            eligible
            quote {
                price
                priceWithTax
                metadata
            }
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
    taglineZh: string | null;
    taglineEn: string | null;
    brandBackgroundColor: string | null;
    brandPrimaryColor: string | null;
    brandAccentColor: string | null;
    brandHighlightColor: string | null;
    legalEntityName: string | null;
    legalRegistrationCountry: string | null;
    supportEmail: string | null;
    privacyEmail: string | null;
    internalNote: string | null;
    primaryDomain: string | null;
    storefrontUrl: string | null;
    isOperational: boolean;
    activationReadiness: {
        ready: boolean;
        checks: Array<{ code: string; ready: boolean; message: string; messageEn: string }>;
    };
    logoAsset: { id: string; preview: string; source: string } | null;
    logoOnLightAsset: { id: string; preview: string; source: string } | null;
    logoOnDarkAsset: { id: string; preview: string; source: string } | null;
    channel: {
        id: string;
        code: string;
        defaultCurrencyCode: string;
        defaultLanguageCode: string;
        seller: { id: string; name: string } | null;
        customFields: { storefrontNameZh: string; storefrontNameEn: string };
    };
}

export interface ConfigurableOperationDefinitionRecord {
    code: string;
    description: string;
    args: Array<{
        name: string;
        type: string;
        required: boolean;
        defaultValue: unknown;
        label: string | null;
        description: string | null;
    }>;
}

export interface ConfigurableOperationRecord {
    code: string;
    args: Array<{ name: string; value: string }>;
}

export interface ManagementTranslationRecord {
    id: string;
    languageCode: string;
    name: string;
    description: string;
    customFields?: Record<string, unknown> | null;
}

export interface StoreManagementResult {
    activeAdministrator: {
        id: string;
        user: { roles: Array<{ id: string; code: string }> };
    } | null;
    activeChannel: { id: string; defaultLanguageCode: string; defaultCurrencyCode: string };
    storeProfiles: StoreProfileRecord[];
    storeProvisioningTemplates: Array<{
        id: string;
        code: string;
        defaultLanguageCode: string;
        defaultCurrencyCode: string;
    }>;
    sellers: {
        totalItems: number;
        items: Array<{
            id: string;
            createdAt: string;
            updatedAt: string;
            name: string;
            customFields?: Record<string, unknown> | null;
        }>;
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
            translations: ManagementTranslationRecord[];
            checker: ConfigurableOperationRecord | null;
            handler: ConfigurableOperationRecord;
            customFields?: Record<string, unknown> | null;
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
            translations: ManagementTranslationRecord[];
            checker: ConfigurableOperationRecord;
            calculator: ConfigurableOperationRecord;
            customFields?: Record<string, unknown> | null;
        }>;
    };
    paymentMethodEligibilityCheckers: ConfigurableOperationDefinitionRecord[];
    paymentMethodHandlers: ConfigurableOperationDefinitionRecord[];
    shippingEligibilityCheckers: ConfigurableOperationDefinitionRecord[];
    shippingCalculators: ConfigurableOperationDefinitionRecord[];
    fulfillmentHandlers: ConfigurableOperationDefinitionRecord[];
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
        customFields?: Record<string, unknown> | null;
        defaultTaxZone: { id: string; name: string } | null;
        defaultShippingZone: { id: string; name: string } | null;
    };
    globalSettings: {
        availableLanguages: string[];
        trackInventory: boolean;
        outOfStockThreshold: number;
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
    updatedAt: string;
    domain: string;
    channel: { id: string; code: string };
    isPrimary: boolean;
    status: 'PENDING' | 'ACTIVE';
    verificationRecordName: string;
    verificationRecordValue: string;
    verifiedAt: string | null;
    lastVerificationError: string | null;
}

export interface StoreDomainTransferImpactRecord {
    sourceReplacementDomain: string | null;
    targetPrimaryDomain: string | null;
    preservesVerification: boolean;
    canTransfer: boolean;
    blocker: string | null;
    sourceChannel: { id: string; code: string };
    targetChannel: { id: string; code: string };
}

export interface StoreDeprovisionImpactRecord {
    profileId: string;
    channelId: string;
    channelCode: string;
    status: 'DRAFT' | 'ACTIVE' | 'SUSPENDED';
    isDefaultChannel: boolean;
    isProvisioningTemplate: boolean;
    isActiveChannel: boolean;
    orderCount: number;
    productCount: number;
    customerCount: number;
    administratorCount: number;
    domainCount: number;
    extensionRecordCount: number;
    sellerWillBeDeleted: boolean;
    roleWillBeDeleted: boolean;
    blockers: string[];
    canDeprovision: boolean;
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
    user: {
        id: string;
        roles: Array<{ id: string; code: string; description: string }>;
    };
    translations: Array<{
        id: string;
        languageCode: string;
        name: string;
        customFields?: Record<string, unknown> | null;
    }>;
    customFields?: Record<string, unknown> | null;
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
