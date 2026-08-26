import { ChannelCodeLabel } from '@/vdb/components/shared/channel-code-label.js';
import { CurrencySelector } from '@/vdb/components/shared/currency-selector.js';
import { ErrorPage } from '@/vdb/components/shared/error-page.js';
import { FormFieldWrapper } from '@/vdb/components/shared/form-field-wrapper.js';
import { LanguageSelector } from '@/vdb/components/shared/language-selector.js';
import { SellerSelector } from '@/vdb/components/shared/seller-selector.js';
import { ZoneSelector } from '@/vdb/components/shared/zone-selector.js';
import { Alert, AlertDescription, AlertTitle } from '@/vdb/components/ui/alert.js';
import { Badge } from '@/vdb/components/ui/badge.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Input } from '@/vdb/components/ui/input.js';
import { Switch } from '@/vdb/components/ui/switch.js';
import { DEFAULT_CHANNEL_CODE, NEW_ENTITY_PATH } from '@/vdb/constants.js';
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
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { z } from '@/vdb/lib/zod.js';
import { supportedStorefrontLanguageCodes } from '@/vdb/utils/supported-storefront-languages.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { CheckCircle2, Circle, ClipboardCopy, Globe2, Store } from 'lucide-react';
import { toast } from 'sonner';
import { uiConfig } from 'virtual:vendure-ui-config';
import { channelDetailDocument, createChannelDocument, updateChannelDocument } from './channels.graphql.js';

const pageId = 'channel-detail';

export const Route = createFileRoute('/_authenticated/_channels/channels_/$id')({
    component: ChannelDetailPage,
    loader: detailPageRouteLoader({
        pageId,
        queryDocument: channelDetailDocument,
        breadcrumb(isNew, entity) {
            return [
                { path: '/channels', label: <Trans>Stores</Trans> },
                isNew ? <Trans>Create store</Trans> : <ChannelCodeLabel code={entity?.code ?? ''} />,
            ];
        },
    }),
    errorComponent: ({ error }) => <ErrorPage message={error.message} />,
});

