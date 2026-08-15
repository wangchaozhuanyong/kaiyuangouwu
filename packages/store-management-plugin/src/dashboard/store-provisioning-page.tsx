import { useLingui } from '@lingui/react';
import {
    ActionBarItem,
    Alert,
    AlertDescription,
    Button,
    DashboardRouteDefinition,
    Input,
    Label,
    Page,
    PageActionBar,
    PageBlock,
    PageLayout,
    PageTitle,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Skeleton,
    api,
    toast,
    useMutation,
    useQuery,
} from '@vendure/dashboard';
import { CheckCircle2, ClipboardCopy, LoaderCircle, Plus, RefreshCw, Store } from 'lucide-react';
import { FormEvent, ReactNode, useState } from 'react';

import {
    ProvisionStoreResult,
    StoreTemplatesResult,
    provisionStoreMutation,
    storeTemplatesQuery,
} from './store-management.graphql';

interface StoreDraft {
    code: string;
    name: string;
    storefrontNameZh: string;
    storefrontNameEn: string;
    templateChannelId: string;
    firstName: string;
    lastName: string;
    emailAddress: string;
}

const emptyDraft: StoreDraft = {
    code: '',
    name: '',
    storefrontNameZh: '',
    storefrontNameEn: '',
    templateChannelId: '',
    firstName: '',
    lastName: '',
    emailAddress: '',
};

const zhCopy = {
    title: '开通网店',
    description: '创建独立网店、商家后台账号、权限角色和库存地点。',
    merchant: '商家与网店',
    merchantName: '商家名称',
    merchantPlaceholder: '例如：云桥贸易有限公司',
    code: '网店编码',
    codePlaceholder: '例如：yunqiao-store',
    chineseName: '网站中文名称',
    englishName: '网站英文名称',
    template: '配置模板',
    selectTemplate: '选择 Channel 模板',
    administrator: '后台管理员',
    firstName: '名',
    lastName: '姓',
    email: '登录邮箱',
    submit: '创建网店',
    submitting: '正在创建',
    loadError: '模板 Channel 加载失败',
    retry: '重试',
    required: '请完整填写所有字段',
    created: '网店已创建',
    credentialTitle: '管理员临时凭据',
    credentialDescription: '临时密码只显示这一次，请通过安全渠道交给管理员，并在首次登录后立即修改。',
    channelCode: 'Channel',
    temporaryPassword: '临时密码',
    copy: '复制临时密码',
    copied: '临时密码已复制',
    createAnother: '继续创建',
};

const enCopy: typeof zhCopy = {
    title: 'Provision store',
    description: 'Create an isolated store, merchant administrator, role, and stock location.',
    merchant: 'Merchant and store',
    merchantName: 'Merchant name',
    merchantPlaceholder: 'Example: Yunqiao Trading Ltd',
    code: 'Store code',
    codePlaceholder: 'Example: yunqiao-store',
    chineseName: 'Chinese storefront name',
    englishName: 'English storefront name',
    template: 'Configuration template',
    selectTemplate: 'Select a Channel template',
    administrator: 'Store administrator',
    firstName: 'First name',
    lastName: 'Last name',
    email: 'Login email',
    submit: 'Create store',
    submitting: 'Creating',
    loadError: 'Could not load template Channels',
    retry: 'Retry',
    required: 'Complete every field before continuing',
    created: 'Store created',
    credentialTitle: 'Temporary administrator credential',
    credentialDescription:
        'This password is shown once. Share it securely and change it immediately after the first login.',
    channelCode: 'Channel',
    temporaryPassword: 'Temporary password',
    copy: 'Copy temporary password',
    copied: 'Temporary password copied',
    createAnother: 'Create another',
};

export const storeProvisioningRoute: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'system',
        id: 'store-provisioning',
        url: '/store-provisioning',
        title: '开通网店',
        icon: Store,
        requiresPermission: ['SuperAdmin'],
    },
    path: '/store-provisioning',
    loader: () => ({ breadcrumb: () => '开通网店' }),
    component: () => <StoreProvisioningPage />,
};

