import { Badge } from '@/vdb/components/ui/badge.js';
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
        <div className="space-y-2">
            <div className="flex items-center gap-2">
                <Input
                    value={newValueZh}
                    onChange={event => setNewValueZh(event.target.value)}
                    onKeyDown={handleKeyPress}
                    placeholder={t`Simplified Chinese value`}
                    disabled={disabled}
                />
                <Button
                    type="button"
                    variant="secondary"
                    onClick={handleAddValue}
                    disabled={disabled || !newValueZh.trim()}
                    className="shrink-0"
                >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    <Trans>Add option value</Trans>
                </Button>
            </div>

            <div className="flex flex-wrap gap-2">
                {fields.map((field, index) => {
                    const item = field.valueZh;
                    return (
                        <Badge
                            key={field.id}
                            variant="secondary"
                            className="flex items-center gap-1 py-1 px-2"
                        >
                            {field.valueZh}
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="ml-1 h-5 w-5 p-0"
                                onClick={() => onRemove(index)}
                                aria-label={t`Remove ${item}`}
                            >
                                <X className="h-3 w-3" aria-hidden="true" />
                            </Button>
                        </Badge>
                    );
                })}
            </div>
        </div>
    );
}
