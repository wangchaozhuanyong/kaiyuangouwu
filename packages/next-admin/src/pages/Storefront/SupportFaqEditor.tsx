import { Plus, Trash2 } from 'lucide-react';
import {
    MAX_SUPPORT_FAQS,
    supportFaqItems,
    type SupportFaqItem,
} from '../../../../storefront-content-plugin/src/support-faq';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import type { StorefrontLanguageCode } from '../../graphql/storefront.graphql';
import { Field } from './storefront-editor-controls';
import { inputClass } from './storefront-editor-model';

export function SupportFaqEditor({
    settings,
    language,
    onChange,
}: {
    settings: Record<string, unknown> | null | undefined;
    language: StorefrontLanguageCode;
    onChange: (items: SupportFaqItem[]) => void;
}) {
    const items = supportFaqItems(settings);
    const isChinese = language === 'zh_Hans';
    const questionKey = isChinese ? 'questionZh' : 'questionEn';
    const answerKey = isChinese ? 'answerZh' : 'answerEn';
    const update = (id: string, patch: Partial<SupportFaqItem>) =>
        onChange(items.map(item => (item.id === id ? { ...item, ...patch } : item)));

    return (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h3 className="text-sm font-bold text-slate-900">
                        常见问题 <FeatureHelpButton topic="storefront.support-faq" title="常见问题" />
                    </h3>
                    <p className="mt-1 text-xs text-slate-500">仅展示已启用且中英文均填写完整的问题。</p>
                </div>
                <button
                    type="button"
                    disabled={items.length >= MAX_SUPPORT_FAQS}
                    onClick={() =>
                        onChange([
                            ...items,
                            {
                                id: crypto.randomUUID(),
                                enabled: false,
                                questionZh: '',
                                answerZh: '',
                                questionEn: '',
                                answerEn: '',
                            },
                        ])
                    }
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                    <Plus size={14} aria-hidden="true" /> 添加问题
                </button>
            </div>
            {items.length === 0 ? (
                <p className="mt-4 rounded-lg bg-slate-50 px-4 py-3 text-xs text-slate-500">
                    暂无常见问题；前台不会展示空白板块。
                </p>
            ) : (
                <div className="mt-4 space-y-3">
                    {items.map((item, index) => (
                        <article key={item.id} className="rounded-lg border border-slate-200 p-4">
                            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                                <strong className="text-sm text-slate-900">问题 {index + 1}</strong>
                                <div className="flex items-center gap-3">
                                    <label className="flex items-center gap-2 text-xs text-slate-700">
                                        <input
                                            type="checkbox"
                                            checked={item.enabled}
                                            onChange={event =>
                                                update(item.id, { enabled: event.target.checked })
                                            }
                                        />
                                        启用问题 {index + 1}
                                    </label>
                                    <button
                                        type="button"
                                        aria-label={`删除问题 ${index + 1}`}
                                        onClick={() =>
                                            onChange(items.filter(current => current.id !== item.id))
                                        }
                                        className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-red-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-red-300"
                                    >
                                        <Trash2 size={15} aria-hidden="true" />
                                    </button>
                                </div>
                            </div>
                            <div className="grid gap-3">
                                <Field
                                    label={
                                        isChinese ? `中文问题 ${index + 1}` : `English question ${index + 1}`
                                    }
                                >
                                    <input
                                        value={item[questionKey]}
                                        maxLength={160}
                                        onChange={event =>
                                            update(item.id, { [questionKey]: event.target.value })
                                        }
                                        className={inputClass}
                                    />
                                </Field>
                                <Field
                                    label={
                                        isChinese ? `中文答案 ${index + 1}` : `English answer ${index + 1}`
                                    }
                                >
                                    <textarea
                                        value={item[answerKey]}
                                        maxLength={1200}
                                        rows={3}
                                        onChange={event =>
                                            update(item.id, { [answerKey]: event.target.value })
                                        }
                                        className={inputClass}
                                    />
                                </Field>
                            </div>
                        </article>
                    ))}
                </div>
            )}
        </section>
    );
}
