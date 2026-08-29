import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pageSource = readFileSync(new URL('./pages/ai-image-studio-page.tsx', import.meta.url), 'utf8');
const stylesheet = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

describe('AI Image Studio terms consent', () => {
    it('requires explicit consent before reference uploads and generation', () => {
        expect(pageSource).toContain('const [termsAccepted, setTermsAccepted] = useState(false)');
        expect(pageSource).toContain('termsAccepted &&');
        expect(pageSource).toContain('disabled={!termsAccepted || Boolean(busy)}');
        expect(pageSource).toContain('termsAccepted,');
        expect(pageSource).not.toContain('termsAccepted: true');
    });

    it('renders the configured terms and a visible disabled upload state', () => {
        expect(pageSource).toContain('config.termsVersion');
        expect(pageSource).toContain('config.termsZh');
        expect(pageSource).toContain('config.termsEn');
        expect(stylesheet).toContain('.ai-studio-reference > label.is-disabled');
        expect(stylesheet).toContain('.ai-studio-checkout details p');
    });
});
