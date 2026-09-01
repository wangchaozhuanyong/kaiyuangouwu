/* eslint-disable max-len -- Tailwind utility lists are intentionally kept as single JSX attributes. */
import { useMutation, useQuery } from '@apollo/client/react';
import {
    AlertCircle,
    Check,
    ChevronLeft,
    ChevronRight,
    CircleUserRound,
    Clock3,
    Edit3,
    LoaderCircle,
    MapPin,
    Plus,
    RefreshCw,
    Search,
    ShoppingBag,
    Tag,
    Trash2,
    UserCheck,
    Users,
    X,
} from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { sensitiveActionContext } from '../../apollo';
import { useConfirmDialog } from '../../components/confirm-dialog-context';
import {
    ADD_CUSTOMER_NOTE_MUTATION,
    ADD_CUSTOMER_TO_GROUP_MUTATION,
    CREATE_CUSTOMER_ADDRESS_MUTATION,
    CREATE_CUSTOMER_GROUP_MUTATION,
    CUSTOMERS_QUERY,
    CUSTOMER_ADDRESS_COUNTRIES_QUERY,
    CUSTOMER_DETAIL_QUERY,
    CUSTOMER_GROUPS_QUERY,
    CUSTOMER_GROUP_MEMBERS_QUERY,
    CustomerAddressCountriesResult,
    CustomerAddressRecord,
    CustomerDetailResult,
    CustomerGroupMembersResult,
    CustomerGroupRecord,
    CustomerGroupsResult,
    CustomerListRecord,
    CustomersResult,
    DELETE_CUSTOMER_ADDRESS_MUTATION,
    DELETE_CUSTOMER_GROUP_MUTATION,
    REMOVE_CUSTOMER_FROM_GROUP_MUTATION,
    UPDATE_CUSTOMER_ADDRESS_MUTATION,
    UPDATE_CUSTOMER_GROUP_MUTATION,
    UPDATE_CUSTOMER_MUTATION,
} from '../../graphql/customers.graphql';
import { useAccessibleDialog } from '../../hooks/use-accessible-dialog';
import { useAdminPermissions } from '../../hooks/use-admin-permissions';
import { useUrlListState } from '../../hooks/use-url-list-state';
import { toUserFacingError } from '../../utils/user-facing-error';
import {
    formatDateTime,
    formatMoney,
    getMutationError,
    getOrderStateClass,
    getOrderStateLabel,
} from '../Sales/sales-utils';

const PAGE_SIZE = 20;

interface CustomerForm {
    title: string;
    firstName: string;
    lastName: string;
    emailAddress: string;
    phoneNumber: string;
}

const emptyCustomerForm: CustomerForm = {
    title: '',
    firstName: '',
    lastName: '',
    emailAddress: '',
    phoneNumber: '',
};

interface CustomerAddressForm {
    fullName: string;
    company: string;
    streetLine1: string;
    streetLine2: string;
    city: string;
    province: string;
    postalCode: string;
    countryCode: string;
    phoneNumber: string;
    defaultShippingAddress: boolean;
    defaultBillingAddress: boolean;
}

const emptyCustomerAddressForm: CustomerAddressForm = {
    fullName: '',
    company: '',
    streetLine1: '',
    streetLine2: '',
    city: '',
    province: '',
    postalCode: '',
    countryCode: '',
    phoneNumber: '',
    defaultShippingAddress: false,
    defaultBillingAddress: false,
};

function addressToForm(address: CustomerAddressRecord | null): CustomerAddressForm {
    if (!address) return emptyCustomerAddressForm;
    return {
        fullName: address.fullName ?? '',
        company: address.company ?? '',
        streetLine1: address.streetLine1,
        streetLine2: address.streetLine2 ?? '',
        city: address.city ?? '',
        province: address.province ?? '',
        postalCode: address.postalCode ?? '',
        countryCode: address.country?.code ?? '',
        phoneNumber: address.phoneNumber ?? '',
        defaultShippingAddress: Boolean(address.defaultShippingAddress),
        defaultBillingAddress: Boolean(address.defaultBillingAddress),
    };
}

function addressInput(form: CustomerAddressForm) {
    return {
        fullName: form.fullName.trim() || null,
        company: form.company.trim() || null,
        streetLine1: form.streetLine1.trim(),
        streetLine2: form.streetLine2.trim() || null,
        city: form.city.trim() || null,
        province: form.province.trim() || null,
        postalCode: form.postalCode.trim() || null,
        countryCode: form.countryCode,
        phoneNumber: form.phoneNumber.trim() || null,
        defaultShippingAddress: form.defaultShippingAddress,
        defaultBillingAddress: form.defaultBillingAddress,
    };
}

function customerName(customer: Pick<CustomerListRecord, 'firstName' | 'lastName' | 'emailAddress'>) {
    return [customer.lastName, customer.firstName].filter(Boolean).join('') || customer.emailAddress;
}

function customerFilter(searchTerm: string) {
    const value = searchTerm.trim();
    if (!value) return undefined;
    return {
        _or: [
            { firstName: { contains: value } },
            { lastName: { contains: value } },
            { phoneNumber: { contains: value } },
            { emailAddress: { contains: value } },
        ],
    };
}

function errorText(error: unknown) {
    return toUserFacingError(error, '操作失败，请稍后重试');
}

