import { JsonViewer } from '@/vdb/components/data-display/json-viewer.js';
import { DataTable } from '@/vdb/components/data-table/data-table.js';
import { CopyableText } from '@/vdb/components/shared/copyable-text.js';
import { Badge } from '@/vdb/components/ui/badge.js';
import { Button } from '@/vdb/components/ui/button.js';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/vdb/components/ui/dialog.js';
import { Input } from '@/vdb/components/ui/input.js';
import { ScrollArea } from '@/vdb/components/ui/scroll-area.js';
import { Switch } from '@/vdb/components/ui/switch.js';
import {
    FullWidthPageBlock,
    Page,
    PageLayout,
    PageTitle,
} from '@/vdb/framework/layout-engine/page-layout.js';
import { api } from '@/vdb/graphql/api.js';
import { graphql, ResultOf } from '@/vdb/graphql/graphql.js';
import { setSettingsStoreValueDocument } from '@/vdb/graphql/settings-store-operations.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { ColumnFilter, createColumnHelper } from '@tanstack/react-table';
import { Braces } from 'lucide-react';
import React, { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { getSettingsStoreDisplayName } from './settings-store-utils.js';

export const Route = createFileRoute('/_authenticated/_system/settings-store')({
    component: SettingsStorePage,
    loader: () => ({ breadcrumb: () => <Trans>Settings Store</Trans> }),
});

const settingsStoreFieldDefinitionsDocument = graphql(`
    query SettingsStoreFieldDefinitions {
        settingsStoreFieldDefinitions {
            key
            scopeType
            readonly
            currentValue
        }
    }
`);

type FieldDefinition = ResultOf<
    typeof settingsStoreFieldDefinitionsDocument
>['settingsStoreFieldDefinitions'][number];

const fieldDefinitionsQueryKey = ['settingsStoreFieldDefinitions'] as const;

const scopeBadgeVariant: Record<FieldDefinition['scopeType'], 'default' | 'secondary' | 'outline'> = {
    GLOBAL: 'default',
    USER: 'secondary',
    CHANNEL: 'outline',
    USER_AND_CHANNEL: 'secondary',
    CUSTOM: 'outline',
};

function ValueCell({ field, onSave }: { field: FieldDefinition; onSave: (value: any) => void }) {
    const value = field.currentValue;
    const isComplex = typeof value === 'object' && value !== null;

    // Complex objects/arrays → dialog with JSON tree viewer/editor
    if (isComplex) {
        return (
            <JsonValueDialog value={value} fieldKey={field.key} readonly={field.readonly} onSave={onSave} />
        );
    }

    // Readonly simple values → plain text
    if (field.readonly) {
        return <span className="text-muted-foreground">{formatDisplayValue(value)}</span>;
    }

    // Booleans → inline toggle
    if (typeof value === 'boolean') {
        return <Switch checked={value} onCheckedChange={checked => onSave(checked)} />;
    }

    // Strings, numbers, null → inline editable text
    return <InlineEditValue value={value} onSave={onSave} />;
}

function JsonValueDialog({
    value,
    fieldKey,
    readonly,
    onSave,
}: {
    value: any;
    fieldKey: string;
    readonly: boolean;
    onSave: (value: any) => void;
}) {
    const [open, setOpen] = useState(false);
    const editedValueRef = useRef(value);
    const { t } = useLingui();

    const handleSave = () => {
        onSave(editedValueRef.current);
        setOpen(false);
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger
                render={<Button variant="outline" size="sm" className="max-w-[300px] justify-start gap-2" />}
            >
                <Braces className="size-3.5 shrink-0" />
                <span className="truncate">{t`View configuration content`}</span>
            </DialogTrigger>
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>
                        <code>{fieldKey}</code>
                    </DialogTitle>
                    <DialogDescription>
                        {readonly ? <Trans>This field is readonly</Trans> : <Trans>Edit JSON value</Trans>}
                    </DialogDescription>
                </DialogHeader>
                <ScrollArea className="max-h-[500px]">
                    <JsonViewer
                        data={value}
                        viewOnly={readonly}
                        collapse={1}
                        rootFontSize={12}
                        onUpdate={({ newData }) => {
                            editedValueRef.current = newData;
                        }}
                    />
                </ScrollArea>
                {!readonly && (
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpen(false)}>
                            <Trans>Cancel</Trans>
                        </Button>
                        <Button onClick={handleSave}>
                            <Trans>Save</Trans>
                        </Button>
                    </DialogFooter>
                )}
            </DialogContent>
        </Dialog>
    );
}

function InlineEditValue({ value, onSave }: { value: any; onSave: (value: any) => void }) {
    const { t } = useLingui();
    const [editing, setEditing] = useState(false);
    const currentValueStr = String(value ?? '');
    const [draft, setDraft] = useState(currentValueStr);

    const startEditing = () => {
        setDraft(currentValueStr);
        setEditing(true);
    };

    const handleSave = () => {
        setEditing(false);
        if (draft === currentValueStr) return;
        if (typeof value === 'number') {
            const parsed = Number(draft);
            if (isNaN(parsed)) {
                toast.error(t`Invalid number`);
                return;
            }
            onSave(parsed);
        } else {
            onSave(draft);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleSave();
        }
        if (e.key === 'Escape') {
            setEditing(false);
        }
    };

    if (!editing) {
        return (
            <button
                type="button"
                onClick={startEditing}
                className="text-left hover:bg-muted rounded px-1 py-0.5 cursor-pointer w-full min-h-[1.5rem]"
            >
                {formatDisplayValue(value)}
            </button>
        );
    }

    return (
        <Input
            autoFocus
            type={typeof value === 'number' ? 'number' : 'text'}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
            className="h-7"
        />
    );
}

