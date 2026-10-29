import { Fragment } from 'react';

import '../../styles/announcement-reading.css';

/** Format published plain text for reading without interpreting markup or changing its text. */
export function AnnouncementContent({ content, className = '' }: { content: string; className?: string }) {
    return (
        <div className={`announcement-prose type-reading ${className}`.trim()}>
            {content
                .replace(/\r\n?/gu, '\n')
                .split(/(\n(?:[ \t]*\n)+)/u)
                .map((paragraph, index) => {
                    if (!paragraph.trim()) return <Fragment key={index}>{paragraph}</Fragment>;
                    const lineBreak = paragraph.indexOf('\n');
                    const firstLine = paragraph.slice(0, lineBreak);
                    const numberedSection =
                        lineBreak > 0 &&
                        /^(?:\d{2}\s+|\d{1,2}[、.．]\s*|[一二三四五六七八九十]+[、.．])\S/u.test(firstLine);
                    return (
                        <p key={index}>
                            {numberedSection ? (
                                <>
                                    <strong>{firstLine}</strong>
                                    {'\n'}
                                    {paragraph.slice(lineBreak + 1)}
                                </>
                            ) : (
                                paragraph
                            )}
                        </p>
                    );
                })}
        </div>
    );
}
