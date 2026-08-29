import { FormFieldWrapper } from '@/vdb/components/shared/form-field-wrapper.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Form } from '@/vdb/components/ui/form.js';
import { Input } from '@/vdb/components/ui/input.js';
import { z, zodResolver } from '@/vdb/lib/zod.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { Control, useFieldArray, useForm } from 'react-hook-form';
import { OptionValueInput } from './option-value-input.js';

type Translate = ReturnType<typeof useLingui>['t'];

export const createOptionGroupSchema = (t: Translate) => {
    const optionValueSchema = z.object({
        valueZh: z.string().min(1, { message: t`Simplified Chinese value is required` }),
        id: z.string().min(1, { message: t`Value cannot be empty` }),
    });

    return z.object({
        nameZh: z.string().min(1, { message: t`Simplified Chinese option name is required` }),
        values: z.array(optionValueSchema).min(1, { message: t`At least one value is required` }),
    });
};

export type OptionGroup = z.infer<ReturnType<typeof createOptionGroupSchema>>;
export type MultiGroupForm = { optionGroups: OptionGroup[] };

export interface SingleOptionGroup {
    nameZh: string;
    values: Array<{
        valueZh: string;
        id: string;
    }>;
}

export interface OptionGroupConfiguration {
    optionGroups: SingleOptionGroup[];
}

interface SingleOptionGroupEditorProps {
    control: Control<any>;
    fieldArrayPath: string;
    disabled?: boolean;
}

export function SingleOptionGroupEditor({
    control,
    fieldArrayPath,
    disabled,
}: Readonly<SingleOptionGroupEditorProps>) {
    const { t } = useLingui();
    const { fields, append, remove } = useFieldArray({
        control,
        name: fieldArrayPath ? `${fieldArrayPath}.values` : 'values',
    });

    return (
        <div className="min-w-0 flex-1 rounded-xl border bg-muted/20 p-4 sm:p-5">
            <div className="grid items-start gap-5 md:grid-cols-[minmax(11rem,0.75fr)_minmax(18rem,1.4fr)]">
                <div className="min-w-0">
                    <FormFieldWrapper
                        control={control}
                        name={fieldArrayPath ? `${fieldArrayPath}.nameZh` : 'nameZh'}
                        label={<Trans>Option group name (Simplified Chinese)</Trans>}
                        render={({ field }) => (
                            <Input
                                className="h-10 bg-background"
                                placeholder={t`For example: Size`}
                                {...field}
                            />
                        )}
                    />
                </div>
                <div className="min-w-0">
                    <FormFieldWrapper
                        control={control}
                        name={fieldArrayPath ? `${fieldArrayPath}.values` : 'values'}
                        label={<Trans>Option Values</Trans>}
                        render={({ field }) => (
                            <OptionValueInput
                                fields={fields as any}
                                onAdd={append}
                                onRemove={remove}
                                disabled={disabled}
                            />
                        )}
                    />
                </div>
            </div>
        </div>
    );
}

// Multi Option Groups Editor - for use in create product variants
interface OptionGroupsEditorProps {
    onChange?: (data: OptionGroupConfiguration) => void;
    initialGroups?: OptionGroupConfiguration['optionGroups'];
}

export function OptionGroupsEditor({ onChange, initialGroups = [] }: Readonly<OptionGroupsEditorProps>) {
    const { t } = useLingui();
    const multiGroupFormSchema = useMemo(
        () =>
            z.object({
                optionGroups: z.array(createOptionGroupSchema(t)),
            }),
        [t],
    );
    const form = useForm<MultiGroupForm>({
        resolver: zodResolver(multiGroupFormSchema),
        defaultValues: {
            optionGroups: initialGroups.length > 0 ? initialGroups : [],
        },
        mode: 'onChange',
    });

    const { control } = form;
    const {
        fields: optionGroups,
        append: appendOptionGroup,
        remove: removeOptionGroup,
    } = useFieldArray({
        control,
        name: 'optionGroups',
    });

    // Watch for changes and notify parent
    useEffect(() => {
        const subscription = form.watch(value => {
            if (value?.optionGroups) {
                const allOptionGroups: SingleOptionGroup[] = value.optionGroups
                    .filter((g): g is NonNullable<typeof g> => !!g)
                    .map(g => ({
                        nameZh: g.nameZh ?? '',
                        values: (g.values ?? [])
                            .filter((v): v is NonNullable<typeof v> => !!v)
                            .filter(v => typeof v.valueZh === 'string' && typeof v.id === 'string')
                            .map(v => ({ valueZh: v.valueZh!, id: v.id! })),
                    }));

                onChange?.({ optionGroups: allOptionGroups });
            }
        });

        return () => subscription.unsubscribe();
    }, [form, onChange]);

    const handleAddOptionGroup = () => {
        appendOptionGroup({ nameZh: '', values: [] });
    };

    return (
        <Form {...form}>
            <div className="space-y-4">
                {optionGroups.map((group, index) => (
                    <div key={group.id} className="flex items-start">
                        <SingleOptionGroupEditor control={control} fieldArrayPath={`optionGroups.${index}`} />
                        <div className="shrink-0 mt-6">
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => removeOptionGroup(index)}
                                title={t`Remove option group`}
                            >
                                <Trash2 className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                ))}

                <Button type="button" variant="secondary" onClick={handleAddOptionGroup}>
                    <Plus className="mr-2 h-4 w-4" />
                    <Trans>Add Option</Trans>
                </Button>
            </div>
        </Form>
    );
}
