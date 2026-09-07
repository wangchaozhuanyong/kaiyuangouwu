type EnglishKey<T> = Extract<keyof T, `${string}En`>;
export type EnglishOptional<T> = Omit<T, EnglishKey<T>> & Partial<Pick<T, EnglishKey<T>>>;

/** Omit untouched English so a background translation cannot be overwritten by an old form snapshot. */
export function omitUnchangedEnglish<T extends object>(input: T, original: object): EnglishOptional<T> {
    const previous = original as Record<string, unknown>;
    return Object.fromEntries(
        Object.entries(input).filter(([key, value]) => !key.endsWith('En') || value !== previous[key]),
    ) as EnglishOptional<T>;
}
