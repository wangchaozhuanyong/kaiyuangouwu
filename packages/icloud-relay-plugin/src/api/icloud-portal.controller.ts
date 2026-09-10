import { Controller, Get, Res } from '@nestjs/common';

/**
 * Serves the static buyer mail inquiry portal at /mail-query
 */
@Controller('mail-query')
export class IcloudPortalController {
    @Get()
    servePortal(@Res() res: any) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(PORTAL_HTML);
    }
}

const PORTAL_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>邮件查询中心</title>
    <style>
        :root {
            --primary: #3b82f6;
            --primary-hover: #2563eb;
            --success: #22c55e;
            --error: #ef4444;
            --warning: #f59e0b;
            --bg: #f8fafc;
            --card-bg: #ffffff;
            --text: #1e293b;
            --text-secondary: #64748b;
            --border: #e2e8f0;
            --radius: 12px;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
            background: var(--bg);
            color: var(--text);
            min-height: 100vh;
        }
        .container { max-width: 640px; margin: 0 auto; padding: 20px 16px; }

        /* ====== Query Form ====== */
        .query-card {
            background: var(--card-bg);
            border-radius: var(--radius);
            padding: 32px 24px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.08);
            margin-top: 40px;
            text-align: center;
        }
        .query-card h1 { font-size: 22px; margin-bottom: 8px; }
        .query-card p { color: var(--text-secondary); font-size: 14px; margin-bottom: 24px; }
        .input-group {
            display: flex; gap: 8px;
        }
        .input-group input {
            flex: 1; padding: 12px 16px; border: 1px solid var(--border);
            border-radius: 8px; font-size: 16px; outline: none;
            text-transform: uppercase; letter-spacing: 2px; text-align: center;
        }
        .input-group input:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(59,130,246,0.1); }
        .input-group button {
            padding: 12px 24px; background: var(--primary); color: #fff;
            border: none; border-radius: 8px; font-size: 16px; cursor: pointer;
            white-space: nowrap; font-weight: 600;
        }
        .input-group button:hover { background: var(--primary-hover); }
        .input-group button:disabled { opacity: 0.6; cursor: not-allowed; }

        /* ====== Messages ====== */
        .msg { margin-top: 16px; padding: 12px 16px; border-radius: 8px; font-size: 14px; display: none; }
        .msg.error { background: #fef2f2; color: var(--error); border: 1px solid #fecaca; display: block; }
        .msg.success { background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; display: block; }

        /* ====== Mail Result Section ====== */
        .result-section { display: none; margin-top: 24px; }
        .result-header {
            background: var(--card-bg); border-radius: var(--radius);
            padding: 16px 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.06);
            margin-bottom: 12px;
        }
        .result-header .email-tag {
            font-size: 13px; color: var(--text-secondary);
            background: #f1f5f9; padding: 4px 10px; border-radius: 6px;
            display: inline-block; margin-bottom: 8px;
        }
        .result-header .meta { display: flex; gap: 16px; font-size: 13px; color: var(--text-secondary); }
        .result-header .meta span { display: flex; align-items: center; gap: 4px; }
        .filter-bar {
            margin-bottom: 12px; display: none;
        }
        .filter-bar select {
            width: 100%; padding: 10px; border: 1px solid var(--border);
            border-radius: 8px; font-size: 14px; background: var(--card-bg);
        }

        /* ====== Mail Cards ====== */
        .mail-card {
            background: var(--card-bg); border-radius: var(--radius);
            padding: 16px 20px; margin-bottom: 10px;
            box-shadow: 0 1px 2px rgba(0,0,0,0.04);
            border: 1px solid var(--border);
            cursor: pointer; transition: border-color 0.15s;
        }
        .mail-card:hover { border-color: var(--primary); }
        .mail-card .otp-badge {
            display: inline-flex; align-items: center; gap: 6px;
            background: linear-gradient(135deg, #dbeafe 0%, #ede9fe 100%);
            color: #1d4ed8; font-size: 18px; font-weight: 700;
            padding: 8px 16px; border-radius: 8px; margin-bottom: 10px;
            letter-spacing: 3px;
        }
        .mail-card .otp-badge .copy-btn {
            font-size: 12px; padding: 2px 8px; background: var(--primary);
            color: #fff; border: none; border-radius: 4px; cursor: pointer;
            letter-spacing: 0; font-weight: 500;
        }
        .mail-card .otp-badge .copy-btn.copied { background: var(--success); }
        .mail-card .mail-from { font-size: 13px; color: var(--text-secondary); margin-bottom: 4px; }
        .mail-card .mail-subject { font-size: 15px; font-weight: 600; margin-bottom: 4px; }
        .mail-card .mail-time { font-size: 12px; color: var(--text-secondary); }
        .mail-card .mail-body {
            display: none; margin-top: 12px; padding-top: 12px;
            border-top: 1px solid var(--border); font-size: 14px;
            line-height: 1.6; color: var(--text);
            max-height: 400px; overflow-y: auto;
            word-break: break-word;
        }
        .mail-card .mail-body iframe {
            width: 100%; border: none; min-height: 200px;
        }
        .mail-card.expanded .mail-body { display: block; }

        .empty-state { text-align: center; padding: 40px; color: var(--text-secondary); }
        .back-btn {
            display: inline-flex; align-items: center; gap: 4px;
            color: var(--primary); cursor: pointer; font-size: 14px;
            margin-bottom: 16px; background: none; border: none;
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- Query Form -->
        <div class="query-card" id="queryCard">
            <h1>📬 邮件查询中心</h1>
            <p>请输入您的专属查询码以查看邮件</p>
            <div class="input-group">
                <input type="text" id="codeInput" placeholder="BUY-XXXX-XXXX" maxlength="16"
                       autocomplete="off" spellcheck="false">
                <button id="queryBtn" onclick="doQuery()">查 询</button>
            </div>
            <div class="msg" id="msgBox"></div>
        </div>

        <!-- Results -->
        <div class="result-section" id="resultSection">
            <button class="back-btn" onclick="goBack()">← 返回重新查询</button>
            <div class="result-header" id="resultHeader"></div>
            <div class="filter-bar" id="filterBar">
                <select id="filterSelect" onchange="filterMails()">
                    <option value="">全部虚拟邮箱</option>
                </select>
            </div>
            <div id="mailList"></div>
        </div>
    </div>

    <script>
        const API_ENDPOINT = '/shop-api';
        let allMails = [];
        let virtualEmailsList = [];

        document.getElementById('codeInput').addEventListener('keydown', e => {
            if (e.key === 'Enter') doQuery();
        });

        async function doQuery() {
            const code = document.getElementById('codeInput').value.trim();
            if (!code) { showMsg('请输入查询码', 'error'); return; }

            const btn = document.getElementById('queryBtn');
            btn.disabled = true; btn.textContent = '查询中...';
            hideMsg();

            try {
                const res = await fetch(API_ENDPOINT, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        query: \`query QueryMails($code: String!) {
                            icloudQueryMails(queryCode: $code) {
                                success message targetType aliasEmail primaryEmail
                                codeExpiresAt remainingDays totalEmails
                                items {
                                    id fromAddress fromName subject receivedAt
                                    extractedCode bodyText bodyHtml targetEmail
                                }
                                virtualEmailsList { id aliasEmail note }
                            }
                        }\`,
                        variables: { code }
                    })
                });
                const json = await res.json();
                const data = json.data?.icloudQueryMails;

                if (!data || !data.success) {
                    showMsg(data?.message || '查询失败，请检查查询码', 'error');
                    return;
                }

                allMails = data.items || [];
                virtualEmailsList = data.virtualEmailsList || [];
                showResults(data);
            } catch (err) {
                showMsg('网络请求失败，请稍后重试', 'error');
            } finally {
                btn.disabled = false; btn.textContent = '查 询';
            }
        }

        function showResults(data) {
            document.getElementById('queryCard').style.display = 'none';
            const section = document.getElementById('resultSection');
            section.style.display = 'block';

            // Header
            const emailLabel = data.aliasEmail || data.primaryEmail || '邮箱';
            let metaHtml = '';
            if (data.remainingDays != null) {
                metaHtml += '<span>⏳ 有效期剩余 ' + data.remainingDays + ' 天</span>';
            }
            metaHtml += '<span>📧 共 ' + data.totalEmails + ' 封</span>';

            document.getElementById('resultHeader').innerHTML =
                '<div class="email-tag">' + emailLabel + '</div>' +
                '<div class="meta">' + metaHtml + '</div>';

            // Filter bar (only for master code queries)
            const filterBar = document.getElementById('filterBar');
            if (virtualEmailsList.length > 0) {
                filterBar.style.display = 'block';
                const select = document.getElementById('filterSelect');
                select.innerHTML = '<option value="">全部虚拟邮箱 (' + allMails.length + ')</option>';
                virtualEmailsList.forEach(v => {
                    select.innerHTML += '<option value="' + v.aliasEmail + '">' +
                        v.aliasEmail + (v.note ? ' (' + v.note + ')' : '') + '</option>';
                });
            } else {
                filterBar.style.display = 'none';
            }

            renderMails(allMails);
        }

        function filterMails() {
            const filter = document.getElementById('filterSelect').value;
            if (!filter) { renderMails(allMails); return; }
            renderMails(allMails.filter(m => m.targetEmail === filter));
        }

        function renderMails(mails) {
            const list = document.getElementById('mailList');
            if (mails.length === 0) {
                list.innerHTML = '<div class="empty-state">📭 暂无邮件</div>';
                return;
            }

            list.innerHTML = mails.map((m, i) => {
                const timeStr = formatTime(m.receivedAt);
                let otpHtml = '';
                if (m.extractedCode) {
                    otpHtml = '<div class="otp-badge">' +
                        '🔑 ' + m.extractedCode +
                        '<button class="copy-btn" onclick="copyCode(event, \\'' + m.extractedCode + '\\', this)">复制</button>' +
                        '</div>';
                }
                return '<div class="mail-card" onclick="toggleCard(this)">' +
                    otpHtml +
                    '<div class="mail-from">📤 ' + (m.fromName || m.fromAddress) + '</div>' +
                    '<div class="mail-subject">' + escapeHtml(m.subject) + '</div>' +
                    '<div class="mail-time">' + timeStr + '</div>' +
                    '<div class="mail-body">' + renderBody(m) + '</div>' +
                    '</div>';
            }).join('');
        }

        function renderBody(mail) {
            if (mail.bodyHtml) {
                const doc = escapeAttr(mail.bodyHtml);
                const resize = 'this.style.height=this.contentDocument.body.scrollHeight+\\'px\\'';
                return '<iframe srcdoc="' + doc + '" sandbox="allow-same-origin" onload="' + resize + '"></iframe>';
            }
            return '<pre style="white-space:pre-wrap">' + escapeHtml(mail.bodyText || '(无正文)') + '</pre>';
        }

        function toggleCard(el) { el.classList.toggle('expanded'); }

        function copyCode(e, code, btn) {
            e.stopPropagation();
            navigator.clipboard.writeText(code).then(() => {
                btn.textContent = '已复制 ✓';
                btn.classList.add('copied');
                setTimeout(() => { btn.textContent = '复制'; btn.classList.remove('copied'); }, 2000);
            });
        }

        function goBack() {
            document.getElementById('queryCard').style.display = 'block';
            document.getElementById('resultSection').style.display = 'none';
        }

        function showMsg(text, type) {
            const box = document.getElementById('msgBox');
            box.className = 'msg ' + type;
            box.textContent = text;
        }
        function hideMsg() { document.getElementById('msgBox').className = 'msg'; }

        function formatTime(iso) {
            if (!iso) return '';
            const d = new Date(iso);
            const now = Date.now();
            const diff = (now - d.getTime()) / 1000;
            if (diff < 60) return '刚刚';
            if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
            if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
            if (diff < 604800) return Math.floor(diff / 86400) + ' 天前';
            return d.toLocaleDateString('zh-CN') + ' ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        }

        function escapeHtml(str) {
            return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        }
        function escapeAttr(str) {
            return (str || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        }
    </script>
</body>
</html>`;
