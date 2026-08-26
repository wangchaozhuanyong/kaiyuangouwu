import { ErrorPage } from '@/vdb/components/shared/error-page.js';
import { FormFieldWrapper } from '@/vdb/components/shared/form-field-wrapper.js';
import { TranslatableFormFieldWrapper } from '@/vdb/components/shared/translatable-form-field.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Input } from '@/vdb/components/ui/input.js';
import { Switch } from '@/vdb/components/ui/switch.js';
import { NEW_ENTITY_PATH } from '@/vdb/constants.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import {
    CustomFieldsPageBlock,
    DetailFormGrid,
    Page,
    PageActionBar,
    PageBlock,
    PageLayout,
    PageTitle,
} from '@/vdb/framework/layout-engine/page-layout.js';
import { detailPageRouteLoader } from '@/vdb/framework/page/detail-page-route-loader.js';
import { useDetailPage } from '@/vdb/framework/page/use-detail-page.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ExternalLink, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { countryDetailDocument, createCountryDocument, updateCountryDocument } from './countries.graphql.js';

const pageId = 'country-detail';

export const Route = createFileRoute('/_authenticated/_countries/countries_/$id')({
    component: CountryDetailPage,
    loader: detailPageRouteLoader({
        pageId,
        queryDocument: countryDetailDocument,
        breadcrumb: (isNew, entity) => [
            { path: '/countries', label: <Trans>Countries</Trans> },
            isNew ? <Trans>New country</Trans> : entity?.name,
        ],
    }),
    errorComponent: ({ error }) => <ErrorPage message={error.message} />,
});

function CountryDetailPage() {
    const params = Route.useParams();
    return <CountryEditor countryId={params.id} />;
}

export interface CountryEditorProps {
    countryId: string;
    presentation?: 'page' | 'sheet';
    onDirtyChange?: (isDirty: boolean) => void;
    onRequestClose?: () => void;
    onSaved?: (behavior: 'close' | 'keep-open') => void;
}

export function CountryEditor({
    countryId,
    presentation = 'page',
    onDirtyChange,
    onRequestClose,
    onSaved,
}: Readonly<CountryEditorProps>) {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const createAnotherRef = useRef(false);
    const creatingNewEntity = countryId === NEW_ENTITY_PATH;
    const { t } = useLingui();

    const { form, submitHandler, entity, isPending, resetForm } = useDetailPage({
        pageId,
        queryDocument: countryDetailDocument,
        createDocument: createCountryDocument,
        updateDocument: updateCountryDocument,
        setValuesForUpdate: entity => {
            return {
                id: entity.id,
                name: entity.name,
                code: entity.code,
                enabled: entity.enabled,
                translations: entity.translations,
                customFields: entity.customFields,
            };
        },
        params: { id: countryId },
        onSuccess: async data => {
            toast(creatingNewEntity ? t`Successfully created country` : t`Successfully updated country`);
            void queryClient.invalidateQueries({ queryKey: ['PaginatedListDataTable'] });
            if (presentation === 'sheet') {
                if (creatingNewEntity && createAnotherRef.current) {
                    createAnotherRef.current = false;
                    form.reset();
                    onSaved?.('keep-open');
                } else {
                    resetForm();
                    onSaved?.('close');
                }
            } else {
                resetForm();
            }
            if (presentation === 'page' && creatingNewEntity) {
                await navigate({ to: `../$id`, params: { id: data.id } });
            }
        },
        onError: err => {
            toast(creatingNewEntity ? t`Failed to create country` : t`Failed to update country`, {
                description: err instanceof Error ? err.message : t`Unknown error`,
            });
        },
    });

    useEffect(() => {
        onDirtyChange?.(form.formState.isDirty);
    }, [form.formState.isDirty, onDirtyChange]);

    return (
        <Page
            pageId={pageId}
            form={form}
            submitHandler={submitHandler}
            entity={entity}
            className={presentation === 'sheet' ? 'm-0 min-w-0 p-4' : undefined}
        >
            <PageTitle>{creatingNewEntity ? <Trans>New country</Trans> : (entity?.name ?? '')}</PageTitle>
            <PageActionBar>
                {presentation === 'sheet' && (
                    <Button
                        type="button"
                        variant="outline"
                        render={<Link to={`/countries/${countryId}`} preload={false} />}
                    >
                        <ExternalLink className="h-4 w-4" />
                        <Trans>Open full page</Trans>
                    </Button>
                )}
                {presentation === 'sheet' && creatingNewEntity && (
                    <Button
                        type="submit"
                        variant="outline"
                        disabled={!form.formState.isDirty || !form.formState.isValid || isPending}
                        onClick={() => {
                            createAnotherRef.current = true;
                        }}
                    >
                        {isPending ? <Trans>Saving...</Trans> : <Trans>Save and add another</Trans>}
                    </Button>
                )}
                <ActionBarItem
                    itemId="save-button"
                    requiresPermission={[creatingNewEntity ? 'CreateCountry' : 'UpdateCountry']}
                >
                    <Button
                        type="submit"
                        disabled={!form.formState.isDirty || !form.formState.isValid || isPending}
                        onClick={() => {
                            createAnotherRef.current = false;
                        }}
                    >
                        {isPending ? (
                            <Trans>Saving...</Trans>
                        ) : creatingNewEntity ? (
                            <Trans>Create</Trans>
                        ) : (
                            <Trans>Update</Trans>
                        )}
                    </Button>
                </ActionBarItem>
                {presentation === 'sheet' && onRequestClose && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={onRequestClose}
                        aria-label={t`Close`}
                    >
                        <X className="h-4 w-4" />
                    </Button>
                )}
            </PageActionBar>
            <PageLayout>
                <PageBlock column="side" blockId="enabled">
                    <FormFieldWrapper
                        control={form.control}
                        label={<Trans>Enabled</Trans>}
                        name="enabled"
                        render={({ field }) => (
                            <Switch checked={field.value} onCheckedChange={field.onChange} />
                        )}
                    />
                </PageBlock>
                <PageBlock column="main" blockId="main-form">
                    <DetailFormGrid>
                        <TranslatableFormFieldWrapper
                            control={form.control}
                            name="name"
                            label={<Trans>Name</Trans>}
                            render={({ field }) => <Input placeholder="" {...field} />}
                        />
                        <FormFieldWrapper
                            control={form.control}
                            name="code"
                            label={<Trans>Code</Trans>}
                            render={({ field }) => <Input placeholder="" {...field} />}
                        />
                    </DetailFormGrid>
                </PageBlock>
                <CustomFieldsPageBlock column="main" entityType="Country" control={form.control} />
            </PageLayout>
        </Page>
    );
}
