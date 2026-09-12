export const PORTAL_JS = `// iCloud Relay Mail Query Portal Script
// Fully complies with CSP directive script-src 'self' (No inline event handlers)

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
        initNavBack();
        initInputListeners();
        initActionButtons();
        initEventDelegation();
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

    // ====== Navigation ======
    function initNavBack() {
        const backLink = document.getElementById('navBackLink');
        if (!backLink) return;

        backLink.addEventListener('click', (e) => {
            e.preventDefault();
            // If user has in-site history, back instantly via BFCache without page reload
            const hasInternalHistory = window.history.length > 1 &&
                document.referrer &&
                document.referrer.indexOf(window.location.host) !== -1;

            if (hasInternalHistory) {
                window.history.back();
            } else {
                window.location.href = backLink.getAttribute('href') || '/services';
            }
        });
    }

    // ====== Input Listeners ======
    function initInputListeners() {
        const input = document.getElementById('codeInput');
        if (!input) return;

        input.addEventListener('input', () => {
            toggleClearButton();
            hideMsg();
            const wrapper = document.getElementById('inputWrapper');
            if (wrapper) wrapper.classList.remove('has-error');
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                window.doQuery();
            }
        });
    }

    function initActionButtons() {
        const queryBtn = document.getElementById('queryBtn');
        if (queryBtn) {
            queryBtn.addEventListener('click', () => window.doQuery());
        }

        const pasteBtn = document.getElementById('pasteBtn');
        if (pasteBtn) {
            pasteBtn.addEventListener('click', () => window.pasteFromClipboard());
        }

        const clearBtn = document.getElementById('clearBtn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => window.clearInput());
        }

        const backQueryBtn = document.getElementById('backQueryBtn');
        if (backQueryBtn) {
            backQueryBtn.addEventListener('click', () => window.goBack());
        }

        const refreshNowBtn = document.getElementById('refreshNowBtn');
        if (refreshNowBtn) {
            refreshNowBtn.addEventListener('click', () => window.refreshCurrentQuery());
        }

        const clearAllBtn = document.getElementById('clearAllHistoryBtn');
        if (clearAllBtn) {
            clearAllBtn.addEventListener('click', () => window.clearAllHistory());
        }

        const autoToggle = document.getElementById('autoRefreshToggle');
        if (autoToggle) {
            autoToggle.addEventListener('change', function() {
                window.toggleAutoRefresh(this);
            });
        }

        const filterSel = document.getElementById('filterSelect');
        if (filterSel) {
            filterSel.addEventListener('change', () => window.filterMails());
        }
    }

    // ====== Event Delegation (CSP compliant, no inline onclick) ======
    function initEventDelegation() {
        // Message box action buttons delegation
        const msgBox = document.getElementById('msgBox');
        if (msgBox) {
            msgBox.addEventListener('click', (e) => {
                const target = e.target.closest('[data-action]');
                if (!target) return;
                const action = target.getAttribute('data-action');
                if (action === 'paste') {
                    window.pasteFromClipboard();
                } else if (action === 'clear') {
                    window.clearInput();
                } else if (action === 'retry') {
                    window.doQuery();
                }
            });
        }

        // Recent list delegation
        const recentList = document.getElementById('recentList');
        if (recentList) {
            recentList.addEventListener('click', (e) => {
                const delBtn = e.target.closest('.recent-del-btn');
                if (delBtn) {
                    e.stopPropagation();
                    const code = delBtn.getAttribute('data-code');
                    if (code) window.deleteRecentQuery(e, code);
                    return;
                }
                const item = e.target.closest('.recent-item');
                if (item) {
                    const code = item.getAttribute('data-code');
                    if (code) window.selectRecentQuery(code);
                }
            });
        }

        // Mail list delegation
        const mailList = document.getElementById('mailList');
        if (mailList) {
            mailList.addEventListener('click', (e) => {
                const copyBtn = e.target.closest('.otp-copy-btn');
                if (copyBtn) {
                    e.stopPropagation();
                    const code = copyBtn.getAttribute('data-otp');
                    if (code) window.copyOtpCode(e, code, copyBtn);
                    return;
                }
                const toggleBtn = e.target.closest('.toggle-body-btn');
                if (toggleBtn) {
                    const cardId = toggleBtn.getAttribute('data-card-id');
                    if (cardId) {
                        const card = document.getElementById(cardId);
                        if (card) {
                            card.classList.toggle('open');
                            const span = toggleBtn.querySelector('span');
                            if (span) {
                                span.textContent = card.classList.contains('open') ? '收起正文 ▲' : '查看邮件正文 ▼';
                            }
                        }
                    }
                    return;
                }
                const emptyRefresh = e.target.closest('#emptyRefreshBtn');
                if (emptyRefresh) {
                    window.refreshCurrentQuery();
                    return;
                }
                const emptyAuto = e.target.closest('#emptyAutoRefreshBtn');
                if (emptyAuto) {
                    const toggle = document.getElementById('autoRefreshToggle');
                    if (toggle && !toggle.checked) {
                        toggle.checked = true;
                        window.toggleAutoRefresh(toggle);
                    }
                }
            });
        }
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
                showMsg('剪贴板中未找到文本内容，请先复制查询码', 'info', {
                    title: 'ℹ️ 剪贴板为空'
                });
                return;
            }
            const cleaned = cleanCode(text);
            if (!cleaned) {
                showMsg('剪贴板内容中未识别到有效查询码', 'warning', {
                    title: '⚠️ 未识别到查询码'
                });
                return;
            }
            const input = document.getElementById('codeInput');
            if (input) {
                input.value = cleaned;
                toggleClearButton();
                hideMsg();
                const wrapper = document.getElementById('inputWrapper');
                if (wrapper) wrapper.classList.remove('has-error');
            }
            showMsg('已成功粘贴查询码 ✓', 'success', {
                title: '✓ 粘贴成功'
            });
            setTimeout(hideMsg, 2000);
        } catch (err) {
            fallbackPastePrompt();
        }
    };

    function fallbackPastePrompt() {
        const pasted = window.prompt('请在此粘贴您的查询码:');
        if (pasted) {
            const input = document.getElementById('codeInput');
            if (input) {
                input.value = cleanCode(pasted);
                toggleClearButton();
                hideMsg();
                const wrapper = document.getElementById('inputWrapper');
                if (wrapper) wrapper.classList.remove('has-error');
            }
        }
    }

    window.clearInput = function() {
        const input = document.getElementById('codeInput');
        if (input) {
            input.value = '';
            input.focus();
            toggleClearButton();
            hideMsg();
            const wrapper = document.getElementById('inputWrapper');
            if (wrapper) wrapper.classList.remove('has-error');
        }
    };

    // ====== Query Execution ======
    window.doQuery = async function(customCode) {
        const input = document.getElementById('codeInput');
        const rawCode = customCode || (input ? input.value : '');
        const code = cleanCode(rawCode);

        if (!code) {
            showMsg(
                '请输入专属查询码。查询码通常由商家在商品发货卡密中提供（例如 BUY-XXXX-XXXX）。若已复制，可直接点击下方粘贴。',
                'error',
                {
                    title: '⚠️ 请输入专属查询码',
                    isHtml: false,
                    actions: '<button type="button" class="msg-action-btn btn-secondary" data-action="paste">📋 从剪贴板粘贴</button>'
                }
            );
            if (input) input.focus();
            return;
        }

        if (code.length < 5) {
            showMsg(
                '您输入的查询码字符较短（仅 ' + code.length + ' 位）。完整查询码通常形如 BUY-A1B2-C3D4，请确认是否复制完整。',
                'warning',
                {
                    title: '⚠️ 查询码格式似乎不完整',
                    isHtml: false,
                    actions: '<button type="button" class="msg-action-btn btn-secondary" data-action="paste">📋 重新从剪贴板粘贴</button>' +
                             '<button type="button" class="msg-action-btn btn-secondary" data-action="clear">清空重输</button>'
                }
            );
            if (input) input.focus();
            return;
        }

        currentQueryCode = code;
        if (input) input.value = code;

        const btn = document.getElementById('queryBtn');
        const btnText = document.getElementById('btnText');
        if (btn) btn.disabled = true;
        if (input) input.readOnly = true;
        if (btnText) {
            btnText.innerHTML = '<span class="btn-spinner"></span> 正在查询邮件...';
        }
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
                const serverMsg = data?.message || '无效的查询码，请核对后重试';
                const isExpired = serverMsg.includes('过期') || serverMsg.includes('失效');

                if (isExpired) {
                    showMsg(
                        '该查询码的使用期限已截止，无法继续接收新邮件。如需继续使用，请联系客服续期或更换新账号。',
                        'warning',
                        {
                            title: '⏳ 查询码使用期限已届满',
                            isHtml: false,
                            actions: '<a href="/support" class="msg-action-btn btn-secondary" target="_blank">联系客服续期</a>' +
                                     '<button type="button" class="msg-action-btn btn-secondary" data-action="clear">查询其他卡密</button>'
                        }
                    );
                } else {
                    showMsg(
                        '云端系统中未检索到查询码 <code>' + escapeHtml(code) + '</code>。<br>' +
                        '① 若刚完成卡密购买，云端数据同步通常需 10~30 秒，建议稍等片刻后点击重新查询；<br>' +
                        '② 请核对复制的卡密是否多选或漏选了字符；<br>' +
                        '③ 如确认无误仍无法查询，请点击下方联系客服协助核验。',
                        'error',
                        {
                            title: '❌ 未找到匹配的邮件查询码',
                            isHtml: true,
                            actions: '<button type="button" class="msg-action-btn btn-secondary" data-action="retry">🔄 重新查询</button>' +
                                     '<button type="button" class="msg-action-btn btn-secondary" data-action="clear">清空重输</button>' +
                                     '<a href="/support" class="msg-action-btn btn-link" target="_blank">联系在线客服 →</a>'
                        }
                    );
                }
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
            showMsg(
                '无法连接到邮件服务接口，可能是网络波动或Wi-Fi断连。请检查网络状态后点击重试。',
                'error',
                {
                    title: '📡 网络连接请求失败',
                    isHtml: false,
                    actions: '<button type="button" class="msg-action-btn btn-secondary" data-action="retry">🔄 立即重试</button>'
                }
            );
        } finally {
            if (btn) btn.disabled = false;
            if (input) input.readOnly = false;
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
                '<div class="empty-title">暂未收到任何邮件</div>' +
                '<div class="empty-desc">虚拟邮箱已处于实时监听状态，第三方发送验证码后通常在 5 ~ 30 秒内送达</div>' +
                '<div style="display:flex; justify-content:center; gap:10px; margin-top:16px; flex-wrap:wrap;">' +
                '<button type="button" class="refresh-now-btn" id="emptyRefreshBtn" style="margin:0;">🔄 检查新邮件</button>' +
                '<button type="button" class="empty-autorefresh-btn" id="emptyAutoRefreshBtn">⚡ 开启自动刷新</button>' +
                '</div>' +
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
                    '  <button type="button" class="otp-copy-btn" data-otp="' + escapeAttr(m.extractedCode) + '">一键复制</button>' +
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
                '  <button type="button" class="toggle-body-btn" data-card-id="mailCard_' + idx + '">' +
                '    <span>查看邮件正文 ▼</span>' +
                '  </button>' +
                '  <div class="mail-body-content" id="mailBody_' + idx + '">' +
                     renderBodyContent(m) +
                '  </div>' +
                '</div>'
            );
        }).join('');

        // Attach load listener to iframes to auto-adjust height without inline onload
        list.querySelectorAll('iframe.mail-iframe').forEach(iframe => {
            iframe.addEventListener('load', () => {
                try {
                    if (iframe.contentDocument && iframe.contentDocument.body) {
                        iframe.style.height = (iframe.contentDocument.body.scrollHeight + 20) + 'px';
                    }
                } catch (e) {}
            });
        });
    }

    function renderBodyContent(mail) {
        if (mail.bodyHtml) {
            const doc = escapeAttr(mail.bodyHtml);
            return '<iframe class="mail-iframe" srcdoc="' + doc + '" sandbox="allow-same-origin"></iframe>';
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
                '<div class="recent-item" data-code="' + escapeAttr(item.code) + '">' +
                '  <div class="recent-left">' +
                '    <span class="recent-code">' + escapeHtml(item.code) + '</span>' +
                (alias ? '    <span class="recent-alias">' + alias + '</span>' : '') +
                '  </div>' +
                '  <div class="recent-right">' +
                '    <span class="recent-time">' + timeAgo + '</span>' +
                '    <button type="button" class="recent-del-btn" data-code="' + escapeAttr(item.code) + '" title="删除记录">✕</button>' +
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

    // ====== Feedback Messages & Utilities ======
    function triggerInputShake() {
        const wrapper = document.getElementById('inputWrapper');
        if (wrapper) {
            wrapper.classList.remove('has-error');
            void wrapper.offsetWidth; // trigger DOM reflow
            wrapper.classList.add('has-error');
        }
    }

    function showMsg(message, type, options) {
        const box = document.getElementById('msgBox');
        if (!box) return;

        type = type || 'error';
        options = options || {};
        let title = options.title || '';
        let body = typeof message === 'string' ? message : '';
        let actions = options.actions || '';

        if (type === 'error') {
            triggerInputShake();
            if (!title) title = '⚠️ 查询异常';
        } else if (type === 'warning') {
            triggerInputShake();
            if (!title) title = '⏳ 注意事项';
        } else if (type === 'success') {
            if (!title) title = '✓ 操作成功';
        } else if (type === 'info') {
            if (!title) title = 'ℹ️ 提示信息';
        }

        let headerHtml = '<div class="msg-header">' + escapeHtml(title) + '</div>';
        let bodyHtml = '<div class="msg-body">' + (options.isHtml ? body : escapeHtml(body)) + '</div>';
        let actionsHtml = actions ? '<div class="msg-actions">' + actions + '</div>' : '';

        box.className = 'toast-msg ' + type;
        box.innerHTML = headerHtml + bodyHtml + actionsHtml;
        box.style.display = 'flex';
    }

    function hideMsg() {
        const box = document.getElementById('msgBox');
        if (!box) return;
        box.className = 'toast-msg';
        box.innerHTML = '';
        box.style.display = 'none';
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
