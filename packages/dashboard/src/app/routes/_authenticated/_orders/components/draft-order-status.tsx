import { Alert, AlertDescription, AlertTitle } from '@/vdb/components/ui/alert.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { AlertTriangle, CheckCircle } from 'lucide-react';
import { getDraftOrderIncompleteReason } from './draft-order-readiness.js';

export type DraftOrderStatusProps = Readonly<{
    hasCustomer: boolean;
    hasLines: boolean;
    requiresShipping: boolean;
    hasCompleteShippingAddress: boolean;
    hasShippingMethod: boolean;
    isDraftState: boolean;
}>;

export function DraftOrderStatus({
    hasCustomer,
    hasLines,
    requiresShipping,
    hasCompleteShippingAddress,
    hasShippingMethod,
    isDraftState,
}: DraftOrderStatusProps) {
    const { t } = useLingui();
    const incompleteReason = getDraftOrderIncompleteReason({
        hasCustomer,
        hasLines,
        requiresShipping,
        hasCompleteShippingAddress,
        hasShippingMethod,
        isDraftState,
    });
    const isCompleteDraftDisabled = incompleteReason !== null;

    let completeDraftDisabledReason: string | null = null;
    if (incompleteReason === 'customer') {
        completeDraftDisabledReason = t`Select a customer to continue`;
    } else if (incompleteReason === 'lines') {
        completeDraftDisabledReason = t`Add at least one item to the order`;
    } else if (incompleteReason === 'shippingAddress') {
        completeDraftDisabledReason = t`Enter a complete shipping address, including postcode and phone number`;
    } else if (incompleteReason === 'shippingMethod') {
        completeDraftDisabledReason = t`Select a shipping method to continue`;
    } else if (incompleteReason === 'state') {
        completeDraftDisabledReason = t`Only draft orders can be completed`;
    }

    const Icon = isCompleteDraftDisabled ? AlertTriangle : CheckCircle;
    const title = isCompleteDraftDisabled ? (
        <Trans>Order draft isn't ready to be completed</Trans>
    ) : (
        <Trans>Order draft is ready to be completed</Trans>
    );

    return (
        <Alert variant={isCompleteDraftDisabled ? 'destructive' : 'default'}>
            <Icon className={isCompleteDraftDisabled ? '' : 'stroke-success'} />
            <AlertTitle className={isCompleteDraftDisabled ? '' : 'text-success-text'}>{title}</AlertTitle>
            {completeDraftDisabledReason ? (
                <AlertDescription>{completeDraftDisabledReason}</AlertDescription>
            ) : null}
        </Alert>
    );
}
