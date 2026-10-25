import { Kind, parse } from 'graphql';

/** Only the isolated decoration document uses these explicitly synthetic account reads. */
export function decorationPreviewAccountData(document: string): Record<string, unknown> | undefined {
    const operations = parse(document).definitions.filter(value => value.kind === Kind.OPERATION_DEFINITION);
    if (operations.length !== 1 || operations[0].operation !== 'query') return;
    const fields: Record<string, unknown> = {
        activeCustomer: null,
        myCustomerAvatar: null,
        activeOrder: null,
        myAfterSalesRequests: [],
        myReferralOverview: {
            enabled: true,
            rewardRate: 0,
            releaseDelayDays: 0,
            inviteCode: '',
            wallets: [],
            invitedCount: 0,
            purchasedInviteeCount: 0,
            rewardSummaries: [],
            invitees: [],
            ledger: [],
        },
    };
    const data: Record<string, unknown> = Object.create(null);
    for (const selection of operations[0].selectionSet.selections) {
        if (selection.kind !== Kind.FIELD || !Object.hasOwn(fields, selection.name.value)) return;
        data[selection.alias?.value ?? selection.name.value] = fields[selection.name.value];
    }
    return data;
}