export function CustomersModule() {
    const navigate = useNavigate();
    const { page, searchParams, searchTerm, setFilter, setPage, setSearchTerm } = useUrlListState();
    const selectedGroupId = searchParams.get('group') ?? 'ALL';
    const setSelectedGroupId = (groupId: string) => setFilter('group', groupId, 'ALL');
    const deferredSearchTerm = useDeferredValue(searchTerm);
    const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
    const [groupManagerOpen, setGroupManagerOpen] = useState(false);
    const [notice, setNotice] = useState('');
    const [actionError, setActionError] = useState('');
    const loadingAllGroupsRef = useRef(false);

    const options = useMemo(
        () => ({
            skip: page * PAGE_SIZE,
            take: PAGE_SIZE,
            sort: { createdAt: 'DESC' },
            filter: customerFilter(deferredSearchTerm),
        }),
        [deferredSearchTerm, page],
    );

    const allCustomers = useQuery<CustomersResult>(CUSTOMERS_QUERY, {
        variables: { options },
        skip: selectedGroupId !== 'ALL',
        fetchPolicy: 'cache-first',
    });
    const groupCustomers = useQuery<CustomerGroupMembersResult>(CUSTOMER_GROUP_MEMBERS_QUERY, {
        variables: { id: selectedGroupId, options },
        skip: selectedGroupId === 'ALL',
        fetchPolicy: 'cache-first',
    });
    const groupQuery = useQuery<CustomerGroupsResult>(CUSTOMER_GROUPS_QUERY, {
        variables: { options: { skip: 0, take: 100, sort: { name: 'ASC' } } },
        fetchPolicy: 'cache-first',
    });
    const {
        data: groupData,
        error: groupError,
        fetchMore: fetchMoreGroups,
        loading: groupsLoading,
    } = groupQuery;

    useEffect(() => {
        const result = groupData?.customerGroups;
        if (!result || groupsLoading || groupError || loadingAllGroupsRef.current) return;
        const loadedCount = result.items.length;
        if (loadedCount >= result.totalItems) return;
        loadingAllGroupsRef.current = true;
        void fetchMoreGroups({
            variables: { options: { skip: loadedCount, take: 100, sort: { name: 'ASC' } } },
            updateQuery: (previous, { fetchMoreResult }) => ({
                customerGroups: {
                    ...fetchMoreResult.customerGroups,
                    items: [
                        ...new Map(
                            [...previous.customerGroups.items, ...fetchMoreResult.customerGroups.items].map(
                                group => [group.id, group],
                            ),
                        ).values(),
                    ],
                },
            }),
        })
            .catch(fetchError => {
                setActionError(toUserFacingError(fetchError, '客户分组未能全部加载'));
            })
            .finally(() => {
                loadingAllGroupsRef.current = false;
            });
    }, [fetchMoreGroups, groupData, groupError, groupsLoading]);

    const activeQuery = selectedGroupId === 'ALL' ? allCustomers : groupCustomers;
    const list =
        selectedGroupId === 'ALL'
            ? allCustomers.data?.customers
            : groupCustomers.data?.customerGroup?.customers;
    const groups = groupData?.customerGroups.items ?? [];
    const totalItems = list?.totalItems ?? 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));

    const refresh = async () => {
        setActionError('');
        await Promise.all([activeQuery.refetch(), groupQuery.refetch()]);
    };

    return (
        <div className="flex h-full flex-col bg-slate-50">
            <header className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 sm:px-8">
                <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 className="text-xl font-bold text-slate-900">客户管理</h1>
                        <p className="mt-1 text-xs text-slate-500">
                            客户资料、分组、地址、订单与内部跟进记录集中处理
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setGroupManagerOpen(true)}
                            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                        >
                            管理客户分组
                        </button>
                        <button
                            type="button"
                            onClick={() => void refresh()}
                            disabled={activeQuery.loading}
                            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                            <RefreshCw
                                className={`h-3.5 w-3.5 ${activeQuery.loading ? 'animate-spin' : ''}`}
                            />
                            刷新
                        </button>
                    </div>
                </div>
            </header>

            <main className="w-full max-w-none flex-1 space-y-4 overflow-y-auto p-5 sm:p-8">
                {notice && (
                    <StatusMessage kind="success" onClose={() => setNotice('')}>
                        {notice}
                    </StatusMessage>
                )}
                {actionError && (
                    <StatusMessage kind="error" onClose={() => setActionError('')}>
                        {actionError}
                    </StatusMessage>
                )}
                {groupQuery.error && (
                    <StatusMessage kind="error" onClose={() => void groupQuery.refetch()}>
                        客户分组读取失败，点击关闭后重试
                    </StatusMessage>
                )}

                <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div className="relative min-w-0 flex-1 lg:max-w-md">
                            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                            <input
                                value={searchTerm}
                                onChange={event => {
                                    setSearchTerm(event.target.value);
                                }}
                                aria-label="搜索客户"
                                placeholder="搜索姓名、手机号或邮箱"
                                className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-9 text-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                            />
                            {searchTerm && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setSearchTerm('');
                                    }}
                                    className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-700"
                                    aria-label="清空搜索"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            )}
                        </div>
                        <div className="flex max-w-full gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1 text-xs">
                            <GroupFilterButton
                                active={selectedGroupId === 'ALL'}
                                onClick={() => {
                                    setSelectedGroupId('ALL');
                                }}
                                label="全部客户"
                            />
                            {groups.map(group => (
                                <GroupFilterButton
                                    key={group.id}
                                    active={selectedGroupId === group.id}
                                    onClick={() => {
                                        setSelectedGroupId(group.id);
                                    }}
                                    label={`${group.name} ${group.customers.totalItems}`}
                                />
                            ))}
                        </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-[11px] text-slate-500">
                        <span>
                            当前条件共 <strong className="font-mono text-slate-900">{totalItems}</strong>{' '}
                            位客户
                        </span>
                        <span>列表只展示后端可核实字段，不推算虚假消费画像</span>
                    </div>
                </section>

                {activeQuery.loading && !list ? (
                    <LoadingState label="正在读取客户数据…" />
                ) : activeQuery.error ? (
                    <ErrorState
                        message={activeQuery.error.message}
                        onRetry={() => void activeQuery.refetch()}
                    />
                ) : !list?.items.length ? (
                    <EmptyState icon={Users} title="没有匹配的客户" detail="请调整关键词或客户分组后重试。" />
                ) : (
                    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[1640px] border-collapse text-left text-xs">
                                <thead className="border-b border-slate-200 bg-slate-50 font-bold text-slate-500">
                                    <tr>
                                        <th
                                            scope="col"
                                            className="sticky left-0 z-20 w-44 whitespace-nowrap bg-slate-50 px-3 py-3"
                                        >
                                            姓名
                                        </th>
                                        <th scope="col" className="w-56 whitespace-nowrap px-3 py-3">
                                            邮箱
                                        </th>
                                        <th scope="col" className="w-36 whitespace-nowrap px-3 py-3">
                                            手机
                                        </th>
                                        <th scope="col" className="w-28 whitespace-nowrap px-3 py-3">
                                            账号状态
                                        </th>
                                        <th scope="col" className="w-52 whitespace-nowrap px-3 py-3">
                                            客户分组
                                        </th>
                                        <th scope="col" className="w-28 whitespace-nowrap px-3 py-3">
                                            历史订单
                                        </th>
                                        <th scope="col" className="w-44 whitespace-nowrap px-3 py-3">
                                            最近订单号
                                        </th>
                                        <th scope="col" className="w-40 whitespace-nowrap px-3 py-3">
                                            最近下单时间
                                        </th>
                                        <th scope="col" className="w-40 whitespace-nowrap px-3 py-3">
                                            注册时间
                                        </th>
                                        <th
                                            scope="col"
                                            className="sticky right-0 z-20 w-28 whitespace-nowrap border-l border-slate-200 bg-slate-50 px-3 py-3 text-right"
                                        >
                                            操作
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 text-slate-700">
                                    {list.items.map(customer => {
                                        const latestOrder = customer.orders.items[0];
                                        return (
                                            <tr
                                                key={customer.id}
                                                className="group h-[52px] hover:bg-slate-50/80"
                                            >
                                                <td className="sticky left-0 z-10 h-[52px] max-w-44 bg-white px-3 py-0 group-hover:bg-slate-50">
                                                    <button
                                                        type="button"
                                                        onClick={() => setSelectedCustomerId(customer.id)}
                                                        className="block max-w-40 truncate whitespace-nowrap text-left font-bold text-slate-900 hover:text-blue-600"
                                                        title={customerName(customer)}
                                                    >
                                                        {customerName(customer)}
                                                    </button>
                                                </td>
                                                <td className="h-[52px] max-w-56 px-3 py-0">
                                                    <span
                                                        className="block truncate text-slate-600"
                                                        title={customer.emailAddress}
                                                    >
                                                        {customer.emailAddress || '-'}
                                                    </span>
                                                </td>
                                                <td className="h-[52px] max-w-36 px-3 py-0">
                                                    <span
                                                        className="block truncate font-mono text-[10px] text-slate-600"
                                                        title={customer.phoneNumber || undefined}
                                                    >
                                                        {customer.phoneNumber || '-'}
                                                    </span>
                                                </td>
                                                <td className="h-[52px] whitespace-nowrap px-3 py-0">
                                                    <StatusPill positive={Boolean(customer.user?.verified)}>
                                                        {customer.user?.verified ? '已验证' : '未验证'}
                                                    </StatusPill>
                                                </td>
                                                <td className="h-[52px] max-w-52 px-3 py-0">
                                                    <div className="flex max-w-48 items-center gap-1 whitespace-nowrap">
                                                        {customer.groups.length ? (
                                                            <>
                                                                <span
                                                                    className="block min-w-0 truncate rounded bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700"
                                                                    title={customer.groups[0].name}
                                                                >
                                                                    {customer.groups[0].name}
                                                                </span>
                                                                {customer.groups.length > 1 && (
                                                                    <span className="shrink-0 text-[10px] font-bold text-blue-700">
                                                                        +{customer.groups.length - 1}
                                                                    </span>
                                                                )}
                                                            </>
                                                        ) : (
                                                            <span className="text-slate-400">未分组</span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="h-[52px] whitespace-nowrap px-3 py-0 font-mono font-bold text-slate-900">
                                                    {customer.orders.totalItems} 笔
                                                </td>
                                                <td className="h-[52px] max-w-44 px-3 py-0">
                                                    {latestOrder ? (
                                                        <span
                                                            className="block truncate font-mono font-bold text-blue-600"
                                                            title={latestOrder.code}
                                                        >
                                                            {latestOrder.code}
                                                        </span>
                                                    ) : (
                                                        <span className="text-slate-400">尚未下单</span>
                                                    )}
                                                </td>
                                                <td className="h-[52px] whitespace-nowrap px-3 py-0 font-mono text-[10px] text-slate-500">
                                                    {latestOrder
                                                        ? formatDateTime(latestOrder.orderPlacedAt)
                                                        : '-'}
                                                </td>
                                                <td className="h-[52px] whitespace-nowrap px-3 py-0 font-mono text-[10px] text-slate-500">
                                                    {formatDateTime(customer.createdAt)}
                                                </td>
                                                <td className="sticky right-0 z-10 h-[52px] whitespace-nowrap border-l border-slate-100 bg-white px-3 py-0 text-right group-hover:bg-slate-50">
                                                    <button
                                                        type="button"
                                                        onClick={() => setSelectedCustomerId(customer.id)}
                                                        className="whitespace-nowrap rounded-lg bg-blue-50 px-3 py-1.5 text-[10px] font-bold text-blue-700 hover:bg-blue-100"
                                                    >
                                                        查看客户
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        <Pagination
                            page={page}
                            totalPages={totalPages}
                            totalItems={totalItems}
                            onPageChange={setPage}
                        />
                    </section>
                )}
            </main>

            <CustomerDrawer
                key={selectedCustomerId ?? 'closed'}
                customerId={selectedCustomerId}
                allGroups={groups}
                onClose={() => setSelectedCustomerId(null)}
                onChanged={async message => {
                    setNotice(message);
                    await refresh();
                }}
                onError={setActionError}
                onViewOrders={email => navigate(`/sales/orders?search=${encodeURIComponent(email)}`)}
                onViewOrder={id => navigate(`/sales/orders/${id}`)}
            />
            <GroupManager
                open={groupManagerOpen}
                groups={groups}
                onClose={() => setGroupManagerOpen(false)}
                onChanged={async message => {
                    setNotice(message);
                    await refresh();
                }}
                onError={setActionError}
            />
        </div>
    );
}

function CustomerDrawer({
    customerId,
    allGroups,
    onClose,
    onChanged,
    onError,
    onViewOrders,
    onViewOrder,
}: {
    customerId: string | null;
    allGroups: CustomerGroupRecord[];
    onClose: () => void;
    onChanged: (message: string) => Promise<void>;
    onError: (message: string) => void;
    onViewOrders: (email: string) => void;
    onViewOrder: (id: string) => void;
}) {
    const { data, loading, error, refetch } = useQuery<CustomerDetailResult>(CUSTOMER_DETAIL_QUERY, {
        variables: { id: customerId },
        skip: !customerId,
        fetchPolicy: 'cache-and-network',
    });
    const customer = data?.customer;
    const [editing, setEditing] = useState(false);
    const [formDraft, setFormDraft] = useState<CustomerForm | null>(null);
    const [note, setNote] = useState('');
    const [selectedGroup, setSelectedGroup] = useState('');
    const [addressEditor, setAddressEditor] = useState<CustomerAddressRecord | 'create' | null>(null);

    const { hasAnyPermission } = useAdminPermissions();
    const canCreateAddress = hasAnyPermission(['CreateCustomer']);
    const canUpdateCustomer = hasAnyPermission(['UpdateCustomer']);
    const canDeleteAddress = hasAnyPermission(['DeleteCustomer']);
    const requestConfirmation = useConfirmDialog();
    const countriesQuery = useQuery<CustomerAddressCountriesResult>(CUSTOMER_ADDRESS_COUNTRIES_QUERY, {
        skip: !addressEditor,
        fetchPolicy: 'cache-first',
    });

    const [updateCustomer, updateState] = useMutation(UPDATE_CUSTOMER_MUTATION);
    const [createAddress, createAddressState] = useMutation(CREATE_CUSTOMER_ADDRESS_MUTATION);
    const [updateAddress, updateAddressState] = useMutation(UPDATE_CUSTOMER_ADDRESS_MUTATION);
    const [deleteAddress, deleteAddressState] = useMutation(DELETE_CUSTOMER_ADDRESS_MUTATION);
    const [addNote, noteState] = useMutation(ADD_CUSTOMER_NOTE_MUTATION);
    const [addToGroup, addGroupState] = useMutation(ADD_CUSTOMER_TO_GROUP_MUTATION);
    const [removeFromGroup, removeGroupState] = useMutation(REMOVE_CUSTOMER_FROM_GROUP_MUTATION);
    const actionPending =
        updateState.loading ||
        noteState.loading ||
        addGroupState.loading ||
        removeGroupState.loading ||
        createAddressState.loading ||
        updateAddressState.loading ||
        deleteAddressState.loading;
    const { dialogRef: drawerDialogRef, titleId: drawerTitleId } = useAccessibleDialog(
        onClose,
        Boolean(customerId),
    );
    if (!customerId) return null;

    const form =
        formDraft ??
        (customer
            ? {
                  title: customer.title ?? '',
                  firstName: customer.firstName,
                  lastName: customer.lastName,
                  emailAddress: customer.emailAddress,
                  phoneNumber: customer.phoneNumber ?? '',
              }
            : emptyCustomerForm);

    const completedOrders = customer?.orders.items.filter(order => order.state !== 'Cancelled') ?? [];
    const totals = completedOrders.reduce((map, order) => {
        map.set(order.currencyCode, (map.get(order.currencyCode) ?? 0) + order.totalWithTax);
        return map;
    }, new Map<string, number>());
    const availableGroups = allGroups.filter(group => !customer?.groups.some(item => item.id === group.id));

    const saveCustomer = async () => {
        if (!customer || !form.emailAddress.trim()) return onError('邮箱不能为空');
        try {
            const result = await updateCustomer({
                variables: {
                    input: {
                        id: customer.id,
                        title: form.title.trim() || null,
                        firstName: form.firstName.trim(),
                        lastName: form.lastName.trim(),
                        emailAddress: form.emailAddress.trim(),
                        phoneNumber: form.phoneNumber.trim() || null,
                    },
                },
            });
            const payload = (
                result.data as { updateCustomer?: { __typename?: string; message?: string } } | undefined
            )?.updateCustomer;
            if (payload?.__typename !== 'Customer') throw new Error(getMutationError(payload));
            setEditing(false);
            setFormDraft(null);
            await refetch();
            await onChanged('客户资料已更新');
        } catch (mutationError) {
            onError(errorText(mutationError));
        }
    };
    const saveNote = async () => {
        if (!customer || !note.trim()) return onError('请先填写跟进内容');
        try {
            await addNote({ variables: { customerId: customer.id, note: note.trim() } });
            setNote('');
            await refetch();
            await onChanged('内部跟进记录已保存');
        } catch (mutationError) {
            onError(errorText(mutationError));
        }
    };
    const changeGroup = async (kind: 'add' | 'remove', groupId: string) => {
        if (!customer) return;
        try {
            const mutation = kind === 'add' ? addToGroup : removeFromGroup;
            await mutation({ variables: { customerId: customer.id, groupId } });
            setSelectedGroup('');
            await refetch();
            await onChanged(kind === 'add' ? '客户已加入分组' : '客户已移出分组');
        } catch (mutationError) {
            onError(errorText(mutationError));
        }
    };
    const saveAddress = async (addressForm: CustomerAddressForm) => {
        if (!customer || !addressEditor) return;
        if (!addressForm.streetLine1.trim()) return onError('请填写详细地址');
        if (!addressForm.countryCode) return onError('请选择国家或地区');
        try {
            if (addressEditor === 'create') {
                await createAddress({
                    variables: { customerId: customer.id, input: addressInput(addressForm) },
                });
            } else {
                await updateAddress({
                    variables: {
                        input: { id: addressEditor.id, ...addressInput(addressForm) },
                    },
                });
            }
            setAddressEditor(null);
            await refetch();
            await onChanged(addressEditor === 'create' ? '客户地址已新增' : '客户地址已更新');
        } catch (mutationError) {
            onError(errorText(mutationError));
        }
    };
    const removeAddress = async (address: CustomerAddressRecord) => {
        const confirmed = await requestConfirmation({
            title: '删除客户地址？',
            description: `将删除「${address.fullName || customerName(customer!)}」的这条地址。该操作无法撤销。`,
            confirmLabel: '删除地址',
            tone: 'danger',
        });
        if (!confirmed) return;
        try {
            const result = await deleteAddress({ variables: { id: address.id } });
            const success = (result.data as { deleteCustomerAddress?: { success?: boolean } } | undefined)
                ?.deleteCustomerAddress?.success;
            if (!success) throw new Error('后端未确认地址已删除');
            await refetch();
            await onChanged('客户地址已删除');
        } catch (mutationError) {
            onError(errorText(mutationError));
        }
    };

    return (
        <>
            <button
                type="button"
                className="fixed inset-0 z-40 cursor-default bg-slate-900/40 backdrop-blur-2xs"
                onClick={onClose}
                aria-label="关闭客户详情"
            />
            <aside
                ref={drawerDialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={drawerTitleId}
                tabIndex={-1}
                className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col border-l border-slate-200 bg-white shadow-2xl outline-none"
            >
                <div className="flex shrink-0 items-start justify-between border-b border-slate-200 bg-slate-50 px-5 py-4">
                    <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-600 font-bold text-white">
                            {customer ? customerName(customer).slice(0, 1) : '客'}
                        </div>
                        <div className="min-w-0">
                            <h2 id={drawerTitleId} className="truncate text-base font-bold text-slate-900">
                                {customer ? customerName(customer) : '客户详情'}
                            </h2>
                            <p className="truncate text-[11px] text-slate-500">
                                {customer?.emailAddress ?? '正在读取…'}
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                        aria-label="关闭"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-5">
                    {loading && !customer ? (
                        <LoadingState label="正在读取客户详情…" />
                    ) : error ? (
                        <ErrorState message={error.message} onRetry={() => void refetch()} />
                    ) : !customer ? (
                        <EmptyState
                            icon={CircleUserRound}
                            title="客户不存在"
                            detail="该客户可能已被删除或当前账号无权查看。"
                        />
                    ) : (
                        <div className="space-y-5">
                            <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                                <Metric label="历史订单" value={`${customer.orders.totalItems} 笔`} />
                                <Metric
                                    label="有效订单"
                                    value={`${completedOrders.length} 笔`}
                                    detail="最多统计最近100笔"
                                />
                                <Metric
                                    label="账号状态"
                                    value={customer.user?.verified ? '已验证' : '未验证'}
                                />
                                <Metric
                                    label="最近登录"
                                    value={
                                        customer.user?.lastLogin
                                            ? formatDateTime(customer.user.lastLogin)
                                            : '暂无'
                                    }
                                />
                            </section>
                            {totals.size > 0 && (
                                <section className="rounded-xl border border-blue-100 bg-blue-50/60 p-4">
                                    <h3 className="text-xs font-bold text-blue-900">历史有效订单金额</h3>
                                    <p className="mt-1 text-[10px] text-blue-700">
                                        按最近100笔订单汇总并排除已取消订单，不等同于财务实收
                                    </p>
                                    <div className="mt-3 flex flex-wrap gap-4">
                                        {Array.from(totals).map(([currency, amount]) => (
                                            <strong
                                                key={currency}
                                                className="font-mono text-base text-blue-900"
                                            >
                                                {formatMoney(amount, currency)}
                                            </strong>
                                        ))}
                                    </div>
                                </section>
                            )}
                            <section className="rounded-xl border border-slate-200 p-4">
                                <div className="mb-3 flex items-center justify-between">
                                    <h3 className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                                        <CircleUserRound className="h-4 w-4 text-blue-600" />
                                        基础资料
                                    </h3>
                                    {!editing && canUpdateCustomer && (
                                        <button
                                            type="button"
                                            onClick={() => setEditing(true)}
                                            className="flex items-center gap-1 text-[11px] font-bold text-blue-600 hover:underline"
                                        >
                                            <Edit3 className="h-3 w-3" />
                                            编辑
                                        </button>
                                    )}
                                </div>
                                {editing ? (
                                    <CustomerEditForm
                                        form={form}
                                        setForm={setFormDraft}
                                        pending={updateState.loading}
                                        onCancel={() => {
                                            setEditing(false);
                                            setFormDraft(null);
                                        }}
                                        onSave={() => void saveCustomer()}
                                    />
                                ) : (
                                    <div className="grid grid-cols-1 gap-x-5 gap-y-3 text-xs sm:grid-cols-2">
                                        <Field label="姓名" value={customerName(customer)} />
                                        <Field label="手机号" value={customer.phoneNumber || '未填写'} />
                                        <Field label="邮箱" value={customer.emailAddress} />
                                        <Field label="注册时间" value={formatDateTime(customer.createdAt)} />
                                    </div>
                                )}
                            </section>
                            <section className="rounded-xl border border-slate-200 p-4">
                                <h3 className="mb-3 flex items-center gap-1.5 text-xs font-bold text-slate-900">
                                    <Tag className="h-4 w-4 text-blue-600" />
                                    客户分组
                                </h3>
                                <div className="flex flex-wrap gap-2">
                                    {customer.groups.length ? (
                                        customer.groups.map(group => (
                                            <span
                                                key={group.id}
                                                className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-700"
                                            >
                                                {group.name}
                                                {canUpdateCustomer && (
                                                    <button
                                                        type="button"
                                                        onClick={() => void changeGroup('remove', group.id)}
                                                        disabled={actionPending}
                                                        className="text-blue-400 hover:text-rose-600"
                                                        aria-label={`移出${group.name}`}
                                                    >
                                                        <X className="h-3 w-3" />
                                                    </button>
                                                )}
                                            </span>
                                        ))
                                    ) : (
                                        <span className="text-xs text-slate-400">尚未加入任何分组</span>
                                    )}
                                </div>
                                {canUpdateCustomer && availableGroups.length > 0 && (
                                    <div className="mt-3 flex gap-2">
                                        <select
                                            value={selectedGroup}
                                            onChange={event => setSelectedGroup(event.target.value)}
                                            className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                                        >
                                            <option value="">选择要加入的分组</option>
                                            {availableGroups.map(group => (
                                                <option key={group.id} value={group.id}>
                                                    {group.name}
                                                </option>
                                            ))}
                                        </select>
                                        <button
                                            type="button"
                                            disabled={!selectedGroup || actionPending}
                                            onClick={() => void changeGroup('add', selectedGroup)}
                                            className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                                        >
                                            加入
                                        </button>
                                    </div>
                                )}
                            </section>
                            <section className="rounded-xl border border-slate-200 p-4">
                                <div className="mb-3 flex items-center justify-between gap-3">
                                    <h3 className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                                        <MapPin className="h-4 w-4 text-emerald-600" />
                                        客户地址
                                    </h3>
                                    {canCreateAddress && (
                                        <button
                                            type="button"
                                            onClick={() => setAddressEditor('create')}
                                            className="flex items-center gap-1 text-[11px] font-bold text-blue-600 hover:underline"
                                        >
                                            <Plus className="h-3 w-3" />
                                            新增地址
                                        </button>
                                    )}
                                </div>
                                <div className="space-y-2">
                                    {customer.addresses?.length ? (
                                        customer.addresses.map(address => (
                                            <div
                                                key={address.id}
                                                className="rounded-lg bg-slate-50 p-3 text-xs text-slate-700"
                                            >
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="flex flex-wrap items-center gap-2 font-bold text-slate-900">
                                                        <span>
                                                            {address.fullName || customerName(customer)}
                                                        </span>
                                                        <span>
                                                            {address.phoneNumber || customer.phoneNumber}
                                                        </span>
                                                        {address.defaultShippingAddress && (
                                                            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] text-emerald-700">
                                                                默认收货
                                                            </span>
                                                        )}
                                                        {address.defaultBillingAddress && (
                                                            <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[9px] text-blue-700">
                                                                默认账单
                                                            </span>
                                                        )}
                                                    </div>
                                                    {(canUpdateCustomer || canDeleteAddress) && (
                                                        <div className="flex shrink-0 gap-1">
                                                            {canUpdateCustomer && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setAddressEditor(address)}
                                                                    disabled={actionPending}
                                                                    className="rounded p-1 text-slate-400 hover:bg-white hover:text-blue-600"
                                                                    aria-label="编辑地址"
                                                                >
                                                                    <Edit3 className="h-3.5 w-3.5" />
                                                                </button>
                                                            )}
                                                            {canDeleteAddress && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() =>
                                                                        void removeAddress(address)
                                                                    }
                                                                    disabled={actionPending}
                                                                    className="rounded p-1 text-slate-400 hover:bg-white hover:text-rose-600"
                                                                    aria-label="删除地址"
                                                                >
                                                                    <Trash2 className="h-3.5 w-3.5" />
                                                                </button>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                                <p className="mt-1 leading-5 text-slate-500">
                                                    {[
                                                        address.country?.name,
                                                        address.province,
                                                        address.city,
                                                        address.streetLine1,
                                                        address.streetLine2,
                                                        address.postalCode,
                                                    ]
                                                        .filter(Boolean)
                                                        .join(' ')}
                                                </p>
                                            </div>
                                        ))
                                    ) : (
                                        <p className="text-xs text-slate-400">客户尚未保存地址</p>
                                    )}
                                </div>
                            </section>
                            <section className="rounded-xl border border-slate-200 p-4">
                                <h3 className="mb-3 flex items-center gap-1.5 text-xs font-bold text-slate-900">
                                    <Clock3 className="h-4 w-4 text-amber-600" />
                                    内部跟进
                                </h3>
                                <p className="-mt-2 mb-3 text-[10px] text-slate-400">
                                    当前读取最近 {customer.history.items.length} /{' '}
                                    {customer.history.totalItems} 条客户历史中的内部备注
                                </p>
                                {canUpdateCustomer ? (
                                    <div className="flex gap-2">
                                        <textarea
                                            value={note}
                                            onChange={event => setNote(event.target.value)}
                                            rows={2}
                                            maxLength={500}
                                            placeholder="记录回访、偏好或异常情况，仅后台可见"
                                            className="min-w-0 flex-1 rounded-lg border border-slate-300 p-2.5 text-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => void saveNote()}
                                            disabled={!note.trim() || noteState.loading}
                                            className="self-end rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
                                        >
                                            保存
                                        </button>
                                    </div>
                                ) : (
                                    <p className="text-xs text-slate-400">当前账号仅可查看跟进记录</p>
                                )}
                                <div className="mt-3 space-y-2">
                                    {customer.history.items.filter(isCustomerNote).length ? (
                                        customer.history.items.filter(isCustomerNote).map(entry => (
                                            <div
                                                key={entry.id}
                                                className="rounded-lg border border-amber-100 bg-amber-50/70 p-3 text-xs text-amber-950"
                                            >
                                                <p className="whitespace-pre-wrap leading-5">
                                                    {historyNote(entry.data)}
                                                </p>
                                                <div className="mt-1 flex justify-between text-[10px] text-amber-700">
                                                    <span>
                                                        {entry.administrator
                                                            ? `${entry.administrator.lastName}${entry.administrator.firstName}`
                                                            : '管理员'}
                                                    </span>
                                                    <span>{formatDateTime(entry.createdAt)}</span>
                                                </div>
                                            </div>
                                        ))
                                    ) : (
                                        <p className="text-xs text-slate-400">暂无内部跟进记录</p>
                                    )}
                                </div>
                            </section>
                            <section className="rounded-xl border border-slate-200 p-4">
                                <div className="mb-3 flex items-center justify-between">
                                    <h3 className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                                        <ShoppingBag className="h-4 w-4 text-violet-600" />
                                        最近订单
                                    </h3>
                                    <button
                                        type="button"
                                        onClick={() => onViewOrders(customer.emailAddress)}
                                        className="text-[11px] font-bold text-blue-600 hover:underline"
                                    >
                                        查看全部订单
                                    </button>
                                </div>
                                <div className="space-y-2">
                                    {customer.orders.items.slice(0, 8).map(order => (
                                        <button
                                            type="button"
                                            key={order.id}
                                            onClick={() => onViewOrder(order.id)}
                                            className="flex w-full items-center justify-between rounded-lg bg-slate-50 p-3 text-left hover:bg-slate-100"
                                        >
                                            <div>
                                                <div className="font-mono text-xs font-bold text-blue-600">
                                                    {order.code}
                                                </div>
                                                <div className="mt-0.5 text-[10px] text-slate-400">
                                                    {formatDateTime(order.orderPlacedAt)}
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <div className="font-mono text-xs font-bold text-slate-900">
                                                    {formatMoney(order.totalWithTax, order.currencyCode)}
                                                </div>
                                                <span
                                                    className={`mt-1 inline-block rounded border px-1.5 py-0.5 text-[9px] font-bold ${getOrderStateClass(order.state)}`}
                                                >
                                                    {getOrderStateLabel(order.state)}
                                                </span>
                                            </div>
                                        </button>
                                    ))}
                                    {!customer.orders.items.length && (
                                        <p className="text-xs text-slate-400">该客户尚未下单</p>
                                    )}
                                </div>
                            </section>
                        </div>
                    )}
                </div>
                <div className="flex shrink-0 items-center justify-between border-t border-slate-200 bg-slate-50 px-5 py-3 text-[11px] text-slate-500">
                    <span>{actionPending ? '正在保存变更…' : '所有操作直接写入真实客户数据'}</span>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg bg-slate-200 px-4 py-2 font-bold text-slate-700 hover:bg-slate-300"
                    >
                        关闭
                    </button>
                </div>
            </aside>
            {addressEditor && (
                <CustomerAddressEditor
                    key={addressEditor === 'create' ? 'create' : addressEditor.id}
                    address={addressEditor === 'create' ? null : addressEditor}
                    countries={countriesQuery.data?.countries.items ?? []}
                    countriesLoading={countriesQuery.loading}
                    pending={createAddressState.loading || updateAddressState.loading}
                    onClose={() => setAddressEditor(null)}
                    onSave={formValue => void saveAddress(formValue)}
                />
            )}
        </>
    );
}

function CustomerAddressEditor({
    address,
    countries,
    countriesLoading,
    pending,
    onClose,
    onSave,
}: {
    address: CustomerAddressRecord | null;
    countries: Array<{ id: string; code: string; name: string }>;
    countriesLoading: boolean;
    pending: boolean;
    onClose: () => void;
    onSave: (form: CustomerAddressForm) => void;
}) {
    const [form, setForm] = useState(() => addressToForm(address));
    const countryOptions =
        form.countryCode && !countries.some(country => country.code === form.countryCode)
            ? [
                  {
                      id: form.countryCode,
                      code: form.countryCode,
                      name: address?.country?.name ?? form.countryCode,
                  },
                  ...countries,
              ]
            : countries;
    return (
        <Modal
            title={address ? '编辑客户地址' : '新增客户地址'}
            description="国家或地区必须使用后台已启用的国家代码。"
            onClose={onClose}
            width="max-w-2xl"
        >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <TextInput
                    label="收件人"
                    value={form.fullName}
                    onChange={value => setForm({ ...form, fullName: value })}
                />
                <TextInput
                    label="手机号"
                    value={form.phoneNumber}
                    onChange={value => setForm({ ...form, phoneNumber: value })}
                />
                <TextInput
                    label="公司"
                    value={form.company}
                    onChange={value => setForm({ ...form, company: value })}
                />
                <label className="text-xs font-bold text-slate-700">
                    国家或地区 *
                    <select
                        value={form.countryCode}
                        onChange={event => setForm({ ...form, countryCode: event.target.value })}
                        disabled={countriesLoading}
                        className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-xs font-normal outline-none focus:border-blue-500"
                    >
                        <option value="">{countriesLoading ? '正在加载…' : '请选择'}</option>
                        {countryOptions.map(country => (
                            <option key={country.id} value={country.code}>
                                {country.name}（{country.code}）
                            </option>
                        ))}
                    </select>
                </label>
                <div className="sm:col-span-2">
                    <TextInput
                        label="详细地址 *"
                        value={form.streetLine1}
                        onChange={value => setForm({ ...form, streetLine1: value })}
                    />
                </div>
                <div className="sm:col-span-2">
                    <TextInput
                        label="地址补充"
                        value={form.streetLine2}
                        onChange={value => setForm({ ...form, streetLine2: value })}
                    />
                </div>
                <TextInput
                    label="城市"
                    value={form.city}
                    onChange={value => setForm({ ...form, city: value })}
                />
                <TextInput
                    label="州 / 省"
                    value={form.province}
                    onChange={value => setForm({ ...form, province: value })}
                />
                <TextInput
                    label="邮政编码"
                    value={form.postalCode}
                    onChange={value => setForm({ ...form, postalCode: value })}
                />
            </div>
            <div className="mt-4 flex flex-wrap gap-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
                <label className="flex items-center gap-2">
                    <input
                        type="checkbox"
                        checked={form.defaultShippingAddress}
                        onChange={event => setForm({ ...form, defaultShippingAddress: event.target.checked })}
                    />
                    设为默认收货地址
                </label>
                <label className="flex items-center gap-2">
                    <input
                        type="checkbox"
                        checked={form.defaultBillingAddress}
                        onChange={event => setForm({ ...form, defaultBillingAddress: event.target.checked })}
                    />
                    设为默认账单地址
                </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
                <button
                    type="button"
                    onClick={onClose}
                    className="rounded-lg bg-slate-100 px-4 py-2 text-xs font-bold text-slate-700"
                >
                    取消
                </button>
                <button
                    type="button"
                    onClick={() => onSave(form)}
                    disabled={pending || !form.streetLine1.trim() || !form.countryCode}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
                >
                    {pending ? '保存中…' : address ? '保存地址' : '新增地址'}
                </button>
            </div>
        </Modal>
    );
}

function CustomerEditForm({
    form,
    setForm,
    pending,
    onCancel,
    onSave,
}: {
    form: CustomerForm;
    setForm: (form: CustomerForm) => void;
    pending: boolean;
    onCancel: () => void;
    onSave: () => void;
}) {
    return (
        <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <TextInput
                    label="姓"
                    value={form.lastName}
                    onChange={value => setForm({ ...form, lastName: value })}
                />
                <TextInput
                    label="名"
                    value={form.firstName}
                    onChange={value => setForm({ ...form, firstName: value })}
                />
                <TextInput
                    label="邮箱 *"
                    type="email"
                    value={form.emailAddress}
                    onChange={value => setForm({ ...form, emailAddress: value })}
                />
                <TextInput
                    label="手机号"
                    value={form.phoneNumber}
                    onChange={value => setForm({ ...form, phoneNumber: value })}
                />
            </div>
            <div className="flex justify-end gap-2">
                <button
                    type="button"
                    onClick={onCancel}
                    className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700"
                >
                    取消
                </button>
                <button
                    type="button"
                    onClick={onSave}
                    disabled={pending || !form.emailAddress.trim()}
                    className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                >
                    {pending ? '保存中…' : '保存资料'}
                </button>
            </div>
        </div>
    );
}

function GroupManager({
    open,
    groups,
    onClose,
    onChanged,
    onError,
}: {
    open: boolean;
    groups: CustomerGroupRecord[];
    onClose: () => void;
    onChanged: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const [newName, setNewName] = useState('');
    const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
    const [deleting, setDeleting] = useState<CustomerGroupRecord | null>(null);
    const [deletePassword, setDeletePassword] = useState('');
    const [createGroup, createState] = useMutation(CREATE_CUSTOMER_GROUP_MUTATION);
    const [updateGroup, updateState] = useMutation(UPDATE_CUSTOMER_GROUP_MUTATION);
    const [deleteGroup, deleteState] = useMutation(DELETE_CUSTOMER_GROUP_MUTATION);
    if (!open) return null;
    const pending = createState.loading || updateState.loading || deleteState.loading;
    const create = async () => {
        if (!newName.trim()) return;
        try {
            await createGroup({ variables: { name: newName.trim() } });
            setNewName('');
            await onChanged('客户分组已创建');
        } catch (error) {
            onError(errorText(error));
        }
    };
    const update = async () => {
        if (!editing?.name.trim()) return;
        try {
            await updateGroup({ variables: { id: editing.id, name: editing.name.trim() } });
            setEditing(null);
            await onChanged('客户分组名称已更新');
        } catch (error) {
            onError(errorText(error));
        }
    };
    const remove = async () => {
        if (!deleting || !deletePassword) return;
        try {
            const result = await deleteGroup({
                variables: { id: deleting.id },
                context: sensitiveActionContext(deletePassword),
            });
            const response = (
                result.data as { deleteCustomerGroup?: { result?: string; message?: string } } | undefined
            )?.deleteCustomerGroup;
            if (!response || response.result !== 'DELETED')
                throw new Error(response?.message || '后端未确认分组已删除');
            setDeleting(null);
            setDeletePassword('');
            await onChanged('客户分组已删除');
        } catch (error) {
            onError(errorText(error));
        }
    };
    return (
        <Modal
            title="管理客户分组"
            description="分组用于运营筛选，不会改变客户账号或订单。"
            onClose={onClose}
            width="max-w-lg"
        >
            <div className="space-y-4">
                <div className="flex gap-2">
                    <input
                        value={newName}
                        onChange={event => setNewName(event.target.value)}
                        onKeyDown={event => {
                            if (event.key === 'Enter') void create();
                        }}
                        maxLength={80}
                        placeholder="输入新分组名称"
                        className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs outline-none focus:border-blue-500"
                    />
                    <button
                        type="button"
                        onClick={() => void create()}
                        disabled={!newName.trim() || pending}
                        className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                    >
                        <Plus className="h-3.5 w-3.5" />
                        新建
                    </button>
                </div>
                <div className="max-h-[420px] space-y-2 overflow-y-auto">
                    {groups.map(group => (
                        <div
                            key={group.id}
                            className="flex items-center gap-2 rounded-lg border border-slate-200 p-3"
                        >
                            {editing?.id === group.id ? (
                                <input
                                    value={editing.name}
                                    onChange={event => setEditing({ ...editing, name: event.target.value })}
                                    className="min-w-0 flex-1 rounded border border-blue-300 px-2 py-1 text-xs"
                                />
                            ) : (
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-xs font-bold text-slate-900">
                                        {group.name}
                                    </div>
                                    <div className="mt-0.5 text-[10px] text-slate-400">
                                        {group.customers.totalItems} 位客户
                                    </div>
                                </div>
                            )}
                            {editing?.id === group.id ? (
                                <>
                                    <button
                                        type="button"
                                        onClick={() => void update()}
                                        disabled={pending}
                                        className="rounded p-1.5 text-emerald-600 hover:bg-emerald-50"
                                        aria-label="保存分组名称"
                                    >
                                        <Check className="h-4 w-4" />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setEditing(null)}
                                        className="rounded p-1.5 text-slate-400 hover:bg-slate-100"
                                        aria-label="取消编辑"
                                    >
                                        <X className="h-4 w-4" />
                                    </button>
                                </>
                            ) : (
                                <>
                                    <button
                                        type="button"
                                        onClick={() => setEditing({ id: group.id, name: group.name })}
                                        className="rounded p-1.5 text-slate-500 hover:bg-slate-100"
                                        aria-label="重命名分组"
                                    >
                                        <Edit3 className="h-4 w-4" />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setDeletePassword('');
                                            setDeleting(group);
                                        }}
                                        className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                                        aria-label="删除分组"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                </>
                            )}
                        </div>
                    ))}
                    {!groups.length && (
                        <p className="py-8 text-center text-xs text-slate-400">尚未创建客户分组</p>
                    )}
                </div>
                {deleting && (
                    <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900">
                        <p>确认删除分组“{deleting.name}”？客户不会被删除。</p>
                        <label className="mt-3 block font-bold">
                            当前管理员密码 *
                            <input
                                type="password"
                                autoComplete="current-password"
                                value={deletePassword}
                                onChange={event => setDeletePassword(event.target.value)}
                                placeholder="输入密码确认本人操作"
                                className="mt-1.5 w-full rounded-lg border border-rose-200 bg-white px-3 py-2 font-normal text-slate-900 outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-100"
                            />
                        </label>
                        <div className="mt-2 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    setDeleting(null);
                                    setDeletePassword('');
                                }}
                                className="rounded bg-white px-3 py-1.5 font-bold"
                            >
                                取消
                            </button>
                            <button
                                type="button"
                                onClick={() => void remove()}
                                disabled={pending || !deletePassword}
                                className="rounded bg-rose-600 px-3 py-1.5 font-bold text-white disabled:opacity-50"
                            >
                                确认删除
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </Modal>
    );
}

function historyNote(data: Record<string, unknown> | null) {
    if (!data) return '内部备注';
    const value = data.note ?? data.message ?? data.content;
    return typeof value === 'string' ? value : JSON.stringify(data);
}
function isCustomerNote(entry: { type: string; data: Record<string, unknown> | null }) {
    return entry.type.toUpperCase().includes('NOTE') || Boolean(entry.data && 'note' in entry.data);
}
function TextInput({
    label,
    value,
    onChange,
    type = 'text',
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    type?: string;
}) {
    return (
        <label className="block text-[11px] font-bold text-slate-600">
            {label}
            <input
                type={type}
                value={value}
                onChange={event => onChange(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-normal text-slate-900 outline-none focus:border-blue-500"
            />
        </label>
    );
}
function Field({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <div className="text-[10px] font-bold text-slate-400">{label}</div>
            <div className="mt-1 break-all font-medium text-slate-800">{value}</div>
        </div>
    );
}
function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
    return (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="text-[10px] font-bold text-slate-400">{label}</div>
            <div className="mt-1 text-sm font-bold text-slate-900">{value}</div>
            {detail && <div className="mt-0.5 text-[9px] text-slate-400">{detail}</div>}
        </div>
    );
}
function StatusPill({ positive, children }: { positive: boolean; children: React.ReactNode }) {
    return (
        <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${positive ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}
        >
            {positive ? <UserCheck className="h-3 w-3" /> : <Clock3 className="h-3 w-3" />}
            {children}
        </span>
    );
}
function GroupFilterButton({
    active,
    label,
    onClick,
}: {
    active: boolean;
    label: string;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`shrink-0 rounded-md px-3 py-1.5 font-bold ${active ? 'bg-white text-blue-600 shadow-2xs' : 'text-slate-500 hover:text-slate-800'}`}
        >
            {label}
        </button>
    );
}
function Pagination({
    page,
    totalPages,
    totalItems,
    onPageChange,
}: {
    page: number;
    totalPages: number;
    totalItems: number;
    onPageChange: (page: number) => void;
}) {
    return (
        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
            <span>
                共 {totalItems} 条，第 {page + 1}/{totalPages} 页
            </span>
            <div className="flex gap-2">
                <button
                    type="button"
                    disabled={page === 0}
                    onClick={() => onPageChange(page - 1)}
                    className="rounded border border-slate-300 bg-white p-1.5 disabled:opacity-40"
                    aria-label="上一页"
                >
                    <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                    type="button"
                    disabled={page + 1 >= totalPages}
                    onClick={() => onPageChange(page + 1)}
                    className="rounded border border-slate-300 bg-white p-1.5 disabled:opacity-40"
                    aria-label="下一页"
                >
                    <ChevronRight className="h-4 w-4" />
                </button>
            </div>
        </div>
    );
}
function StatusMessage({
    kind,
    children,
    onClose,
}: {
    kind: 'success' | 'error';
    children: React.ReactNode;
    onClose: () => void;
}) {
    return (
        <div
            className={`flex items-center gap-2 rounded-xl border p-3 text-xs font-medium ${kind === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}
        >
            {kind === 'success' ? (
                <Check className="h-4 w-4 shrink-0" />
            ) : (
                <AlertCircle className="h-4 w-4 shrink-0" />
            )}
            <span className="flex-1">{children}</span>
            <button type="button" onClick={onClose} aria-label="关闭提示">
                <X className="h-4 w-4" />
            </button>
        </div>
    );
}
function LoadingState({ label }: { label: string }) {
    return (
        <div className="flex min-h-56 items-center justify-center rounded-xl border border-slate-200 bg-white text-xs text-slate-500">
            <LoaderCircle className="mr-2 h-5 w-5 animate-spin text-blue-600" />
            {label}
        </div>
    );
}
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
    return (
        <div className="rounded-xl border border-rose-200 bg-white p-10 text-center">
            <AlertCircle className="mx-auto h-8 w-8 text-rose-500" />
            <h3 className="mt-3 text-sm font-bold text-slate-900">客户数据读取失败</h3>
            <p className="mx-auto mt-1 max-w-xl text-xs text-rose-600">{toUserFacingError(message)}</p>
            <button
                type="button"
                onClick={onRetry}
                className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white"
            >
                重新加载
            </button>
        </div>
    );
}
function EmptyState({ icon: Icon, title, detail }: { icon: typeof Users; title: string; detail: string }) {
    return (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-14 text-center">
            <Icon className="mx-auto h-10 w-10 text-slate-300" />
            <h3 className="mt-3 text-sm font-bold text-slate-800">{title}</h3>
            <p className="mt-1 text-xs text-slate-400">{detail}</p>
        </div>
    );
}
function Modal({
    title,
    description,
    onClose,
    width,
    children,
}: {
    title: string;
    description?: string;
    onClose: () => void;
    width: string;
    children: React.ReactNode;
}) {
    const { dialogRef, titleId } = useAccessibleDialog(onClose);
    return (
        <div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-2xs"
            onMouseDown={event => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <div
                ref={dialogRef as React.RefObject<HTMLDivElement>}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                className={`w-full ${width} max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl outline-none`}
            >
                <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
                    <div>
                        <h2 id={titleId} className="text-base font-bold text-slate-900">
                            {title}
                        </h2>
                        {description && <p className="mt-1 text-[11px] text-slate-500">{description}</p>}
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded p-1 text-slate-400 hover:bg-slate-100"
                        aria-label="关闭"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>
                <div className="p-5">{children}</div>
            </div>
        </div>
    );
}
