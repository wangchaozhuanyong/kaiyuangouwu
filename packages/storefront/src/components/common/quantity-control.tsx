import { Minus, Plus } from 'lucide-react';

import '../../styles/quantity-control.css';

export function QuantityControl({
    value,
    label,
    decreaseLabel,
    increaseLabel,
    decreaseDisabled = false,
    increaseDisabled = false,
    onDecrease,
    onIncrease,
}: {
    value: number;
    label: string;
    decreaseLabel: string;
    increaseLabel: string;
    decreaseDisabled?: boolean;
    increaseDisabled?: boolean;
    onDecrease: () => void;
    onIncrease: () => void;
}) {
    return (
        <span className="quantity-control" role="group" aria-label={label}>
            <button type="button" aria-label={decreaseLabel} disabled={decreaseDisabled} onClick={onDecrease}>
                <Minus aria-hidden="true" />
            </button>
            <output aria-live="polite" aria-atomic="true">
                {value}
            </output>
            <button type="button" aria-label={increaseLabel} disabled={increaseDisabled} onClick={onIncrease}>
                <Plus aria-hidden="true" />
            </button>
        </span>
    );
}
