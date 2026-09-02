import { useEffect, useState } from 'react';

/**
 * 智能 Canvas 自动抠图 Hook：
 * 检测上传 Logo 的四角背景色，自动将纯黑/纯白/单色背景去除为透明 PNG，
 * 并应用边缘抗锯齿羽化，彻底解决底色框不协调问题。
 */
export function useAutoMattedLogo(url: string | null): string | null {
    const [transparentUrl, setTransparentUrl] = useState<string | null>(url);

    useEffect(() => {
        if (!url) {
            setTransparentUrl(null);
            return;
        }

        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = url;

        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                if (!ctx) {
                    setTransparentUrl(url);
                    return;
                }

                canvas.width = img.naturalWidth || img.width;
                canvas.height = img.naturalHeight || img.height;
                ctx.drawImage(img, 0, 0);

                const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const data = imgData.data;

                // 采样四个角落像素判断背景色
                const corners = [
                    [0, 0],
                    [canvas.width - 1, 0],
                    [0, canvas.height - 1],
                    [canvas.width - 1, canvas.height - 1],
                ];

                const cornerColors = corners.map(([x, y]) => {
                    const idx = (y * canvas.width + x) * 4;
                    return [data[idx], data[idx + 1], data[idx + 2], data[idx + 3]];
                });

                const [r0, g0, b0, a0] = cornerColors[0];
                if (a0 > 0) {
                    const isCornerBg = cornerColors.every(
                        ([r, g, b]) => Math.hypot(r - r0, g - g0, b - b0) < 40,
                    );

                    if (isCornerBg) {
                        for (let i = 0; i < data.length; i += 4) {
                            const r = data[i];
                            const g = data[i + 1];
                            const b = data[i + 2];
                            const a = data[i + 3];
                            if (a > 0) {
                                const diff = Math.hypot(r - r0, g - g0, b - b0);
                                if (diff < 45) {
                                    data[i + 3] = 0;
                                } else if (diff < 70) {
                                    data[i + 3] = Math.round(a * ((diff - 45) / 25));
                                }
                            }
                        }
                        ctx.putImageData(imgData, 0, 0);
                        setTransparentUrl(canvas.toDataURL('image/png'));
                        return;
                    }
                }
                setTransparentUrl(url);
            } catch {
                setTransparentUrl(url);
            }
        };

        img.onerror = () => {
            setTransparentUrl(url);
        };
    }, [url]);

    return transparentUrl;
}
