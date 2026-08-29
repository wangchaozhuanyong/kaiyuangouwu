import { Button } from '@/vdb/components/ui/button.js';
import { Input } from '@/vdb/components/ui/input.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

interface OptionValue {
    valueZh: string;
    id: string;
}

interface OptionValueInputProps {
    fields: Array<OptionValue>;
    onAdd: (value: OptionValue) => void;
    onRemove: (index: number) => void;
    disabled?: boolean;
}

export function OptionValueInput({
    fields,
    onAdd,
    onRemove,
    disabled = false,
}: Readonly<OptionValueInputProps>) {
    const [newValueZh, setNewValueZh] = useState('');
    const { t } = useLingui();

    const handleAddValue = () => {
        const valueZh = newValueZh.trim();
        if (!valueZh) return;
        const normalizedZh = valueZh.toLowerCase().normalize();
        if (fields.some(field => field.valueZh.toLowerCase().normalize() === normalizedZh)) {
            toast.error(t`This option value already exists`);
            return;
        }
        onAdd({ valueZh, id: Date.now().toString() });
        setNewValueZh('');
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleAddValue();
        }
    };

    return (
        <div className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                    value={newValueZh}
                    onChange={event => setNewValueZh(event.target.value)}
                    onKeyDown={handleKeyPress}
                    placeholder={t`Simplified Chinese value`}
                    disabled={disabled}
                    className="h-10 flex-1"
                />
                <Button
                    type="button"
                    variant="secondary"
                    onClick={handleAddValue}
                    disabled={disabled || !newValueZh.trim()}
                    className="h-10 w-full shrink-0 sm:w-auto"
                >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    <Trans>Add option value</Trans>
                </Button>
            </div>

            {fields.length > 0 && (
                <ol aria-label={t`Option Values`} className="overflow-hidden rounded-lg border bg-background">
                    {fields.map((field, index) => {
                        const item = field.valueZh;
                        return (
                            <li
                                key={field.id}
                                data-slot="option-value-row"
                                className="grid min-h-11 grid-cols-[2.5rem_minmax(0,1fr)_3rem] items-stretch border-b transition-colors last:border-b-0 hover:bg-muted/40"
                            >
                                <span className="flex items-center justify-center border-r text-xs font-medium text-muted-foreground tabular-nums">
                                    {index + 1}
                                </span>
                                <span className="flex min-w-0 items-center px-3 py-2 text-sm font-medium break-words">
                                    {field.valueZh}
                                </span>
                                <span className="flex items-center justify-center border-l">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="h-8 w-8 p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                        onClick={() => onRemove(index)}
                                        aria-label={t`Remove ${item}`}
                                    >
                                        <X className="h-4 w-4" aria-hidden="true" />
                                    </Button>
                                </span>
                            </li>
                        );
                    })}
                </ol>
            )}
        </div>
    );
}