function formatDisplayValue(value: any): string {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return String(value);
}

function SettingsStorePage() {
    const { i18n, t } = useLingui();
    const [search, setSearch] = useState('');
    const [columnFilters, setColumnFilters] = useState<ColumnFilter[]>([]);
    const queryClient = useQueryClient();
    const { data, error, isLoading } = useQuery({
        queryKey: fieldDefinitionsQueryKey,
        queryFn: () => api.query(settingsStoreFieldDefinitionsDocument),
    });
    const invalidateFieldDefinitions = () => {
        void queryClient.invalidateQueries({ queryKey: [...fieldDefinitionsQueryKey] });
    };
    const { mutate: setValue } = useMutation({
        mutationFn: api.mutate(setSettingsStoreValueDocument),
        onSuccess: result => {
            const res = result as ResultOf<typeof setSettingsStoreValueDocument>;
            if (res.setSettingsStoreValue.result) {
                toast.success(t`Value updated`);
                invalidateFieldDefinitions();
            } else {
                toast.error(res.setSettingsStoreValue.error ?? t`Failed to update value`);
            }
        },
    });

    const allFields = data?.settingsStoreFieldDefinitions ?? [];
    const scopeLabels = useMemo<Record<FieldDefinition['scopeType'], string>>(
        () => ({
            GLOBAL: t`Global`,
            USER: t`User`,
            CHANNEL: t`Channel`,
            USER_AND_CHANNEL: t`User & Channel`,
            CUSTOM: t`Custom`,
        }),
        [t],
    );
    const scopeOptions = useMemo(
        () =>
            Object.entries(scopeLabels).map(([value, label]) => ({
                label,
                value: value as FieldDefinition['scopeType'],
            })),
        [scopeLabels],
    );
    const filteredFields = allFields.filter(f => {
        const searchTarget = `${getSettingsStoreDisplayName(i18n, f.key)} ${f.key}`.toLowerCase();
        if (search && !searchTarget.includes(search.toLowerCase())) return false;
        for (const filter of columnFilters) {
            const values = filter.value as string[];
            if (!values?.length) continue;
            if (filter.id === 'scopeType' && !values.includes(f.scopeType)) return false;
            if (filter.id === 'readonly' && !values.includes(String(f.readonly))) return false;
        }
        return true;
    });

    const columnHelper = createColumnHelper<FieldDefinition>();
    const columns = useMemo(
        () => [
            columnHelper.accessor('key', {
                header: t`Configuration item`,
                cell: ({ row }) => {
                    const displayName = getSettingsStoreDisplayName(i18n, row.original.key);
                    return (
                        <div className="flex min-w-52 flex-col gap-1">
                            <span className="font-medium">{displayName}</span>
                            <CopyableText value={row.original.key}>
                                <code className="text-muted-foreground text-xs">{row.original.key}</code>
                            </CopyableText>
                        </div>
                    );
                },
            }),
            columnHelper.accessor('currentValue', {
                header: t`Current value`,
                cell: ({ row }) => (
                    <ValueCell
                        field={row.original}
                        onSave={newValue =>
                            setValue({
                                input: { key: row.original.key, value: newValue },
                            })
                        }
                    />
                ),
            }),
            columnHelper.accessor('scopeType', {
                header: t`Effective scope`,
                cell: ({ row }) => (
                    <Badge variant={scopeBadgeVariant[row.original.scopeType]}>
                        {scopeLabels[row.original.scopeType]}
                    </Badge>
                ),
            }),
            columnHelper.accessor('readonly', {
                header: t`Readonly`,
                cell: ({ row }) =>
                    row.original.readonly ? (
                        <Badge variant="secondary">
                            <Trans>Readonly</Trans>
                        </Badge>
                    ) : null,
            }),
        ],
        [i18n, t, setValue, scopeLabels],
    );

    return (
        <Page pageId="settings-store-list">
            <PageTitle>
                <Trans>Settings Store</Trans>
            </PageTitle>
            <PageLayout>
                <FullWidthPageBlock blockId="list-table">
                    <DataTable
                        onRefresh={invalidateFieldDefinitions}
                        onSearchTermChange={setSearch}
                        onFilterChange={(_table, filters) => setColumnFilters(filters)}
                        facetedFilters={{
                            scopeType: {
                                title: t`Effective scope`,
                                options: scopeOptions,
                            },
                            readonly: {
                                title: t`Readonly`,
                                options: [
                                    { label: t`Yes`, value: 'true' },
                                    { label: t`No`, value: 'false' },
                                ],
                            },
                        }}
                        isLoading={isLoading}
                        error={error}
                        columns={columns}
                        data={filteredFields}
                        totalItems={filteredFields.length}
                    />
                </FullWidthPageBlock>
            </PageLayout>
        </Page>
    );
}
