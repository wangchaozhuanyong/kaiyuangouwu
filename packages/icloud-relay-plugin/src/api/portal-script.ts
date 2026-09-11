export const PORTAL_JS = `// iCloud Relay Mail Query Portal Script
// Fully complies with CSP directive script-src 'self'

(function() {
    'use strict';

    const API_ENDPOINT = '/shop-api';
    const STORAGE_KEY = 'icloud_relay_recent_queries';
    let currentQueryCode = '';
    let allMails = [];
    let virtualEmailsList = [];
    let autoRefreshTimer = null;
    let countdownInterval = null;
    let countdownSeconds = 10;

    // Initialize on DOM load
    document.addEventListener('DOMContentLoaded', () => {
        initInputListeners();
        renderRecentQueries();

        // If URL has ?code=XXX or ?q=XXX, auto fill and query
        const urlParams = new URLSearchParams(window.location.search);
        const paramCode = urlParams.get('code') || urlParams.get('q');
        if (paramCode) {
            const input = document.getElementById('codeInput');
            if (input) {
                input.value = cleanCode(paramCode);
                toggleClearButton();
                window.doQuery();
            }
        }
    });

    function initInputListeners() {
        const input = document.getElementById('codeInput');
        if (!input) return;

        input.addEventListener('input', () => {
            toggleClearButton();
            hideMsg();
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                window.doQuery();
            }
        });
    }

    function toggleClearButton() {
        const input = document.getElementById('codeInput');
        const clearBtn = document.getElementById('clearBtn');
        if (!input || !clearBtn) return;
        clearBtn.style.display = input.value.trim() ? 'flex' : 'none';
    }

    function cleanCode(str) {
        if (!str) return '';
        // Extract BUY-XXXX-XXXX or MST-XXXX-XXXX or clean raw string
        const match = str.match(/(?:BUY|MST)-[A-Za-z0-9]{3,8}-[A-Za-z0-9]{3,8}/i);
        if (match) return match[0].toUpperCase();
        return str.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
    }

    // ====== Paste Feature ======
    window.pasteFromClipboard = async function() {
        try {
            if (!navigator.clipboard || !navigator.clipboard.readText) {
                fallbackPastePrompt();
                return;
            }
            const text = await navigator.clipboard.readText();
            if (!text || !text.trim()) {
                showMsg('剪贴板为空，请先复制查询码', 'info');
                return;
            }
            const cleaned = cleanCode(text);
            const input = document.getElementById('codeInput');
            input.value = cleaned;
            toggleClearButton();
            showMsg('已成功粘贴查询码 ✓', 'success');
            setTimeout(hideMsg, 2000);
        } catch (err) {
            fallbackPastePrompt();
        }
    };

    function fallbackPastePrompt() {
        const pasted = window.prompt('请在此粘贴您的查询码:');
        if (pasted) {
            const input = document.getElementById('codeInput');
            input.value = cleanCode(pasted);
            toggleClearButton();
        }
    }

    window.clearInput = function() {
        const input = document.getElementById('codeInput');
        if (input) {
            input.value = '';
            input.focus();
            toggleClearButton();
            hideMsg();
        }
    };

    // ====== Query Execution ======
    window.doQuery = async function(customCode) {
        const input = document.getElementById('codeInput');
        const rawCode = customCode || (input ? input.value : '');
        const code = cleanCode(rawCode);

        if (!code) {
            showMsg('请输入专属查询码', 'error');
            if (input) input.focus();
            return;
        }

        currentQueryCode = code;
        if (input) input.value = code;

        const btn = document.getElementById('queryBtn');
        const btnText = document.getElementById('btnText');
        if (btn) btn.disabled = true;
        if (btnText) btnText.textContent = '正在查询邮件...';
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
                showMsg(data?.message || '无效的查询码，请检查后重试', 'error');
                return;
            }

            allMails = data.items || [];
            virtualEmailsList = data.virtualEmailsList || [];

            // Save to recent queries in localStorage
            saveRecentQuery({
                code: code,
                targetType: data.targetType,
                aliasEmail: data.aliasEmail || data.primaryEmail || '',
                totalEmails: data.totalEmails || 0,
                updatedAt: Date.now()
            });

            showResults(data);
        } catch (err) {
            showMsg('网络连接异常，请稍后重试', 'error');
        } finally {
            if (btn) btn.disabled = false;
            if (btnText) btnText.textContent = '查 询 邮 件';
        }
    };

    window.refreshCurrentQuery = async function() {
        if (!currentQueryCode) return;
        const refreshBtn = document.getElementById('refreshNowBtn');
        if (refreshBtn) {
            refreshBtn.disabled = true;
            refreshBtn.innerHTML = '<span>🔄</span> 正在刷新...';
        }

        try {
            const res = await fetch(API_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    query: \`query RefreshMails($code: String!) {
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
                    variables: { code: currentQueryCode }
                })
            });
            const json = await res.json();
            const data = json.data?.icloudQueryMails;
            if (data && data.success) {
                allMails = data.items || [];
                showResults(data);
            }
        } catch (e) {
            // Ignore background refresh errors
        } finally {
            if (refreshBtn) {
                refreshBtn.disabled = false;
                refreshBtn.innerHTML = '<span>🔄</span> 立即刷新';
            }
        }
    };

    // ====== Display Results ======
    function showResults(data) {
        document.getElementById('queryCard').style.display = 'none';
        const recentSec = document.getElementById('recentSection');
        if (recentSec) recentSec.style.display = 'none';

        const section = document.getElementById('resultSection');
        section.style.display = 'block';

        // Summary Info
        const emailLabel = data.aliasEmail || data.primaryEmail || 'iCloud 邮箱';
        const summaryEmail = document.getElementById('summaryEmail');
        if (summaryEmail) {
            const typePill = data.targetType === 'PRIMARY_MASTER'
                ? '<span class="code-type-pill pill-master">主管理码</span>'
                : '<span class="code-type-pill pill-buyer">买家专属</span>';
            summaryEmail.innerHTML = '<span>' + escapeHtml(emailLabel) + '</span>' + typePill;
        }

        const totalMailCount = document.getElementById('totalMailCount');
        if (totalMailCount) {
            totalMailCount.textContent = '共 ' + (data.totalEmails || 0) + ' 封邮件';
        }

        const remainingDaysBox = document.getElementById('remainingDaysBox');
        const remainingDaysText = document.getElementById('remainingDaysText');
        if (data.remainingDays != null && remainingDaysBox && remainingDaysText) {
            remainingDaysBox.style.display = 'flex';
            remainingDaysText.textContent = '有效期剩余 ' + data.remainingDays + ' 天';
        } else if (remainingDaysBox) {
            remainingDaysBox.style.display = 'none';
        }

        // Filter Bar (for master code)
        const filterWrapper = document.getElementById('filterWrapper');
        if (virtualEmailsList.length > 0 && filterWrapper) {
            filterWrapper.style.display = 'block';
            const select = document.getElementById('filterSelect');
            select.innerHTML = '<option value="">全部虚拟邮箱 (' + allMails.length + ' 封邮件)</option>';
            virtualEmailsList.forEach(v => {
                select.innerHTML += '<option value="' + escapeAttr(v.aliasEmail) + '">' +
                    escapeHtml(v.aliasEmail) + (v.note ? ' (' + escapeHtml(v.note) + ')' : '') + '</option>';
            });
        } else if (filterWrapper) {
            filterWrapper.style.display = 'none';
        }

        renderMails(allMails);
    }

    window.filterMails = function() {
        const select = document.getElementById('filterSelect');
        const filter = select ? select.value : '';
        if (!filter) {
            renderMails(allMails);
            return;
        }
        renderMails(allMails.filter(m => m.targetEmail === filter));
    };

    function renderMails(mails) {
        const list = document.getElementById('mailList');
        if (!list) return;

        if (!mails || mails.length === 0) {
            list.innerHTML =
                '<div class="empty-mail-box">' +
                '<div class="empty-icon">📭</div>' +
                '<div class="empty-title">暂未收到邮件</div>' +
                '<div class="empty-desc">系统正在持续监听新邮件，第三方发出验证码后通常在 5~30 秒内到达</div>' +
                '<button type="button" class="refresh-now-btn" onclick="refreshCurrentQuery()" style="margin: 0 auto;">🔄 检查新邮件</button>' +
                '</div>';
            return;
        }

        list.innerHTML = mails.map((m, idx) => {
            const timeStr = formatTime(m.receivedAt);
            let otpHtml = '';
            if (m.extractedCode) {
                otpHtml =
                    '<div class="otp-banner">' +
                    '  <div class="otp-info">' +
                    '    <span class="otp-title">🔑 提取到的验证码</span>' +
                    '    <span class="otp-code-text">' + escapeHtml(m.extractedCode) + '</span>' +
                    '  </div>' +
                    '  <button type="button" class="otp-copy-btn" onclick="copyOtpCode(event, \\'' + escapeAttr(m.extractedCode) + '\\', this)">一键复制</button>' +
                    '</div>';
            }

            return (
                '<div class="mail-card" id="mailCard_' + idx + '">' +
                otpHtml +
                '  <div class="mail-meta-row">' +
                '    <span class="mail-from">📤 ' + escapeHtml(m.fromName || m.fromAddress || '未知发件人') + '</span>' +
                '    <span>' + timeStr + '</span>' +
                '  </div>' +
                '  <div class="mail-subject">' + escapeHtml(m.subject || '(无主题)') + '</div>' +
                '  <button type="button" class="toggle-body-btn" onclick="toggleMailCard(' + idx + ')">' +
                '    <span>查看邮件正文 ▼</span>' +
                '  </button>' +
                '  <div class="mail-body-content" id="mailBody_' + idx + '">' +
                     renderBodyContent(m) +
                '  </div>' +
                '</div>'
            );
        }).join('');
    }

    function renderBodyContent(mail) {
        if (mail.bodyHtml) {
            const doc = escapeAttr(mail.bodyHtml);
            const resizeScript = 'this.style.height=this.contentDocument.body.scrollHeight+\\'px\\'';
            return '<iframe srcdoc="' + doc + '" sandbox="allow-same-origin" onload="' + resizeScript + '"></iframe>';
        }
        return '<pre>' + escapeHtml(mail.bodyText || '(此邮件无正文内容)') + '</pre>';
    }

    window.toggleMailCard = function(idx) {
        const card = document.getElementById('mailCard_' + idx);
        if (card) {
            card.classList.toggle('open');
            const btn = card.querySelector('.toggle-body-btn span');
            if (btn) {
                btn.textContent = card.classList.contains('open') ? '收起正文 ▲' : '查看邮件正文 ▼';
            }
        }
    };

    window.copyOtpCode = function(e, code, btn) {
        if (e) e.stopPropagation();
        if (!navigator.clipboard || !navigator.clipboard.writeText) {
            fallbackCopy(code);
            updateCopyBtnState(btn);
            return;
        }
        navigator.clipboard.writeText(code).then(() => {
            updateCopyBtnState(btn);
        }).catch(() => {
            fallbackCopy(code);
            updateCopyBtnState(btn);
        });
    };

    function updateCopyBtnState(btn) {
        if (!btn) return;
        const originalText = btn.textContent;
        btn.textContent = '已复制 ✓';
        btn.classList.add('copied');
        setTimeout(() => {
            btn.textContent = originalText;
            btn.classList.remove('copied');
        }, 2000);
    }

    function fallbackCopy(text) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        try { document.execCommand('copy'); } catch(e) {}
        document.body.removeChild(textarea);
    }

    // ====== Auto Refresh Feature ======
    window.toggleAutoRefresh = function(checkbox) {
        const cd = document.getElementById('countdownText');
        if (checkbox.checked) {
            countdownSeconds = 10;
            if (cd) cd.textContent = countdownSeconds + 's';
            countdownInterval = setInterval(() => {
                countdownSeconds--;
                if (countdownSeconds <= 0) {
                    countdownSeconds = 10;
                    window.refreshCurrentQuery();
                }
                if (cd) cd.textContent = countdownSeconds + 's';
            }, 1000);
        } else {
            if (countdownInterval) clearInterval(countdownInterval);
            countdownInterval = null;
            if (cd) cd.textContent = '';
        }
    };

    window.goBack = function() {
        if (autoRefreshTimer) clearInterval(autoRefreshTimer);
        if (countdownInterval) clearInterval(countdownInterval);
        const toggle = document.getElementById('autoRefreshToggle');
        if (toggle) toggle.checked = false;
        const cd = document.getElementById('countdownText');
        if (cd) cd.textContent = '';

        document.getElementById('queryCard').style.display = 'block';
        document.getElementById('resultSection').style.display = 'none';
        renderRecentQueries();
    };

    // ====== LocalStorage Recent Queries ======
    function getRecentQueries() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            return [];
        }
    }

    function saveRecentQuery(record) {
        try {
            let list = getRecentQueries();
            list = list.filter(item => item.code !== record.code);
            list.unshift(record);
            if (list.length > 6) list = list.slice(0, 6);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
        } catch (e) {}
    }

    function renderRecentQueries() {
        const section = document.getElementById('recentSection');
        const listEl = document.getElementById('recentList');
        if (!section || !listEl) return;

        const list = getRecentQueries();
        if (list.length === 0) {
            section.style.display = 'none';
            return;
        }

        section.style.display = 'block';
        listEl.innerHTML = list.map(item => {
            const timeAgo = formatTime(item.updatedAt);
            const alias = item.aliasEmail ? escapeHtml(item.aliasEmail) : '';
            return (
                '<div class="recent-item" onclick="selectRecentQuery(\\'' + escapeAttr(item.code) + '\\')">' +
                '  <div class="recent-left">' +
                '    <span class="recent-code">' + escapeHtml(item.code) + '</span>' +
                (alias ? '    <span class="recent-alias">' + alias + '</span>' : '') +
                '  </div>' +
                '  <div class="recent-right">' +
                '    <span class="recent-time">' + timeAgo + '</span>' +
                '    <button type="button" class="recent-del-btn" title="删除记录" ' +
                '            onclick="deleteRecentQuery(event, \\'' + escapeAttr(item.code) + '\\')">✕</button>' +
                '  </div>' +
                '</div>'
            );
        }).join('');
    }

    window.selectRecentQuery = function(code) {
        const input = document.getElementById('codeInput');
        if (input) input.value = code;
        toggleClearButton();
        window.doQuery(code);
    };

    window.deleteRecentQuery = function(e, code) {
        if (e) e.stopPropagation();
        try {
            let list = getRecentQueries();
            list = list.filter(item => item.code !== code);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
            renderRecentQueries();
        } catch (err) {}
    };

    window.clearAllHistory = function() {
        try {
            localStorage.removeItem(STORAGE_KEY);
            renderRecentQueries();
        } catch (err) {}
    };

    // ====== Utilities ======
    function showMsg(text, type) {
        const box = document.getElementById('msgBox');
        if (!box) return;
        box.className = 'toast-msg ' + type;
        box.textContent = text;
    }

    function hideMsg() {
        const box = document.getElementById('msgBox');
        if (!box) return;
        box.className = 'toast-msg';
        box.textContent = '';
    }

    function formatTime(isoOrTimestamp) {
        if (!isoOrTimestamp) return '';
        const d = new Date(isoOrTimestamp);
        const now = Date.now();
        const diff = Math.floor((now - d.getTime()) / 1000);
        if (diff < 30) return '刚刚';
        if (diff < 60) return diff + '秒前';
        if (diff < 3600) return Math.floor(diff / 60) + '分钟前';
        if (diff < 86400) return Math.floor(diff / 3600) + '小时前';
        if (diff < 604800) return Math.floor(diff / 86400) + '天前';
        return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) + ' ' +
               d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
    }

    function escapeHtml(str) {
        return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function escapeAttr(str) {
        return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
})();
`;
