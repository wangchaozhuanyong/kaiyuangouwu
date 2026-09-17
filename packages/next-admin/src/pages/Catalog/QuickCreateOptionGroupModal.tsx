import { useMutation } from '@apollo/client/react';
import { Sparkles, Tag, X } from 'lucide-react';
import React, { useState } from 'react';
import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { CREATE_OPTION_GROUP } from '../../graphql/catalog-admin.graphql';
import { toUserFacingError } from '../../utils/user-facing-error';
import { splitOptionValues, toOptionGroupCode } from './catalog-option-groups';
import { SOURCE_LANGUAGE_CODE, type OptionGroupItem } from './product-editor-types';

interface QuickCreateOptionGroupModalProps {
    isOpen: boolean;
    onClose: () => void;
    onCreated: (createdGroup: OptionGroupItem) => void;
    isSingleVariantWithoutOptions: boolean;
}

const PRESETS = [
    { name: '售卖包装', values: '单盒, 整条' },
    { name: '包装规格', values: '单包, 整箱' },
    { name: '净含量/容量', values: '小瓶, 大瓶' },
    { name: '规格款式', values: '标准款, 升级款' },
];

export function QuickCreateOptionGroupModal({
    isOpen,
    onClose,
    onCreated,
    isSingleVariantWithoutOptions,
}: QuickCreateOptionGroupModalProps) {
    const [name, setName] = useState('');
    const [valuesInput, setValuesInput] = useState('');
    const [actionError, setActionError] = useState('');

    const [createOptionGroupMutation, { loading: creating }] = useMutation<{
        createProductOptionGroup: OptionGroupItem;
    }>(CREATE_OPTION_GROUP);

    if (!isOpen) return null;

    const parsedValues = splitOptionValues(valuesInput);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmedName = name.trim();
        if (!trimmedName) {
            setActionError('请输入规格名称（如：包装、口味）');
            return;
        }
        if (parsedValues.length < 2) {
            setActionError('请至少输入 2 个规格选项值（如：单盒, 整条）');
            return;
        }

        setActionError('');
        try {
            const groupCode = toOptionGroupCode(trimmedName, 'spec-group');
            const res = await createOptionGroupMutation({
                variables: {
                    input: {
                        code: groupCode,
                        translations: [{ languageCode: SOURCE_LANGUAGE_CODE, name: trimmedName }],
                        options: parsedValues.map((val, idx) => ({
                            code: toOptionGroupCode(val, 'spec-opt', idx),
                            translations: [{ languageCode: SOURCE_LANGUAGE_CODE, name: val }],
                        })),
                    },
                },
            });

            const created = res.data?.createProductOptionGroup;
            if (!created) {
                throw new Error('后端未返回创建成功的规格数据');
            }

            onCreated(created);
            onClose();
        } catch (err: unknown) {
            setActionError(toUserFacingError(err, '创建规格模板失败，请稍后重试'));
        }
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
            onClick={onClose}
        >
            <AccessibleDialogSurface
                accessibleName="快速新建销售规格"
                onRequestClose={onClose}
                className="max-h-[92vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
                onClick={event => event.stopPropagation()}
            >
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <div className="flex items-center gap-2">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                            <Tag className="h-4 w-4" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h3 className="text-sm font-bold text-slate-900">快速新建商品销售规格</h3>
                                <FeatureHelpButton topic="catalog.variants" title="快速新建商品销售规格" />
                            </div>
                            <p className="text-[11px] text-slate-500">
                                在当前页面直接完成规格配置，无需跳转到分类设置
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={creating}
                        className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 cursor-pointer"
                        aria-label="关闭"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {isSingleVariantWithoutOptions && (
                    <div className="rounded-xl border border-blue-200 bg-blue-50 p-3.5 text-xs text-blue-900">
                        <div className="flex items-center gap-1.5 font-bold text-blue-800">
                            <Sparkles className="h-4 w-4 text-blue-600" />
                            智能平滑升级多规格
                        </div>
                        <p className="mt-1 leading-relaxed text-blue-700">
                            创建后，当前单品的条码、售价与库存将<strong>自动保留并绑定给第 1 个规格</strong>
                            （如“单盒”），同时自动为您新增后续规格行（如“整条”），避免重复录入！
                        </p>
                    </div>
                )}

                {actionError && (
                    <div className="rounded-lg bg-rose-50 p-3 text-xs text-rose-700">{actionError}</div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <div className="mb-1.5 flex items-center justify-between">
                            <label className="text-xs font-bold text-slate-700">常用规格快捷选择：</label>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {PRESETS.map(preset => (
                                <button
                                    key={preset.name}
                                    type="button"
                                    onClick={() => {
                                        setName(preset.name);
                                        setValuesInput(preset.values);
                                        setActionError('');
                                    }}
                                    className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700 cursor-pointer transition-colors"
                                >
                                    {preset.name} ({preset.values})
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <label className="mb-1 block text-xs font-bold text-slate-700">
                            规格属性名称 <span className="text-rose-500">*</span>
                        </label>
                        <input
                            type="text"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder="如：售卖包装、口味、颜色、规格"
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white"
                            autoFocus
                        />
                    </div>

                    <div>
                        <label className="mb-1 block text-xs font-bold text-slate-700">
                            规格选项值（用逗号或换行隔开） <span className="text-rose-500">*</span>
                        </label>
                        <textarea
                            rows={2}
                            value={valuesInput}
                            onChange={e => setValuesInput(e.target.value)}
                            placeholder="如：单盒, 整条 或 原箱（支持中英文逗号、空格或换行）"
                            className="w-full rounded-lg border border-slate-300 p-2.5 text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white"
                        />
                        {parsedValues.length > 0 && (
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                <span className="text-[11px] text-slate-400">
                                    将生成 {parsedValues.length} 个规格选项:
                                </span>
                                {parsedValues.map(val => (
                                    <span
                                        key={val}
                                        className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-800"
                                    >
                                        {val}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={creating}
                            className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
                        >
                            取消
                        </button>
                        <button
                            type="submit"
                            disabled={creating || !name.trim() || parsedValues.length < 2}
                            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 cursor-pointer shadow-2xs disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {creating ? '创建中...' : '确定并生成规格行'}
                        </button>
                    </div>
                </form>
            </AccessibleDialogSurface>
        </div>
    );
}
