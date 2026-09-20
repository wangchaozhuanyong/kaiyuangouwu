import type { ID } from '@vendure/common/lib/shared-types';
import type { CustomerFollowUpOutcome, CustomerFollowUpPriority } from './entities/customer-follow-up.entity';
import type {
    CustomerChurnRisk,
    CustomerOperationsSegment,
} from './entities/customer-operations-profile.entity';

export interface CustomerCurrencyMetric {
    currencyCode: string;
    orderCount: number;
    grossRevenue: number;
    refundTotal: number;
    netLifetimeValue: number;
    averageOrderValue: number;
}

export interface CustomerOperationsProfileListOptions {
    segment?: CustomerOperationsSegment;
    churnRisk?: CustomerChurnRisk;
    followUpDue?: boolean;
    search?: string;
    skip?: number;
    take?: number;
}

export interface CustomerFollowUpListOptions {
    status?: 'OPEN' | 'COMPLETED' | 'DISMISSED';
    overdue?: boolean;
    priority?: CustomerFollowUpPriority;
    customerId?: ID;
    skip?: number;
    take?: number;
}

export interface CreateCustomerFollowUpInput {
    customerId: ID;
    priority: CustomerFollowUpPriority;
    dueAt: Date | string;
    title: string;
    note: string;
    idempotencyKey: string;
}

export interface UpdateCustomerFollowUpInput {
    id: ID;
    action: 'RESCHEDULE' | 'COMPLETE' | 'DISMISS';
    dueAt?: Date | string | null;
    outcomeCode?: CustomerFollowUpOutcome | null;
    note: string;
    idempotencyKey: string;
}