function StoreProvisioningPage() {
    const { i18n } = useLingui();
    const text = i18n.locale.toLowerCase().startsWith('zh') ? zhCopy : enCopy;
    const [draft, setDraft] = useState<StoreDraft>(emptyDraft);
    const [result, setResult] = useState<ProvisionStoreResult['provisionStore'] | null>(null);
    const templatesQuery = useQuery({
        queryKey: ['store-provisioning-templates'],
        queryFn: () => api.query(storeTemplatesQuery) as Promise<StoreTemplatesResult>,
    });
    const templates = templatesQuery.data?.channels.items ?? [];
    const mutation = useMutation({
        mutationFn: (input: StoreDraft) =>
            api.mutate(provisionStoreMutation, {
                input: {
                    code: input.code,
                    name: input.name,
                    storefrontNameZh: input.storefrontNameZh,
                    storefrontNameEn: input.storefrontNameEn,
                    templateChannelId: input.templateChannelId,
                    administrator: {
                        firstName: input.firstName,
                        lastName: input.lastName,
                        emailAddress: input.emailAddress,
                    },
                },
            }) as Promise<ProvisionStoreResult>,
        onSuccess: response => {
            setResult(response.provisionStore);
            toast.success(text.created);
        },
        onError: error => toast.error(errorMessage(error)),
    });

    const setField = (field: keyof StoreDraft, value: string) =>
        setDraft(current => ({ ...current, [field]: value }));
    const submit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (Object.values(draft).some(value => !value.trim())) {
            toast.error(text.required);
            return;
        }
        mutation.mutate(draft);
    };

    return (
        <Page pageId="store-provisioning">
            <PageTitle>{text.title}</PageTitle>
            <PageActionBar>
                {!result && (
                    <ActionBarItem itemId="create-store">
                        <Button type="submit" form="store-provisioning-form" disabled={mutation.isPending}>
                            {mutation.isPending ? (
                                <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                            ) : (
                                <Plus className="size-4" aria-hidden="true" />
                            )}
                            {mutation.isPending ? text.submitting : text.submit}
                        </Button>
                    </ActionBarItem>
                )}
            </PageActionBar>
            {!result && <form id="store-provisioning-form" onSubmit={submit} />}
            <PageLayout>
                {result ? (
                    <PageBlock
                        column="full"
                        blockId="store-provisioning-result"
                        title={text.credentialTitle}
                        description={text.credentialDescription}
                    >
                        <Alert>
                            <CheckCircle2 className="size-4" aria-hidden="true" />
                            <AlertDescription>{text.created}</AlertDescription>
                        </Alert>
                        <dl className="mt-6 grid gap-5 md:grid-cols-2">
                            <Credential label={text.channelCode} value={result.channelCode} />
                            <Credential label={text.temporaryPassword} value={result.temporaryPassword} />
                        </dl>
                        <div className="mt-6 flex flex-wrap gap-2">
                            <Button
                                type="button"
                                onClick={() => {
                                    void navigator.clipboard.writeText(result.temporaryPassword);
                                    toast.success(text.copied);
                                }}
                            >
                                <ClipboardCopy className="size-4" aria-hidden="true" />
                                {text.copy}
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => {
                                    setDraft(emptyDraft);
                                    setResult(null);
                                }}
                            >
                                <Plus className="size-4" aria-hidden="true" />
                                {text.createAnother}
                            </Button>
                        </div>
                    </PageBlock>
                ) : (
                    <>
                        <PageBlock
                            column="full"
                            blockId="store-provisioning-merchant"
                            title={text.merchant}
                            description={text.description}
                        >
                            <div className="grid gap-5 md:grid-cols-2">
                                <Field label={text.merchantName} htmlFor="store-merchant-name">
                                    <Input
                                        id="store-merchant-name"
                                        form="store-provisioning-form"
                                        value={draft.name}
                                        placeholder={text.merchantPlaceholder}
                                        maxLength={80}
                                        required
                                        onChange={event => setField('name', event.target.value)}
                                    />
                                </Field>
                                <Field label={text.code} htmlFor="store-code">
                                    <Input
                                        id="store-code"
                                        form="store-provisioning-form"
                                        value={draft.code}
                                        placeholder={text.codePlaceholder}
                                        maxLength={48}
                                        required
                                        autoCapitalize="none"
                                        spellCheck={false}
                                        onChange={event => setField('code', event.target.value)}
                                    />
                                </Field>
                                <Field label={text.chineseName} htmlFor="store-name-zh">
                                    <Input
                                        id="store-name-zh"
                                        form="store-provisioning-form"
                                        value={draft.storefrontNameZh}
                                        required
                                        onChange={event => setField('storefrontNameZh', event.target.value)}
                                    />
                                </Field>
                                <Field label={text.englishName} htmlFor="store-name-en">
                                    <Input
                                        id="store-name-en"
                                        form="store-provisioning-form"
                                        value={draft.storefrontNameEn}
                                        required
                                        onChange={event => setField('storefrontNameEn', event.target.value)}
                                    />
                                </Field>
                                <Field label={text.template} htmlFor="store-template">
                                    {templatesQuery.isPending ? (
                                        <Skeleton className="h-9 w-full" />
                                    ) : templatesQuery.isError ? (
                                        <Alert variant="destructive">
                                            <AlertDescription className="flex items-center justify-between gap-3">
                                                <span>{text.loadError}</span>
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => void templatesQuery.refetch()}
                                                >
                                                    <RefreshCw className="size-4" aria-hidden="true" />
                                                    {text.retry}
                                                </Button>
                                            </AlertDescription>
                                        </Alert>
                                    ) : (
                                        <Select
                                            value={draft.templateChannelId}
                                            onValueChange={value =>
                                                value && setField('templateChannelId', value)
                                            }
                                        >
                                            <SelectTrigger id="store-template" className="w-full">
                                                <SelectValue placeholder={text.selectTemplate} />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {templates.map(template => (
                                                    <SelectItem key={template.id} value={template.id}>
                                                        {template.code} · {template.defaultCurrencyCode} ·{' '}
                                                        {template.defaultLanguageCode}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    )}
                                </Field>
                            </div>
                        </PageBlock>
                        <PageBlock
                            column="full"
                            blockId="store-provisioning-administrator"
                            title={text.administrator}
                        >
                            <div className="grid gap-5 md:grid-cols-3">
                                <Field label={text.firstName} htmlFor="store-admin-first-name">
                                    <Input
                                        id="store-admin-first-name"
                                        form="store-provisioning-form"
                                        value={draft.firstName}
                                        maxLength={50}
                                        required
                                        autoComplete="off"
                                        onChange={event => setField('firstName', event.target.value)}
                                    />
                                </Field>
                                <Field label={text.lastName} htmlFor="store-admin-last-name">
                                    <Input
                                        id="store-admin-last-name"
                                        form="store-provisioning-form"
                                        value={draft.lastName}
                                        maxLength={50}
                                        required
                                        autoComplete="off"
                                        onChange={event => setField('lastName', event.target.value)}
                                    />
                                </Field>
                                <Field label={text.email} htmlFor="store-admin-email">
                                    <Input
                                        id="store-admin-email"
                                        form="store-provisioning-form"
                                        type="email"
                                        value={draft.emailAddress}
                                        maxLength={254}
                                        required
                                        autoCapitalize="none"
                                        autoComplete="off"
                                        onChange={event => setField('emailAddress', event.target.value)}
                                    />
                                </Field>
                            </div>
                        </PageBlock>
                    </>
                )}
            </PageLayout>
        </Page>
    );
}

function Field({
    label,
    htmlFor,
    children,
}: Readonly<{ label: string; htmlFor: string; children: ReactNode }>) {
    return (
        <div className="space-y-2">
            <Label htmlFor={htmlFor}>{label}</Label>
            {children}
        </div>
    );
}

function Credential({ label, value }: Readonly<{ label: string; value: string }>) {
    return (
        <div className="min-w-0">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="mt-1 break-all font-mono text-sm">{value}</dd>
        </div>
    );
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
