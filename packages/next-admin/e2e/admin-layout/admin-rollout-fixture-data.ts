import type {
    ImageGenerationConfigRecord,
    ImageGenerationJobRecord,
} from '../../src/graphql/plugins.graphql';

/** Local-only synthetic records for the 30-page rollout. No captured production data or network link. */
export function adminRolloutFixtureData(
    base: Record<string, unknown>,
    variables: Record<string, any>,
    empty: boolean,
): Record<string, unknown> {
    const now = '2026-10-07T08:00:00.000Z';
    const channel = base.activeChannel as Record<string, any>;
    const channelId = String(channel.id);
    const channelCode = String(channel.code);
    const currency = String(channel.defaultCurrencyCode ?? 'MYR');
    const list = <T>(items: T[]) => ({ items: empty ? [] : items, totalItems: empty ? 0 : items.length });
    const page = <T>(items: T[], skip = 0, take = 20) => ({
        items: empty ? [] : items.slice(skip, skip + take),
        totalItems: empty ? 0 : items.length,
    });
    const countries = [
        { id: 'rollout-country-my', code: 'MY', name: '马来西亚（测试）', enabled: true },
        { id: 'rollout-country-cn', code: 'CN', name: '中国（测试）', enabled: true },
    ];
    const zone = { id: 'rollout-zone', name: '本地验收业务区域', members: countries };
    const category = { id: 'rollout-tax-category', name: '本地验收标准税类', isDefault: true };
    const seller = { id: 'rollout-seller', name: '本地验收商家主体', createdAt: now, updatedAt: now };
    const config: ImageGenerationConfigRecord = {
        id: 'rollout-image-config',
        enabled: true,
        promptOptimizationEnabled: true,
        promptRateLimitPerMinute: 3,
        promptDailyFreeLimit: 20,
        promptDailyFreeUnlimited: false,
        paidPromptOptimizationEnabled: true,
        paidPromptOptimizationPrice: 10,
        paidPromptOptimizationCurrencyCode: currency,
        defaultModelCode: 'FIXTURE_IMAGE_1',
        termsVersion: 'LOCAL-TEST-20261007',
        termsZh: '本地测试条款。这些数据仅用于页面布局与交互验收，没有生成图片或产生收费。',
        termsEn: 'Local test terms. This fixture does not generate images or charge users.',
        credentialEnabled: false,
        activeSkillHash: 'ab'.repeat(32),
        models: empty
            ? []
            : Array.from({ length: 4 }, (_, index) => ({
                  id: `rollout-model-${index + 1}`,
                  code: `FIXTURE_IMAGE_${index + 1}`,
                  enabled: index !== 3,
                  displayNameZh: `本地验收图片模型 ${index + 1}`,
                  displayNameEn: `Fixture image model ${index + 1}`,
                  descriptionZh: '纯本地合成模型记录',
                  descriptionEn: 'Synthetic local model',
                  officialModelId: `fixture-image-${index + 1}`,
                  providerModelId: `fixture-provider-${index + 1}`,
                  protocol: index % 2 ? 'OPENAI_IMAGES' : 'GEMINI_NATIVE_STREAM',
                  unitPrice: 30,
                  unitPrice2K: 60,
                  unitPrice4K: 120,
                  currencyCode: currency,
                  position: index,
                  isDefault: index === 0,
                  healthStatus: index === 3 ? 'UNTESTED' : 'HEALTHY',
                  healthMessage: null,
                  lastTestedAt: now,
                  supportsIdempotency: true,
                  freeImageEnabled: true,
                  dailyFreeImageLimit: 2,
                  dailyFreeImageUnlimited: false,
                  paidAfterFreeEnabled: true,
                  dailyGenerationSafetyLimit: 20,
              })),
    };
    const jobs: ImageGenerationJobRecord[] = Array.from({ length: 23 }, (_, index) => {
        const state = index % 6 === 0 ? 'FAILED' : index === 2 ? 'UNKNOWN' : 'SUCCEEDED';
        const errorMessage = state === 'FAILED' ? '本地测试：输出尺寸不符合所选规格，展示失败状态' : null;
        return {
            id: `rollout-image-job-${index + 1}`,
            createdAt: now,
            updatedAt: now,
            state,
            modelCodeSnapshot: 'FIXTURE_IMAGE_1',
            modelNameSnapshot: '本地验收图片模型 1',
            officialModelIdSnapshot: 'fixture-image-1',
            quantity: 1,
            unitPriceSnapshot: 30,
            reservedAmount: state === 'UNKNOWN' ? 30 : 0,
            capturedAmount: state === 'SUCCEEDED' ? 30 : 0,
            releasedAmount: state === 'FAILED' ? 30 : 0,
            currencyCode: currency,
            termsVersion: config.termsVersion,
            errorMessage,
            completedAt: state === 'UNKNOWN' ? null : now,
            outputs: [
                {
                    id: `rollout-output-${index + 1}`,
                    outputIndex: 0,
                    state,
                    attemptCount: 1,
                    errorMessage,
                    completedAt: state === 'UNKNOWN' ? null : now,
                    refundedAt: null,
                    billingMode: index % 2 ? 'PAID' : 'FREE',
                    chargeAmount: index % 2 ? 30 : 0,
                },
            ],
        };
    });
    const selectedJobs = variables.state ? jobs.filter(job => job.state === variables.state) : jobs;
    const paymentOptions = [
        {
            id: 'rollout-payment-1',
            name: '本地验收支付方式',
            code: 'fixture-payment',
            enabled: true,
            platformEnabled: true,
            effectiveEnabled: true,
        },
        {
            id: 'rollout-payment-2',
            name: '本地验收停用方式',
            code: 'fixture-disabled',
            enabled: false,
            platformEnabled: true,
            effectiveEnabled: false,
        },
    ];
    const profile = {
        __typename: 'StoreProfile',
        id: 'rollout-profile',
        updatedAt: now,
        status: 'ACTIVE',
        isPublished: true,
        sortOrder: 0,
        descriptionZh: '本地合成店铺资料，仅用于排版验收',
        descriptionEn: 'Synthetic profile for local layout acceptance',
        taglineZh: '本地测试',
        taglineEn: 'Local test',
        brandBackgroundColor: null,
        brandPrimaryColor: null,
        brandAccentColor: null,
        brandHighlightColor: null,
        legalEntityName: seller.name,
        legalRegistrationCountry: 'MY',
        legalRegistrationNumber: 'FIXTURE-REGISTRATION',
        legalContactAddress: '本地测试地址（非真实地址）',
        supportEmail: 'support@example.invalid',
        privacyEmail: 'privacy@example.invalid',
        internalNote: null,
        primaryDomain: 'rollout-store.example.invalid',
        storefrontUrl: 'https://rollout-store.example.invalid',
        isOperational: true,
        activationReadiness: { ready: true, checks: [] },
        logoAsset: null,
        logoOnLightAsset: null,
        logoOnDarkAsset: null,
        channel: { ...channel, seller },
    };
    const intents = [
        {
            id: 'rollout-intent',
            channelId,
            channelCode,
            orderId: 'rollout-order',
            orderCode: 'LOCAL-TEST-001',
            network: 'TRC20',
            fiatCurrencyCode: currency,
            fiatAmount: 3000,
            fiatPerUsdtRate: 4.4,
            markupPercent: 0.5,
            rateSource: 'SYNTHETIC',
            receivingAddressMasked: '测试地址（不可使用）',
            receivingAddressFingerprint: 'local-fixture-only',
            baseUsdtAmount: 6.81,
            expectedUsdtAmount: 6.85,
            receivedUsdtAmount: null,
            senderAddressMasked: null,
            status: 'PENDING',
            transactionId: null,
            failureReason: null,
            createdAt: now,
            expiresAt: '2026-10-07T09:00:00.000Z',
            settledAt: null,
            blockNumber: null,
            blockTimestamp: null,
            lastCheckedAt: now,
            manualReviewCode: null,
            resolvedAt: null,
            resolvedByUserId: null,
            resolutionActionId: null,
        },
    ];
    const refunds = [
        {
            id: 'rollout-refund',
            channelId,
            channelCode,
            paymentId: 'payment-demo',
            orderId: 'order-demo',
            orderCode: 'LOCAL-TEST-001',
            currencyCode: currency,
            amount: 1000,
            usdtAmount: 2.2,
            network: 'TRC20',
            transactionId: 'LOCAL-FIXTURE-NOT-A-TRANSACTION',
            fromAddress: null,
            toAddress: '测试地址（不可使用）',
            blockNumber: null,
            blockTimestamp: null,
            reason: '本地合成退款审计记录',
            operatorUserId: 'tabs-admin',
            state: 'Settled',
            createdAt: now,
        },
    ];
    const ledger = Array.from({ length: 3 }, (_, index) => ({
        id: `rollout-ledger-${index}`,
        createdAt: now,
        eventType: index ? 'REWARD_RELEASED' : 'REWARD_EARNED',
        customerName: `本地测试客户 ${index + 1}`,
        customerEmail: `customer-${index}@example.invalid`,
        currencyCode: currency,
        availableDelta: index ? 1000 : 0,
        pendingDelta: index ? -1000 : 1000,
        reservedDelta: 0,
        availableAfter: 3000,
        pendingAfter: 1000,
        reservedAfter: 0,
        orderId: 'rollout-order',
        refundId: null,
        withdrawalId: null,
        actorType: 'SYSTEM',
        note: '本地测试记录',
    }));
    const withdrawals = ['PENDING', 'APPROVED', 'PAID'].map((status, index) => ({
        id: `rollout-withdrawal-${index}`,
        createdAt: now,
        updatedAt: now,
        code: `LOCAL-WD-${index + 1}`,
        customerId: `rollout-customer-${index}`,
        customerName: `本地测试客户 ${index + 1}`,
        customerEmail: `customer-${index}@example.invalid`,
        currencyCode: currency,
        amount: 3000,
        status,
        payoutMethod: 'BANK_TRANSFER',
        payoutAccountMasked: '测试账户 **** 0000',
        externalReference: null,
        note: '本地测试提现；不会执行资金操作',
        approvedAt: index ? now : null,
        paidAt: index === 2 ? now : null,
        rejectedAt: null,
        cancelledAt: null,
    }));
    const result: Record<string, unknown> = {
        ...base,
        activeChannel: {
            ...channel,
            pricesIncludeTax: false,
            trackInventory: true,
            outOfStockThreshold: 2,
            defaultTaxZone: zone,
            defaultShippingZone: zone,
        },
        channels: { items: [{ ...channel, defaultTaxZone: zone, defaultShippingZone: zone }], totalItems: 1 },
        // Deliberately invalid public test placeholders: the real generator produces no usable OTP.
        dashboardTwoFactorAccounts: empty
            ? []
            : [1, 2].map(index => ({
                  id: `rollout-two-factor-${index}`,
                  createdAt: now,
                  updatedAt: now,
                  projectName: `本地测试账号 ${index}`,
                  secret: 'INVALID_FIXTURE_SECRET',
                  lastUsedAt: index === 1 ? now : null,
              })),
        systemAnnouncements: empty
            ? []
            : [1, 2].map(index => ({
                  id: `rollout-announcement-${index}`,
                  createdAt: now,
                  updatedAt: now,
                  enabled: index === 1,
                  priority: index,
                  titleZh: `本地测试公告 ${index}`,
                  titleEn: `Local fixture announcement ${index}`,
                  titleEnLocked: false,
                  contentZh: '本地合成公告正文，用于验证字段分列与长内容完整查看。',
                  contentEn: 'Synthetic announcement content for layout checks only.',
                  contentEnLocked: false,
                  linkUrl: null,
                  startsAt: now,
                  endsAt: null,
                  targetMode: index === 1 ? 'ALL' : 'SINGLE',
                  channels: [channel],
              })),
        imageGenerationAdminConfig: config,
        imageGenerationJobs: page(selectedJobs, Number(variables.skip ?? 0), Number(variables.take ?? 20)),
        imagePromptSkillReleases: empty
            ? []
            : ['ab', 'cd', 'ef'].map((part, index) => ({
                  id: `rollout-skill-${index}`,
                  createdAt: now,
                  updatedAt: now,
                  bundleVersion: index + 1,
                  sourceHash: part.repeat(32),
                  status: index === 0 ? 'ACTIVE' : 'INACTIVE',
                  activatedAt: index ? null : now,
              })),
        myStoreProfile: profile,
        storeProfiles: [profile],
        myStoreCommerceConfiguration: {
            ...(base.myStoreCommerceConfiguration as Record<string, unknown>),
            channelId,
            channelCode,
        },
        myStoreCurrencyConfiguration: {
            ...(base.myStoreCurrencyConfiguration as Record<string, unknown>),
            defaultCurrencyCode: currency,
        },
        myStorePaymentOptions: empty ? [] : paymentOptions,
        myStoreGovernanceChanges: empty
            ? []
            : [
                  {
                      id: 'rollout-payout-review',
                      requestType: 'PAYOUT_ACCOUNT',
                      status: 'APPROVED',
                      maskedSummary: {
                          provider: '本地测试银行',
                          accountHolder: '本地测试主体',
                          accountIdentifier: '**** 0000',
                      },
                      reviewReason: null,
                      submittedAt: now,
                  },
              ],
        paymentMethods: list(
            paymentOptions.map(item => ({
                ...item,
                updatedAt: now,
                description: '本地测试方式',
                translations: [
                    {
                        id: `${item.id}-zh`,
                        languageCode: 'zh_Hans',
                        name: item.name,
                        description: '本地测试方式',
                    },
                ],
                checker: null,
                handler: { code: 'fixture-handler', args: [] },
            })),
        ),
        shippingMethods: list([
            {
                id: 'rollout-shipping',
                code: 'fixture-shipping',
                name: '本地测试配送',
                description: '仅用于布局验证',
                updatedAt: now,
                fulfillmentHandlerCode: 'manual-fulfillment',
                translations: [
                    {
                        id: 'rollout-shipping-zh',
                        languageCode: 'zh_Hans',
                        name: '本地测试配送',
                        description: '仅用于布局验证',
                    },
                ],
                checker: { code: 'default-shipping-eligibility-checker', args: [] },
                calculator: { code: 'default-shipping-calculator', args: [] },
            },
        ]),
        sellers: list([seller]),
        countries: list(countries),
        zones: list([zone]),
        taxCategories: list([category]),
        taxRates: list([
            { id: 'rollout-tax-rate', name: '本地验收零税率', enabled: true, value: 0, category, zone },
        ]),
        referralLedger: page(ledger, Number(variables.ledgerSkip ?? 0), Number(variables.take ?? 20)),
        referralWithdrawals: page(
            withdrawals,
            Number(variables.withdrawalSkip ?? 0),
            Number(variables.take ?? 20),
        ),
        referralBalanceAudit: { auditedWallets: 0, items: [] },
        myStoreUsdtPaymentIntents: empty ? [] : intents,
        storeUsdtPaymentIntents: empty ? [] : intents,
        myStoreUsdtManualRefunds: list(refunds),
        storeUsdtManualRefunds: list(refunds),
        myStorePaymentDetails: empty ? { items: [], totalItems: 0 } : base.myStorePaymentDetails,
        storePaymentDetails: empty ? { items: [], totalItems: 0 } : base.storePaymentDetails,
        manageableAdministrators: empty ? [] : base.manageableAdministrators,
        manageableRoles: empty ? [] : base.manageableRoles,
        roles: list([]),
        scheduledTasks: empty
            ? []
            : [1, 2].map(index => ({
                  id: `rollout-schedule-${index}`,
                  description: `本地测试定时任务 ${index}`,
                  schedule: '0 */15 * * * *',
                  scheduleDescription: '每十五分钟（本地测试）',
                  lastExecutedAt: now,
                  nextExecutionAt: '2026-10-07T08:15:00.000Z',
                  isRunning: false,
                  lastResult: { localTest: true, processed: 3 },
                  enabled: index === 1,
              })),
        apiKeys: list(
            [1, 2].map(index => ({
                id: `rollout-api-key-${index}`,
                createdAt: now,
                updatedAt: now,
                lookupId: `LOCAL-FIXTURE-${index}`,
                lastUsedAt: index === 1 ? now : null,
                name: `本地测试接口密钥 ${index}`,
                owner: { id: 'tabs-admin', identifier: 'local@example.invalid' },
                user: {
                    id: 'tabs-admin',
                    roles: [{ id: 'local-role', code: 'fixture-role', description: '本地测试角色' }],
                },
                translations: [
                    {
                        id: `rollout-api-key-${index}-zh`,
                        languageCode: 'zh_Hans',
                        name: `本地测试接口密钥 ${index}`,
                    },
                ],
            })),
        ),
        settingsStoreFieldDefinitions: [
            {
                key: 'systemOperations.workerHeartbeat',
                scopeType: 'GLOBAL',
                readonly: true,
                currentValue: {
                    state: 'RUNNING',
                    heartbeatAt: new Date().toISOString(),
                    queues: base.jobQueues,
                },
            },
            { key: 'storefrontAuth.emailEnabled', scopeType: 'CHANNEL', readonly: false, currentValue: true },
            {
                key: 'storefrontAccount.recommendations',
                scopeType: 'CHANNEL',
                readonly: false,
                currentValue: { enabled: true, titleZh: '本地测试推荐', count: 4 },
            },
            {
                key: 'contentTranslationCache.result',
                scopeType: 'GLOBAL',
                readonly: true,
                currentValue: { localTest: true, status: 'COMPLETED' },
            },
        ],
        telegramNotificationDeliveries: list([
            {
                id: 'rollout-notification',
                createdAt: now,
                eventType: 'ORDER_CREATED',
                category: 'ORDER',
                ownerDepartmentCode: 'CUSTOMER_SERVICE',
                collaboratorDepartmentCodes: [],
                escalationDepartmentCode: null,
                actionRequired: false,
                slaDueAt: null,
                severity: 'P2',
                eventState: 'OPEN',
                title: '本地测试消息记录',
                occurrenceCount: 1,
                deliveryStatus: 'SENT',
                attempts: 1,
                maxAttempts: 3,
                telegramMessageId: null,
                lastErrorCode: null,
                lastError: null,
                sentAt: now,
            },
        ]),
    };
    if (empty) {
        result.jobs = { items: [], totalItems: 0 };
        result.jobQueues = [];
        result.settingsStoreFieldDefinitions = [];
        result.orders = { items: [], totalItems: 0 };
        result.dashboardMetricSummary = [];
        result.physicalFulfillmentTodoCount = 0;
        result.autoCardTodoSummary = {
            lowStockSkuCount: 0,
            waitingStockDeliveryCount: 0,
            manualReviewCount: 0,
        };
        result.afterSalesRequests = { items: [], totalItems: 0 };
        result.storefrontReviews = { items: [], totalItems: 0, averageRating: 0 };
    }
    return result;
}
