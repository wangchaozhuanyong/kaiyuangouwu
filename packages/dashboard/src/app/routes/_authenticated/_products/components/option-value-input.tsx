import { Badge } from '@/vdb/components/ui/badge.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Input } from '@/vdb/components/ui/input.js';
import { useLingui } from '@lingui/react/macro';
import { X } from 'lucide-react';
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
            </div>

            <div className="flex flex-wrap gap-2">
                {fields.map((field, index) => (
                    <Badge key={field.id} variant="secondary" className="flex items-center gap-1 py-1 px-2">
                        {field.valueZh}
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-4 w-4 p-0 ml-1"
                            onClick={() => onRemove(index)}
                        >
                            <X className="h-3 w-3" />
                        </Button>
                    </Badge>
                ))}
            </div>
        </div>
    );
}
