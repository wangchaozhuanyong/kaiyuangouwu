import { configureDefaultOrderProcess, defaultOrderProcess, OrderOptions } from '@vendure/core';

import { commerceOrderProcess } from './commerce-order-process';

function isStandardOrderProcess(process: NonNullable<OrderOptions['process']>[number]): boolean {
    // preBootstrapConfig deep-clones plain process objects, but preserves functions.
    // A configured/custom guard has its own callbacks or transitions and stays intact.
    return (
        process.init === defaultOrderProcess.init &&
        process.onTransitionStart === defaultOrderProcess.onTransitionStart &&
        process.onTransitionEnd === defaultOrderProcess.onTransitionEnd &&
        process.onTransitionError === defaultOrderProcess.onTransitionError &&
        JSON.stringify(process.transitions) === JSON.stringify(defaultOrderProcess.transitions)
    );
}

export function composeCommerceOrderProcesses(
    existing: NonNullable<OrderOptions['process']> = [],
): NonNullable<OrderOptions['process']> {
    return [
        ...existing.filter(process => !isStandardOrderProcess(process)),
        commerceOrderProcess,
        configureDefaultOrderProcess({
            arrangingPaymentRequiresShipping: false,
            arrangingPaymentRequiresStock: false,
        }),
    ];
}
