import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { readStorefrontStylesheet } from './test-stylesheet';

const pageSource = readFileSync(new URL('./pages/ai-image-studio-page.tsx', import.meta.url), 'utf8');
const stylesheet = readStorefrontStylesheet(['./styles/modals-and-support.css', './styles/image-studio.css']);
const apiSource =
    readFileSync(new URL('./api.ts', import.meta.url), 'utf8') +
    readFileSync(new URL('./api/fragments.ts', import.meta.url), 'utf8');

describe('AI Image Studio responsive generation flow', () => {
    it('defaults consent to checked while preserving the generation gate', () => {
        expect(pageSource).toContain('const [termsAccepted, setTermsAccepted] = useState(true)');
        expect(pageSource).toContain('setTermsAccepted(true)');
        expect(pageSource).toContain('termsAccepted &&');
        expect(pageSource).toContain('termsAccepted,');
        expect(pageSource).toContain('referenceAssetIds: referenceAssets.map(asset => asset.id)');
        expect(pageSource).toContain('referenceInstruction: referenceInstruction.trim() || null');
        expect(pageSource).toContain('referenceMode,');
        expect(pageSource).toContain('api.uploadImageReference');
        expect(pageSource).toContain('type="file"');
    });

    it('opens configured terms from the compact consent row', () => {
        expect(pageSource).toContain('config.termsVersion');
        expect(pageSource).toContain('config.termsZh');
        expect(pageSource).toContain('config.termsEn');
        expect(pageSource).toContain('setTermsInfoOpen(true)');
        expect(pageSource).not.toContain('<small>({config.termsVersion})</small>');
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

    it('provides a dedicated desktop workbench without changing the compact mobile flow', () => {
        expect(pageSource).toContain('className="ai-studio-controls"');
        expect(pageSource).toContain("'生成参数与结算'");
        expect(stylesheet).toContain('/* AI Image Studio — desktop workbench */');
        expect(stylesheet).toContain('@media (min-width: 960px)');
        expect(stylesheet).toMatch(
            /\.ai-studio-shell \{[^}]*grid-template-columns: minmax\(0, 1fr\) minmax\(340px, 400px\);/,
        );
        expect(stylesheet).toMatch(
            /\.ai-studio-fixed-generate \{[^}]*position: static;[^}]*transform: none;/,
        );
        expect(stylesheet).toContain('.sheet.ai-studio-history-detail-sheet');
    });

    it('renders filterable compact history with an information sheet', () => {
        expect(pageSource).toContain("type HistoryFilter = 'ALL' | 'SUCCESS' | 'PROCESSING' | 'FAILED'");
        expect(pageSource).toContain('setHistoryInfoOpen(true)');
        expect(pageSource).toContain('setSelectedJobId(job.id)');
        expect(stylesheet).toContain('.ai-studio-history-filters');
        expect(stylesheet).toContain('.ai-generation-card-preview');
    });

    it('keeps mixed image ratios visible without stretching or cropping the history card', () => {
        expect(stylesheet).toMatch(
            /\.ai-generation-card \{[^}]*grid-template-columns: 96px minmax\(0, 1fr\);[^}]*align-items: start;/,
        );
        expect(stylesheet).toMatch(/\.ai-generation-card-preview \{[^}]*min-height: 0;[^}]*aspect-ratio: 1;/);
        expect(stylesheet).toMatch(/\.ai-generation-card-preview img \{[^}]*object-fit: contain;/);
    });

    it('shows stored output dimensions and warns when the provider ratio misses the target', () => {
        expect(apiSource).toContain('chargeAmount width height imageUrl downloadUrl');
        expect(pageSource).toContain('summarizeImageOutputDimensions(job.outputs, job.aspectRatio)');
        expect(pageSource).toContain('实际比例与目标');
        expect(pageSource).toContain('generationOutputAspectRatio(job.aspectRatio, output)');
        expect(stylesheet).toContain('.ai-generation-ratio-warning');
        expect(stylesheet).toContain('.ai-generation-output-size.is-mismatch');
    });

    it('keeps mobile text entry stable and confirms reference uploads with a local preview', () => {
        expect(pageSource).toContain('URL.createObjectURL(file)');
        expect(pageSource).toContain('multiple');
        expect(pageSource).toContain('item.previewUrl');
        expect(pageSource).toContain("? '上传成功'");
        expect(pageSource).toContain('className={`ai-studio-reference-card is-${item.state.toLowerCase()}`}');
        expect(stylesheet).toContain('.ai-studio-reference-card');
        expect(stylesheet).toMatch(/\.ai-studio-prompt-wrap textarea \{[^}]*font-size: 16px;/);
        expect(stylesheet).toContain('overflow-x: clip');
    });

    it('supports three references, custom instructions, card navigation, and confirmed record deletion', () => {
        expect(pageSource).toContain('const referenceImageLimit = 3');
        expect(pageSource).toContain('setReferenceSettingsOpen(true)');
        expect(pageSource).toContain('具体参考要求（可选）');
        expect(pageSource).toContain('className="ai-generation-card-preview"');
        expect(pageSource).toContain('onClick={onView}');
        expect(pageSource).toContain('role="alertdialog"');
        expect(pageSource).not.toContain('window.confirm(');
        expect(pageSource).not.toContain('onDelete(output.id)');
        expect(stylesheet).toContain('.ai-confirmation-dialog');
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
        expect(pageSource).toContain('imageGenerationElapsedSeconds(job.createdAt, progressClock)');
        expect(pageSource).toContain('progress.determinate');
        expect(pageSource).toContain('<progress');
        expect(stylesheet).toContain('.ai-generation-progress');
    });

    it('opens generated images in an in-app fullscreen preview and downloads the original', () => {
        expect(pageSource).toContain('className="ai-generation-output-preview"');
        expect(pageSource).toContain('className="ai-generation-lightbox"');
        expect(pageSource).toContain('saveGeneratedImage');
        expect(pageSource).toContain('output.downloadUrl ?? output.imageUrl');
        expect(stylesheet).toContain('.ai-generation-output-preview > .safe-image-frame');
        expect(stylesheet).toContain('.ai-generation-lightbox-dialog');
    });

    it('uses readable compact typography instead of 9px and 10px operational text', () => {
        expect(stylesheet).toContain('--ai-font-caption: 12px');
        expect(stylesheet).toContain('--ai-font-body: 13px');
        expect(stylesheet).toContain('.ai-generation-card-content > p,');
        expect(stylesheet).toContain('.ai-generation-progress-copy,');
        expect(stylesheet).toContain('.ai-studio-history-filters button {');
    });
});