function ChannelDetailPage() {
    const params = Route.useParams();
    const navigate = useNavigate();
    const creatingNewEntity = params.id === NEW_ENTITY_PATH;
    const { t } = useLingui();
    const { refreshChannels } = useChannel();

    const { form, submitHandler, entity, isPending, resetForm } = useDetailPage({
        pageId,
        queryDocument: channelDetailDocument,
        createDocument: createChannelDocument,
        updateDocument: updateChannelDocument,
        setValuesForUpdate: entity => {
            return {
                id: entity.id,
                code: entity.code,
                token: entity.token,
                pricesIncludeTax: entity.pricesIncludeTax,
                availableCurrencyCodes: entity.availableCurrencyCodes,
                availableLanguageCodes: [...supportedStorefrontLanguageCodes],
                defaultCurrencyCode: entity.defaultCurrencyCode,
                defaultLanguageCode: entity.defaultLanguageCode,
                defaultShippingZoneId: entity.defaultShippingZone?.id,
                defaultTaxZoneId: entity.defaultTaxZone?.id,
                sellerId: entity.seller?.id,
                customFields: entity.customFields,
            };
        },
        transformCreateInput: input => {
            return {
                ...input,
                currencyCode: undefined,
                availableLanguageCodes: [...supportedStorefrontLanguageCodes],
            };
        },
        transformUpdateInput: input => {
            return {
                ...input,
                availableLanguageCodes: [...supportedStorefrontLanguageCodes],
            };
        },
        // The generated schema is derived from the GraphQL input type, which only tells us about
        // nullability — `String!` still permits '', an unfilled `ID!` relation is seeded with '',
        // and a nullable field can still be required by the server. None of those make a valid
        // channel, so the fields the user must actually supply are declared here.
        //
        // These are only enforced on create: `UpdateChannelInput` makes every field optional and
        // omits what isn't sent, so an update may legitimately touch just one field.
        extendSchema: schema =>
            schema
                .extend({
                    code: z.string().min(1, { message: t`This field is required` }),
                    token: z.string().min(1, { message: t`This field is required` }),
                    ...(creatingNewEntity
                        ? {
                              defaultTaxZoneId: z.string().min(1, { message: t`This field is required` }),
                              defaultShippingZoneId: z
                                  .string()
                                  .min(1, { message: t`This field is required` }),
                          }
                        : {}),
                })
                // The currency pair is checked together, because whether a default is valid depends
                // entirely on the available list it has to come from. `defaultCurrencyCode` is
                // nullable in the schema but ChannelService.create throws a raw UserInputError
                // unless it is given (this page always sends `currencyCode: undefined`), and a
                // supplied available list is saved verbatim without checking it contains the
                // default — so both halves have to be caught here.
                //
                // Unlike the fields above this is not limited to create: an existing channel always
                // has both, so an update can only reach these states by actively breaking them.
                .superRefine((values, ctx) => {
                    const available: string[] = values.availableCurrencyCodes ?? [];
                    const addIssue = (path: string, message: string) =>
                        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });

                    if (!available.length) {
                        // Nothing is available, so the default cannot be filled in yet — say so on
                        // both fields rather than only on the one that happens to be required.
                        addIssue(
                            'availableCurrencyCodes',
                            t`You must select at least one available currency`,
                        );
                        addIssue(
                            'defaultCurrencyCode',
                            t`You must first select an available currency to set a default currency`,
                        );
                    } else if (!available.includes(values.defaultCurrencyCode as string)) {
                        // There is a list to pick from: either nothing was picked, or the list was
                        // narrowed afterwards and dropped the default.
                        addIssue(
                            'defaultCurrencyCode',
                            t`You must select a default currency from the list of available currencies`,
                        );
                    }
                }),
        params: { id: params.id },
        onSuccess: async data => {
            if (data.__typename === 'Channel') {
                toast(creatingNewEntity ? t`Store created` : t`Store settings updated`);
                refreshChannels();
                resetForm();
                if (creatingNewEntity) {
                    await navigate({ to: `../$id`, params: { id: data.id } });
                }
            } else {
                toast(creatingNewEntity ? t`Could not create store` : t`Could not update store`, {
                    description: data.message,
                });
            }
        },
        onError: err => {
            toast(creatingNewEntity ? t`Could not create store` : t`Could not update store`, {
                description: err instanceof Error ? err.message : t`Unknown error`,
            });
        },
    });

    const availableCurrencyCodes = form.watch('availableCurrencyCodes');
    const storeCode = form.watch('code');
    const storeToken = form.watch('token');
    const defaultCurrencyCode = form.watch('defaultCurrencyCode');
    const defaultLanguageCode = form.watch('defaultLanguageCode');
    const defaultTaxZoneId = form.watch('defaultTaxZoneId');
    const defaultShippingZoneId = form.watch('defaultShippingZoneId');

    const codeIsDefault = entity?.code === DEFAULT_CHANNEL_CODE;
    const setupSteps = [
        {
            label: t`Store identity`,
            complete: Boolean(storeCode && storeToken),
        },
        {
            label: t`Currency and content language`,
            complete: Boolean(defaultCurrencyCode && defaultLanguageCode),
        },
        {
            label: t`Delivery and tax regions`,
            complete: Boolean(defaultTaxZoneId && defaultShippingZoneId),
        },
    ];

    const copyStoreToken = async () => {
        if (!storeToken) {
            return;
        }
        await navigator.clipboard.writeText(storeToken);
        toast.success(t`Store API token copied`);
    };

    return (
        <Page pageId={pageId} form={form} submitHandler={submitHandler} entity={entity}>
            <PageTitle>
                {creatingNewEntity ? (
                    <Trans>Create store</Trans>
                ) : (
                    <ChannelCodeLabel code={entity?.code ?? ''} />
                )}
            </PageTitle>
            <PageActionBar>
                <ActionBarItem itemId="save-button" requiresPermission={['UpdateChannel']}>
                    {/*
                     * Deliberately not gated on `formState.isValid`: with required fields, an
                     * untouched invalid form would leave the button disabled with no indication
                     * of why. `submitHandler` validates and bails, surfacing inline field errors.
                     */}
                    <Button type="submit" disabled={!form.formState.isDirty || isPending}>
                        {creatingNewEntity ? <Trans>Create</Trans> : <Trans>Update</Trans>}
                    </Button>
                </ActionBarItem>
            </PageActionBar>
            <PageLayout>
                <PageBlock
                    column="main"
                    blockId="main-form"
                    title={<Trans>Store identity</Trans>}
                    description={<Trans>Set the internal identity used to distinguish this store.</Trans>}
                >
                    <DetailFormGrid>
                        <FormFieldWrapper
                            control={form.control}
                            name="code"
                            label={<Trans>Store code</Trans>}
                            description={<Trans>Use a stable short code, such as cn-mainland.</Trans>}
                            render={({ field }) => (
                                <Input placeholder="" {...field} disabled={codeIsDefault} />
                            )}
                        />
                        <FormFieldWrapper
                            control={form.control}
                            name="token"
                            label={<Trans>Store API token</Trans>}
                            description={
                                <Trans>
                                    The storefront sends this token with API requests to select this store.
                                </Trans>
                            }
                            render={({ field }) => <Input placeholder="" {...field} />}
                        />
                        <FormFieldWrapper
                            control={form.control}
                            name="sellerId"
                            label={<Trans>Operating entity</Trans>}
                            description={
                                <Trans>
                                    Optional. Use this when the store belongs to a specific merchant.
                                </Trans>
                            }
                            render={({ field }) => (
                                <SellerSelector value={field.value ?? ''} onChange={field.onChange} />
                            )}
                        />
                        <FormFieldWrapper
                            control={form.control}
                            name="availableLanguageCodes"
                            label={<Trans>Supported content languages</Trans>}
                            description={
                                <Trans>
                                    The storefront can serve these languages. Editors enter Chinese and
                                    English is generated on save.
                                </Trans>
                            }
                            render={({ field }) => (
                                <LanguageSelector
                                    value={[...supportedStorefrontLanguageCodes]}
                                    onChange={field.onChange}
                                    multiple={true}
                                    disabled={true}
                                />
                            )}
                        />
                        <FormFieldWrapper
                            control={form.control}
                            name="availableCurrencyCodes"
                            label={<Trans>Supported currencies</Trans>}
                            description={<Trans>The default currency is chosen from this list.</Trans>}
                            render={({ field }) => (
                                <CurrencySelector
                                    value={field.value ?? []}
                                    onChange={field.onChange}
                                    multiple={true}
                                />
                            )}
                        />
                    </DetailFormGrid>
                </PageBlock>
                <PageBlock
                    column="main"
                    blockId="channel-defaults"
                    title={<Trans>Market and content defaults</Trans>}
                    description={
                        <Trans>
                            These defaults apply when the storefront does not specify a language or currency.
                        </Trans>
                    }
                >
                    <DetailFormGrid>
                        <FormFieldWrapper
                            control={form.control}
                            name="defaultLanguageCode"
                            label={<Trans>Default content language</Trans>}
                            render={({ field }) => (
                                <LanguageSelector
                                    value={field.value ?? ''}
                                    onChange={field.onChange}
                                    multiple={false}
                                    // Unlike the currency below, this cannot narrow to an empty
                                    // available list: `defaultLanguageCode` is non-nullable and
                                    // pre-filled from the active channel, so an empty list would
                                    // leave a required field showing a value its own selector no
                                    // longer offers. The current value is always included for the
                                    // same reason — it is submitted as available regardless.
                                    availableLanguageCodes={[...supportedStorefrontLanguageCodes]}
                                />
                            )}
                        />
                        <FormFieldWrapper
                            control={form.control}
                            name="defaultCurrencyCode"
                            label={<Trans>Settlement currency</Trans>}
                            render={({ field }) => (
                                <CurrencySelector
                                    value={field.value ?? ''}
                                    onChange={field.onChange}
                                    multiple={false}
                                    // The available currencies are the only currencies to pick
                                    // from, including none at all: with an empty list this
                                    // selector is deliberately empty, so a default cannot be
                                    // chosen before the list it must belong to.
                                    availableCurrencyCodes={availableCurrencyCodes ?? []}
                                />
                            )}
                        />
                    </DetailFormGrid>
                </PageBlock>
                <PageBlock
                    column="main"
                    blockId="store-regions"
                    title={<Trans>Delivery and tax</Trans>}
                    description={
                        <Trans>Set the default service regions and how catalog prices handle tax.</Trans>
                    }
                >
                    <DetailFormGrid>
                        <FormFieldWrapper
                            control={form.control}
                            name="defaultTaxZoneId"
                            label={<Trans>Default tax region</Trans>}
                            render={({ field }) => (
                                <ZoneSelector value={field.value ?? ''} onChange={field.onChange} />
                            )}
                        />
                        <FormFieldWrapper
                            control={form.control}
                            name="defaultShippingZoneId"
                            label={<Trans>Default delivery region</Trans>}
                            render={({ field }) => (
                                <ZoneSelector value={field.value ?? ''} onChange={field.onChange} />
                            )}
                        />
                        <FormFieldWrapper
                            control={form.control}
                            name="pricesIncludeTax"
                            label={<Trans>Catalog prices include tax</Trans>}
                            description={
                                <Trans>
                                    When enabled, prices entered for this store already include tax for the
                                    default tax region.
                                </Trans>
                            }
                            render={({ field }) => (
                                <Switch checked={field.value ?? false} onCheckedChange={field.onChange} />
                            )}
                        />
                    </DetailFormGrid>
                </PageBlock>
                <PageBlock
                    column="side"
                    blockId="store-setup-progress"
                    title={<Trans>Store setup</Trans>}
                    description={<Trans>Complete the required information before creating the store.</Trans>}
                >
                    <div className="space-y-3">
                        {setupSteps.map(step => (
                            <div key={step.label} className="flex items-center gap-2.5 text-sm">
                                {step.complete ? (
                                    <CheckCircle2
                                        className="size-4 shrink-0 text-success-text"
                                        aria-hidden="true"
                                    />
                                ) : (
                                    <Circle
                                        className="size-4 shrink-0 text-muted-foreground"
                                        aria-hidden="true"
                                    />
                                )}
                                <span className={step.complete ? 'font-medium' : 'text-muted-foreground'}>
                                    {step.label}
                                </span>
                            </div>
                        ))}
                    </div>
                </PageBlock>
                <PageBlock
                    column="side"
                    blockId="storefront-connection"
                    title={<Trans>Storefront connection</Trans>}
                    description={
                        <Trans>
                            Use the store token only for local development or compatibility integrations.
                        </Trans>
                    }
                >
                    <Alert className="mb-4">
                        <Globe2 aria-hidden="true" />
                        <AlertTitle>
                            <Trans>Verified domains select the store automatically</Trans>
                        </AlertTitle>
                        <AlertDescription>
                            <Trans>
                                Clients using a verified custom domain do not need to send this token.
                            </Trans>
                        </AlertDescription>
                    </Alert>
                    <div className="space-y-2">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Store className="size-3.5" aria-hidden="true" />
                            <Trans>API request header</Trans>
                        </div>
                        <div className="rounded-md border bg-muted/40 p-3 font-mono text-xs">
                            <div className="text-muted-foreground">{uiConfig.api.channelTokenKey}</div>
                            <div className="mt-1 break-all text-foreground">
                                {storeToken || t`Enter a store token first`}
                            </div>
                        </div>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="w-full"
                            disabled={!storeToken}
                            onClick={() => void copyStoreToken()}
                        >
                            <ClipboardCopy className="size-4" aria-hidden="true" />
                            <Trans>Copy store token</Trans>
                        </Button>
                        {entity && (
                            <Badge variant="outline" className="mt-2">
                                <Trans>Store ID: {entity.id}</Trans>
                            </Badge>
                        )}
                    </div>
                </PageBlock>
                <CustomFieldsPageBlock column="main" entityType="Channel" control={form.control} />
            </PageLayout>
        </Page>
    );
}
