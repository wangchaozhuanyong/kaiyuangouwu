import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pageSource = readFileSync(new URL('./pages/ai-image-studio-page.tsx', import.meta.url), 'utf8');
const stylesheet = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

describe('AI Image Studio compact generation flow', () => {
    it('defaults consent to checked while preserving the generation gate', () => {
        expect(pageSource).toContain('const [termsAccepted, setTermsAccepted] = useState(true)');
        expect(pageSource).toContain('setTermsAccepted(true)');
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

    it('keeps mobile text entry stable and confirms reference uploads with a local preview', () => {
        expect(pageSource).toContain('URL.createObjectURL(file)');
        expect(pageSource).toContain('referencePreviewUrl || referenceAsset?.previewUrl');
        expect(pageSource).toContain("? '上传成功'");
        expect(pageSource).toContain('className="ai-studio-reference-card"');
        expect(stylesheet).toContain('.ai-studio-reference-card');
        expect(stylesheet).toMatch(/\.ai-studio-prompt-wrap textarea \{[^}]*font-size: 16px;/);
        expect(stylesheet).toContain('overflow-x: clip');
    });

    it('shows the concrete optimizer model immediately before the optimize action', () => {
        expect(pageSource).toContain('config?.promptOptimizerModelIds');
        expect(pageSource).toContain('result.optimizerModelId');
        expect(pageSource).toContain('className="ai-studio-optimizer-model"');
        expect(stylesheet).toContain('.ai-studio-optimizer-model');
    });

    it('keeps active generation polling alive and shows real output progress', () => {
        expect(pageSource).toContain('startImageGenerationPolling');
        expect(pageSource).toContain("document.addEventListener('visibilitychange'");
        expect(pageSource).toContain("window.addEventListener('online'");
        expect(pageSource).toContain('imageGenerationProgress(job)');
        expect(pageSource).toContain('<progress');
        expect(stylesheet).toContain('.ai-generation-progress');
    });
});
