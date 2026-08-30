import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pageSource = readFileSync(new URL('./pages/ai-image-studio-page.tsx', import.meta.url), 'utf8');
const stylesheet = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

describe('AI Image Studio compact generation flow', () => {
    it('requires explicit consent before creating generations', () => {
        expect(pageSource).toContain('const [termsAccepted, setTermsAccepted] = useState(false)');
        expect(pageSource).toContain('termsAccepted &&');
        expect(pageSource).toContain('termsAccepted,');
        expect(pageSource).toContain('referenceAssetId: referenceAsset?.id ?? null');
        expect(pageSource).toContain('referenceMode,');
        expect(pageSource).toContain('api.uploadImageReference');
        expect(pageSource).toContain('type="file"');
    });

    it('opens configured terms from the compact consent row', () => {
        expect(pageSource).toContain('config.termsVersion');
        expect(pageSource).toContain('config.termsZh');
        expect(pageSource).toContain('config.termsEn');
        expect(pageSource).toContain('setTermsInfoOpen(true)');
        expect(stylesheet).toContain('.ai-studio-terms-row');
        expect(stylesheet).toContain('.ai-studio-info-sheet');
    });

    it('uses bottom sheets for settings and keeps generation fixed to the viewport', () => {
        expect(pageSource).toContain("setActiveSetting('ASPECT_RATIO')");
        expect(pageSource).toContain("setActiveSetting('QUANTITY')");
        expect(pageSource).toContain("setActiveSetting('RESOLUTION')");
        expect(pageSource).toContain('className="ai-studio-bottom-sheet"');
        expect(stylesheet).toContain('.ai-studio-fixed-generate');
        expect(stylesheet).toContain('position: fixed');
    });

    it('renders filterable compact history with an information sheet', () => {
        expect(pageSource).toContain("type HistoryFilter = 'ALL' | 'SUCCESS' | 'PROCESSING' | 'FAILED'");
        expect(pageSource).toContain('setHistoryInfoOpen(true)');
        expect(pageSource).toContain('setSelectedJobId(job.id)');
        expect(stylesheet).toContain('.ai-studio-history-filters');
        expect(stylesheet).toContain('.ai-generation-card-preview');
    });
});
