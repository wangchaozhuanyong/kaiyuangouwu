import { Badge } from '@/vdb/components/ui/badge.js';
import { Button } from '@/vdb/components/ui/button.js';
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/vdb/components/ui/command.js';
import { Popover, PopoverContent, PopoverTrigger } from '@/vdb/components/ui/popover.js';
import { cn } from '@/vdb/lib/utils.js';
import { Trans } from '@lingui/react/macro';
import { Check, ChevronDown } from 'lucide-react';
import { FocusEventHandler, Ref, useId, useState } from 'react';

export interface MultiSelectProps<T extends boolean> {
    value: T extends true ? string[] : string;
    onChange: (value: T extends true ? string[] : string) => void;
    multiple?: T;
    items: Array<{
        value: string;
        label: string;
        /**
         * The display value to use for the item.
         * If not provided, the label will be used.
         * This is useful for displaying a more complex value in
         * a React component.
         */
        display?: string | React.ReactNode;
    }>;
    placeholder?: string;
    searchPlaceholder?: string;
    showSearch?: boolean;
    className?: string;
    id?: string;
    disabled?: boolean;
    name?: string;
    ref?: Ref<HTMLButtonElement>;
    onBlur?: FocusEventHandler<HTMLButtonElement>;
    required?: boolean;
    'aria-label'?: string;
    'aria-labelledby'?: string;
    'aria-describedby'?: string;
    'aria-errormessage'?: string;
    'aria-invalid'?: React.AriaAttributes['aria-invalid'];
    'aria-required'?: React.AriaAttributes['aria-required'];
}

export function MultiSelect<T extends boolean>(props: MultiSelectProps<T>) {
    const {
        value,
        onChange,
        multiple,
        items,
        placeholder = 'Select items',
        searchPlaceholder = 'Search...',
        showSearch,
        className,
        id,
        disabled,
        name,
        ref,
        onBlur,
        required,
        'aria-label': ariaLabel,
        'aria-labelledby': ariaLabelledBy,
        'aria-describedby': ariaDescribedBy,
        'aria-errormessage': ariaErrorMessage,
        'aria-invalid': ariaInvalid,
        'aria-required': ariaRequired,
    } = props;
    const generatedId = useId();
    const triggerId = id ?? generatedId;
    const listId = `${triggerId}-listbox`;
    const [search, setSearch] = useState('');
    const [open, setOpen] = useState(false);

    const filteredItems = items.filter(item => item.label.toLowerCase().includes(search.toLowerCase()));

    const handleSelect = (selectedValue: string) => {
        if (multiple) {
            const currentValue = value as string[];
            const newValue = currentValue.includes(selectedValue)
                ? currentValue.filter(v => v !== selectedValue)
                : [...currentValue, selectedValue];
            onChange(newValue as T extends true ? string[] : string);
        } else {
            onChange(selectedValue as T extends true ? string[] : string);
            // A single-select has nothing left to choose once a value is picked, so close. A
            // multiple select stays open to take further selections.
            setOpen(false);
        }
    };

    const renderTrigger = () => {
        if (multiple) {
            const selectedValues: string[] = typeof value === 'string' ? [value] : value;
            return (
                <Button
                    variant="outline"
                    role="combobox"
                    id={triggerId}
                    disabled={disabled}
                    name={name}
                    ref={ref}
                    onBlur={onBlur}
                    aria-expanded={open}
                    aria-controls={listId}
                    aria-haspopup="listbox"
                    aria-label={ariaLabel}
                    aria-labelledby={ariaLabelledBy}
                    aria-describedby={ariaDescribedBy}
                    aria-errormessage={ariaErrorMessage}
                    aria-invalid={ariaInvalid}
                    aria-required={ariaRequired ?? (required || undefined)}
                    className={cn(
                        'w-full justify-between bg-transparent',
                        'min-h-[2.5rem] h-auto',
                        'flex flex-wrap gap-1 p-1',
                        className,
                    )}
                >
                    <div className="flex flex-wrap gap-1">
                        {selectedValues.length > 0 ? (
                            selectedValues.map(selectedValue => {
                                const item = items.find(i => i.value === selectedValue);
                                return (
                                    <Badge
                                        key={selectedValue}
                                        variant="secondary"
                                        className="flex items-center"
                                    >
                                        {item?.display ?? item?.label ?? selectedValue}
                                    </Badge>
                                );
                            })
                        ) : (
                            <span className="text-muted-foreground">{placeholder}</span>
                        )}
                    </div>
                    <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
                </Button>
            );
        }
        const selectedItem = items.find(i => i.value === value);
        return (
            <Button
                variant="outline"
                role="combobox"
                id={triggerId}
                disabled={disabled}
                name={name}
                ref={ref}
                onBlur={onBlur}
                aria-expanded={open}
                aria-controls={listId}
                aria-haspopup="listbox"
                aria-label={ariaLabel}
                aria-labelledby={ariaLabelledBy}
                aria-describedby={ariaDescribedBy}
                aria-errormessage={ariaErrorMessage}
                aria-invalid={ariaInvalid}
                aria-required={ariaRequired ?? (required || undefined)}
                className={cn('w-full justify-between bg-transparent', className)}
            >
                {selectedItem ? (selectedItem.display ?? selectedItem.label) : placeholder}
                <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
            </Button>
        );
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger render={renderTrigger()}></PopoverTrigger>
            <PopoverContent
                className="w-[200px] p-0"
                side="bottom"
                align="start"
                aria-label={ariaLabel ?? (ariaLabelledBy ? undefined : placeholder)}
                aria-labelledby={ariaLabelledBy}
                onWheel={e => e.stopPropagation()}
            >
                <Command shouldFilter={false}>
                    {(showSearch === true || items.length > 10) && (
                        <CommandInput
                            placeholder={searchPlaceholder}
                            value={search}
                            onValueChange={setSearch}
                            aria-label={searchPlaceholder}
                        />
                    )}
                    <CommandList id={listId} className="max-h-[300px] overflow-auto">
                        <CommandEmpty>
                            <Trans>No results found</Trans>
                        </CommandEmpty>
                        <CommandGroup>
                            {filteredItems.map(item => {
                                const selected = multiple
                                    ? (value as string[]).includes(item.value)
                                    : value === item.value;
                                return (
                                    <CommandItem
                                        key={item.value}
                                        value={`${item.label} ${item.value}`}
                                        aria-selected={selected}
                                        onSelect={() => handleSelect(item.value)}
                                    >
                                        <Check
                                            className={cn(
                                                'mr-2 h-4 w-4',
                                                selected ? 'opacity-100' : 'opacity-0',
                                            )}
                                        />
                                        {item.display ?? item.label}
                                    </CommandItem>
                                );
                            })}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}
