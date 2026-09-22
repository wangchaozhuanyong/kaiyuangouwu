import { gql } from 'graphql-tag';

export const customerGovernanceApiSchema = gql`
    enum CustomerOperationsSegment {
        NEW
        LEAD
        ACTIVE
        LOYAL
        VIP
        AT_RISK
        DORMANT
    }

    enum CustomerChurnRisk {
        NONE
        LOW
        MEDIUM
        HIGH
    }

    enum CustomerFollowUpStatus {
        OPEN
        COMPLETED
        DISMISSED
    }

    enum CustomerFollowUpPriority {
        P1
        P2
        P3
    }

    enum CustomerFollowUpOutcome {
        CONTACTED
        RESOLVED
        NO_RESPONSE
        DO_NOT_CONTACT
        NOT_NEEDED
    }

    enum CustomerFollowUpAction {
        RESCHEDULE
        COMPLETE
        DISMISS
    }

    type CustomerCurrencyMetric {
        currencyCode: CurrencyCode!
        orderCount: Int!
        grossRevenue: Money!
        refundTotal: Money!
        netLifetimeValue: Money!
        averageOrderValue: Money!
    }

    type CustomerOperationsProfile implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        customer: Customer!
        segment: CustomerOperationsSegment!
        churnRisk: CustomerChurnRisk!
        recencyScore: Int!
        frequencyScore: Int!
        monetaryScore: Int!
        recencyDays: Int
        orderCount: Int!
        currencyCode: CurrencyCode!
        grossRevenue: Money!
        refundTotal: Money!
        netLifetimeValue: Money!
        averageOrderValue: Money!
        currencyMetrics: [CustomerCurrencyMetric!]!
        serviceInteractionCount: Int!
        afterSalesCount: Int!
        openAfterSalesCount: Int!
        lastOrderAt: DateTime
        lastServiceAt: DateTime
        nextFollowUpAt: DateTime
        doNotContact: Boolean!
        reasons: [String!]!
        evaluationVersion: String!
        lastEvaluatedAt: DateTime!
    }

    type CustomerOperationsProfileList implements PaginatedList {
        items: [CustomerOperationsProfile!]!
        totalItems: Int!
    }

    type CustomerFollowUpEvent implements Node {
        id: ID!
        createdAt: DateTime!
        eventType: String!
        actorType: String!
        actorLabel: String!
        note: String!
        payloadJson: String
    }

    type CustomerFollowUp implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        customer: Customer!
        profile: CustomerOperationsProfile!
        status: CustomerFollowUpStatus!
        source: String!
        priority: CustomerFollowUpPriority!
        reasonCode: String!
        title: String!
        note: String!
        dueAt: DateTime!
        ownerUserId: ID
        outcomeCode: CustomerFollowUpOutcome
        outcomeNote: String
        completedAt: DateTime
        completedByUserId: ID
        overdue: Boolean!
        events: [CustomerFollowUpEvent!]!
    }

    type CustomerFollowUpList implements PaginatedList {
        items: [CustomerFollowUp!]!
        totalItems: Int!
    }

    input CustomerOperationsProfileListOptions {
        segment: CustomerOperationsSegment
        churnRisk: CustomerChurnRisk
        followUpDue: Boolean
        search: String
        skip: Int
        take: Int
    }

    input CustomerFollowUpListOptions {
        status: CustomerFollowUpStatus
        overdue: Boolean
        priority: CustomerFollowUpPriority
        customerId: ID
        skip: Int
        take: Int
    }

    input CreateCustomerFollowUpInput {
        customerId: ID!
        priority: CustomerFollowUpPriority!
        dueAt: DateTime!
        title: String!
        note: String!
        idempotencyKey: String!
    }

    input UpdateCustomerFollowUpInput {
        id: ID!
        action: CustomerFollowUpAction!
        dueAt: DateTime
        outcomeCode: CustomerFollowUpOutcome
        note: String!
        idempotencyKey: String!
    }

    enum GovernedConfigNamespace {
        FRAUD_RULES
        REPORT_SCHEDULE
    }

    enum GovernedConfigStatus {
        DRAFT
        ACTIVE
        RETIRED
        REJECTED
    }

    enum GovernanceApprovalStatus {
        PENDING
        APPROVED
        REJECTED
        CANCELLED
        EXPIRED
    }

    type GovernedConfigVersion implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        channelId: ID!
        namespace: GovernedConfigNamespace!
        version: Int!
        status: GovernedConfigStatus!
        payloadJson: String!
        payloadHash: String!
        createdByUserId: ID!
        activatedAt: DateTime
        retiredAt: DateTime
    }

    type GovernanceApprovalRequest implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        channelId: ID!
        configVersion: GovernedConfigVersion!
        status: GovernanceApprovalStatus!
        requestedByUserId: ID!
        requestReason: String!
        expiresAt: DateTime!
        reviewedByUserId: ID
        reviewReason: String
        reviewedAt: DateTime
        idempotencyKey: String!
    }

    type GovernanceAuditEntry implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        channelId: ID!
        sequence: Int!
        eventType: String!
        resourceType: String!
        resourceId: String!
        actorType: String!
        actorUserId: ID
        actorLabel: String!
        reason: String!
        payloadJson: String!
        payloadHash: String!
        previousHash: String
        entryHash: String!
        idempotencyKey: String!
    }

    type GovernanceAuditEntryList implements PaginatedList {
        items: [GovernanceAuditEntry!]!
        totalItems: Int!
    }

    type GovernanceAuditIntegrity {
        valid: Boolean!
        checkedEntries: Int!
        brokenAt: Int
    }

    type GovernanceReportSnapshot implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        channelId: ID!
        businessDate: String!
        windowStartedAt: DateTime!
        windowEndedAt: DateTime!
        metricsJson: String!
        digest: String!
        auditIntegrityValid: Boolean!
        anomalyCount: Int!
    }

    input SubmitGovernedConfigInput {
        namespace: GovernedConfigNamespace!
        payloadJson: String!
        reason: String!
        idempotencyKey: String!
    }

    enum GovernanceApprovalDecision {
        APPROVE
        REJECT
    }

    input ReviewGovernanceApprovalInput {
        id: ID!
        decision: GovernanceApprovalDecision!
        reason: String!
        idempotencyKey: String!
    }

    enum FraudRiskCaseStatus {
        OPEN
        IN_REVIEW
        APPROVED
        REJECTED
        APPEALED
        CLOSED
    }

    enum FraudRiskSeverity {
        P1
        P2
        P3
    }

    type FraudRiskCaseEvent implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        eventType: String!
        actorType: String!
        actorUserId: ID
        note: String!
        payloadJson: String
        idempotencyKey: String!
    }

    type FraudRiskAppeal implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        status: String!
        reason: String!
        response: String
        reviewedByUserId: ID
        reviewedAt: DateTime
    }

    type FraudRiskCase implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        channelId: ID!
        caseCode: String!
        subjectType: String!
        subjectId: String!
        orderId: ID
        customerId: ID
        status: FraudRiskCaseStatus!
        severity: FraudRiskSeverity!
        riskScore: Int!
        ruleVersion: String!
        subjectDigest: String!
        signalsJson: String!
        recommendedAction: String!
        dueAt: DateTime!
        ownerUserId: ID
        decisionCode: String
        decisionReason: String
        decidedByUserId: ID
        decidedAt: DateTime
        events: [FraudRiskCaseEvent!]!
        appeals: [FraudRiskAppeal!]!
    }

    type FraudRiskCaseList implements PaginatedList {
        items: [FraudRiskCase!]!
        totalItems: Int!
    }

    input FraudRiskCaseListOptions {
        status: FraudRiskCaseStatus
        severity: FraudRiskSeverity
        overdue: Boolean
        skip: Int
        take: Int
    }

    enum FraudRiskReviewAction {
        CLAIM
        RELEASE
        BLOCK
    }

    input ReviewFraudRiskCaseInput {
        id: ID!
        action: FraudRiskReviewAction!
        reason: String!
        idempotencyKey: String!
    }
`;
