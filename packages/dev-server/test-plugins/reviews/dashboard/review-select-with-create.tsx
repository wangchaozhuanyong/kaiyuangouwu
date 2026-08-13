import { graphql } from '@/graphql/graphql';
import { Button } from '@/vdb/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/vdb/components/ui/dialog';
import { Field, FieldError, FieldLabel } from '@/vdb/components/ui/field';
import { Form } from '@/vdb/components/ui/form';
import { Input } from '@/vdb/components/ui/input';
import { Textarea } from '@/vdb/components/ui/textarea';
import { DashboardFormComponentProps } from '@/vdb/framework/form-engine/form-engine-types';
import { handleNestedFormSubmit } from '@/vdb/framework/form-engine/utils';
import { api } from '@/vdb/graphql/api';
import { zodResolver } from '@hookform/resolvers/zod';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { useMutation } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { ReviewMultiSelect } from './custom-form-components';

const createReviewDocument = graphql(`
    mutation CreateProductReview($input: CreateProductReviewInput!) {
        createProductReview(input: $input) {
            id
            summary
        }
    }
`);

const reviewMessages = {
    titlePlaceholder: msg({ id: 'review.titlePlaceholder', message: 'Enter a short review title' }),
    bodyPlaceholder: msg({ id: 'review.bodyPlaceholder', message: 'Enter the review content' }),
    titleRequired: msg({ id: 'review.titleRequired', message: 'Review title is required' }),
    bodyRequired: msg({ id: 'review.bodyRequired', message: 'Review body is required' }),
    ratingInvalid: msg({ id: 'review.ratingInvalid', message: 'Rating must be between 1 and 5' }),
    reviewerRequired: msg({ id: 'review.reviewerRequired', message: 'Reviewer name is required' }),
    missingProduct: msg({
        id: 'review.missingProduct',
        message: 'Unable to determine the current product',
    }),
    createFailed: msg({ id: 'review.createFailed', message: 'Failed to create review' }),
    created: msg({
        id: 'review.created',
        message: 'Review created and linked to this product',
    }),
};

type FormSchema = {
    title: string;
    body: string;
    rating: number;
    authorName: string;
    authorLocation: string;
};

export function ReviewSelectWithCreate(props: DashboardFormComponentProps) {
    const { i18n } = useLingui();
    const [open, setOpen] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const productId = /\/products\/([^/?]+)/.exec(globalThis.location.pathname)?.[1];
    const formSchema = useMemo(
        () =>
            z.object({
                title: z.string().min(1, i18n._(reviewMessages.titleRequired)),
                body: z.string().min(1, i18n._(reviewMessages.bodyRequired)),
                rating: z.coerce.number().min(1, i18n._(reviewMessages.ratingInvalid)).max(5),
                authorName: z.string().min(1, i18n._(reviewMessages.reviewerRequired)),
                authorLocation: z.string(),
            }),
        [i18n.locale],
    );
    const form = useForm<FormSchema>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            title: '',
            body: '',
            rating: 5,
            authorName: '',
            authorLocation: '',
        },
    });

    const { mutateAsync: createReview, isPending } = useMutation({
        mutationFn: api.mutate(createReviewDocument),
    });

    const onSubmit = async (data: FormSchema) => {
        if (!productId) {
            setSubmitError(i18n._(reviewMessages.missingProduct));
            return;
        }
        setSubmitError(null);
        try {
            const result = await createReview({
                input: {
                    productId,
                    summary: data.title,
                    body: data.body,
                    rating: data.rating,
                    authorName: data.authorName,
                    authorLocation: data.authorLocation || null,
                },
            });
            const currentIds = Array.isArray(props.value) ? props.value.map(String) : [];
            props.onChange([...new Set([...currentIds, result.createProductReview.id])]);
            toast.success(i18n._(reviewMessages.created));
            form.reset();
            setOpen(false);
        } catch (error) {
            setSubmitError(error instanceof Error ? error.message : i18n._(reviewMessages.createFailed));
        }
    };

    return (
        <div>
            <ReviewMultiSelect {...props}></ReviewMultiSelect>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger render={<Button variant="outline" />}>
                    <Trans>Create review</Trans>
                </DialogTrigger>

                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            <Trans>Create review</Trans>
                        </DialogTitle>
                    </DialogHeader>
                    <Form {...form}>
                        <form onSubmit={handleNestedFormSubmit(form, onSubmit)} className="space-y-4">
                            <Controller
                                control={form.control}
                                name="title"
                                render={({ field, fieldState }) => (
                                    <Field data-invalid={fieldState.invalid || undefined}>
                                        <FieldLabel>
                                            <Trans>Review title</Trans>
                                        </FieldLabel>
                                        <Input
                                            placeholder={i18n._(reviewMessages.titlePlaceholder)}
                                            {...field}
                                        />
                                        {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                                    </Field>
                                )}
                            />
                            <Controller
                                control={form.control}
                                name="body"
                                render={({ field, fieldState }) => (
                                    <Field data-invalid={fieldState.invalid || undefined}>
                                        <FieldLabel>
                                            <Trans>Review content</Trans>
                                        </FieldLabel>
                                        <Textarea
                                            placeholder={i18n._(reviewMessages.bodyPlaceholder)}
                                            className="min-h-[100px]"
                                            {...field}
                                        />
                                        {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                                    </Field>
                                )}
                            />
                            <Controller
                                control={form.control}
                                name="rating"
                                render={({ field, fieldState }) => (
                                    <Field data-invalid={fieldState.invalid || undefined}>
                                        <FieldLabel>
                                            <Trans>Rating</Trans>
                                        </FieldLabel>
                                        <Input type="number" min={1} max={5} step={1} {...field} />
                                        {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                                    </Field>
                                )}
                            />
                            <Controller
                                control={form.control}
                                name="authorName"
                                render={({ field, fieldState }) => (
                                    <Field data-invalid={fieldState.invalid || undefined}>
                                        <FieldLabel>
                                            <Trans>Reviewer name</Trans>
                                        </FieldLabel>
                                        <Input {...field} />
                                        {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                                    </Field>
                                )}
                            />
                            <Controller
                                control={form.control}
                                name="authorLocation"
                                render={({ field }) => (
                                    <Field>
                                        <FieldLabel>
                                            <Trans id="review.reviewerLocation">Reviewer location</Trans>
                                        </FieldLabel>
                                        <Input {...field} />
                                    </Field>
                                )}
                            />
                            {submitError ? <p className="text-sm text-destructive">{submitError}</p> : null}
                            <div className="flex justify-end gap-2">
                                <Button type="submit" disabled={isPending}>
                                    <Trans>Create review</Trans>
                                </Button>
                            </div>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>
        </div>
    );
}
