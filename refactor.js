const fs = require('fs');
const path = require('path');

const file = '/Users/wangchao/Desktop/源码文件夹/vendure开源/.codex-worktrees/stabilization-gates-20260902/packages/next-admin/src/pages/Marketing/ReferralsModule.tsx';
let content = fs.readFileSync(file, 'utf8');

// 1. Add imports for types and shared UI
const newImports = `import {
    PosterAssetChoice,
    PosterAssetLookupResult,
    PosterDraft,
    ProgramDraft,
    ReferralTab,
    ReportKey,
    WithdrawalAction,
    WithdrawalRecord
} from './referrals-types';
import { ErrorState, Field, LoadingState, Message, Modal, TabButton, inputClass, primaryButton, secondaryButton, theadClass } from '../Settings/settings-ui';`;

content = content.replace(/(import {.*?from '\.\.\/sales-utils';\n)/s, `$1\n${newImports}\n`);

// 2. Remove type definitions (type ReferralTab ... interface PosterAssetLookupResult { ... })
content = content.replace(/type ReferralTab = .*?\n/s, '');
content = content.replace(/type ReportKey = .*?;\n/s, '');
content = content.replace(/type WithdrawalRecord = .*?;\n/s, '');
content = content.replace(/type WithdrawalAction = .*?;\n/s, '');
content = content.replace(/interface ProgramDraft \{[\s\S]*?\}\n/s, '');
content = content.replace(/interface PosterDraft \{[\s\S]*?\}\n/s, '');
content = content.replace(/interface PosterAssetChoice \{[\s\S]*?\}\n/s, '');
content = content.replace(/interface PosterAssetLookupResult \{[\s\S]*?\}\n/s, '');

// 3. Remove local function definitions for TabButton, Field (Wait, is there a Field?), LoadingState, ErrorState, Message, Modal
// We need to carefully remove them.
content = content.replace(/function TabButton\(\{[\s\S]*?\}\) \{[\s\S]*?return \([\s\S]*?\);\n\}\n/s, '');
content = content.replace(/function Message\(\{[\s\S]*?\}\) \{[\s\S]*?return \([\s\S]*?\);\n\}\n/s, '');
content = content.replace(/function LoadingState\(\{[\s\S]*?\}\) \{[\s\S]*?return \([\s\S]*?\);\n\}\n/s, '');
content = content.replace(/function ErrorState\(\{[\s\S]*?\}\) \{[\s\S]*?return \([\s\S]*?\);\n\}\n/s, '');
content = content.replace(/function Modal\(\{[\s\S]*?\}\) \{[\s\S]*?return \([\s\S]*?<\/div>\n    \);\n\}\n/s, '');

// There might be some local Field wrappers?
// Let's check if there are other shared ones:
// Wait, we can't just blindly remove if we don't fix the usages.
// The script will first save the modified file and then we run `npx tsc` to see errors.

fs.writeFileSync(file, content);
