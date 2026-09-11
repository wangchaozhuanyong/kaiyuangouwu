export const PORTAL_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>邮件验证码查询中心 - MOYAO AI</title>
    <style>
        :root {
            --primary: #2563eb;
            --primary-hover: #1d4ed8;
            --primary-light: #eff6ff;
            --primary-border: #bfdbfe;
            --success: #16a34a;
            --success-light: #f0fdf4;
            --error: #dc2626;
            --error-light: #fef2f2;
            --warning: #d97706;
            --bg: #f8fafc;
            --card-bg: #ffffff;
            --text: #0f172a;
            --text-secondary: #64748b;
            --text-muted: #94a3b8;
            --border: #e2e8f0;
            --border-hover: #cbd5e1;
            --radius-sm: 8px;
            --radius: 12px;
            --radius-lg: 16px;
            --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
            --shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.07), 0 2px 4px -2px rgba(0, 0, 0, 0.05);
            --shadow-md: 0 10px 15px -3px rgba(0, 0, 0, 0.08), 0 4px 6px -4px rgba(0, 0, 0, 0.04);
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
            background: var(--bg);
            color: var(--text);
            min-height: 100vh;
            line-height: 1.5;
            -webkit-font-smoothing: antialiased;
        }

        /* ====== Top Nav ====== */
        .top-nav {
            background: #ffffff;
            border-bottom: 1px solid var(--border);
            position: sticky;
            top: 0;
            z-index: 50;
            box-shadow: var(--shadow-sm);
        }
        .top-nav-inner {
            max-width: 680px;
            margin: 0 auto;
            padding: 12px 16px;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .nav-back-link {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            font-size: 13px;
            font-weight: 500;
            color: var(--text-secondary);
            text-decoration: none;
            padding: 6px 12px;
            border-radius: var(--radius-sm);
            transition: all 0.15s ease;
            background: #f1f5f9;
        }
        .nav-back-link:hover {
            color: var(--primary);
            background: var(--primary-light);
        }
        .nav-status {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            font-size: 12px;
            color: var(--success);
            background: var(--success-light);
            border: 1px solid #bbf7d0;
            padding: 4px 10px;
            border-radius: 9999px;
            font-weight: 500;
        }
        .status-dot {
            width: 7px;
            height: 7px;
            border-radius: 50%;
            background-color: var(--success);
            animation: pulse-dot 2s infinite;
        }
        @keyframes pulse-dot {
            0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(22, 163, 74, 0.7); }
            70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(22, 163, 74, 0); }
            100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(22, 163, 74, 0); }
        }

        /* ====== Main Container ====== */
        .container {
            max-width: 680px;
            margin: 0 auto;
            padding: 24px 16px 48px;
        }

        /* ====== Hero Header ====== */
        .hero-section {
            text-align: center;
            margin-bottom: 24px;
        }
        .hero-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 4px 12px;
            background: var(--primary-light);
            color: var(--primary);
            font-size: 12px;
            font-weight: 600;
            border-radius: 9999px;
            margin-bottom: 12px;
            border: 1px solid var(--primary-border);
        }
        .hero-title {
            font-size: 24px;
            font-weight: 700;
            color: var(--text);
            letter-spacing: -0.5px;
            margin-bottom: 8px;
        }
        .hero-subtitle {
            font-size: 14px;
            color: var(--text-secondary);
            max-width: 480px;
            margin: 0 auto 16px;
        }
        .feature-chips {
            display: flex;
            flex-wrap: wrap;
            justify-content: center;
            gap: 8px;
        }
        .chip {
            font-size: 12px;
            color: var(--text-secondary);
            background: #ffffff;
            border: 1px solid var(--border);
            padding: 4px 10px;
            border-radius: var(--radius-sm);
            display: inline-flex;
            align-items: center;
            gap: 4px;
        }

        /* ====== Query Card ====== */
        .query-card {
            background: var(--card-bg);
            border-radius: var(--radius-lg);
            padding: 24px;
            box-shadow: var(--shadow);
            border: 1px solid var(--border);
            margin-bottom: 20px;
        }
        .card-label {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 13px;
            font-weight: 600;
            color: var(--text);
            margin-bottom: 10px;
        }
        .card-label-hint {
            font-size: 12px;
            color: var(--text-muted);
            font-weight: normal;
        }
        .input-wrapper {
            position: relative;
            display: flex;
            align-items: center;
            margin-bottom: 14px;
        }
        .input-icon {
            position: absolute;
            left: 14px;
            font-size: 16px;
            color: var(--text-muted);
            pointer-events: none;
            user-select: none;
        }
        .code-input {
            width: 100%;
            height: 50px;
            padding: 0 96px 0 44px;
            font-size: 16px;
            font-weight: 600;
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            letter-spacing: 1px;
            color: var(--text);
            background: #f8fafc;
            border: 1.5px solid var(--border);
            border-radius: var(--radius);
            outline: none;
            transition: all 0.2s ease;
            text-transform: uppercase;
        }
        .code-input::placeholder {
            font-size: 14px;
            letter-spacing: 0;
            color: var(--text-muted);
            font-weight: normal;
            text-transform: none;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        }
        .code-input:focus {
            background: #ffffff;
            border-color: var(--primary);
            box-shadow: 0 0 0 3.5px rgba(37, 99, 235, 0.12);
        }
        .input-actions {
            position: absolute;
            right: 8px;
            display: flex;
            align-items: center;
            gap: 4px;
        }
        .clear-btn {
            display: none;
            align-items: center;
            justify-content: center;
            width: 26px;
            height: 26px;
            background: #e2e8f0;
            color: var(--text-secondary);
            border: none;
            border-radius: 50%;
            font-size: 12px;
            cursor: pointer;
            transition: background 0.15s;
        }
        .clear-btn:hover { background: #cbd5e1; color: var(--text); }
        .paste-btn {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            height: 34px;
            padding: 0 12px;
            background: var(--primary-light);
            color: var(--primary);
            border: 1px solid var(--primary-border);
            border-radius: var(--radius-sm);
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.15s ease;
            white-space: nowrap;
        }
        .paste-btn:hover {
            background: #dbeafe;
            border-color: #93c5fd;
        }
        .paste-btn:active { transform: scale(0.97); }

        .query-btn {
            width: 100%;
            height: 48px;
            background: linear-gradient(135deg, var(--primary) 0%, #1d4ed8 100%);
            color: #ffffff;
            border: none;
            border-radius: var(--radius);
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(37, 99, 235, 0.25);
            transition: all 0.2s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
        }
        .query-btn:hover {
            box-shadow: 0 6px 16px rgba(37, 99, 235, 0.35);
            transform: translateY(-1px);
        }
        .query-btn:active {
            transform: translateY(0);
        }
        .query-btn:disabled {
            opacity: 0.65;
            cursor: not-allowed;
            transform: none;
            box-shadow: none;
        }

        /* ====== Messages & Toasts ====== */
        .toast-msg {
            margin-top: 12px;
            padding: 10px 14px;
            border-radius: var(--radius-sm);
            font-size: 13px;
            display: none;
            align-items: center;
            gap: 8px;
            animation: fadeIn 0.2s ease;
        }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
        .toast-msg.error { background: var(--error-light); color: var(--error); border: 1px solid #fecaca; display: flex; }
        .toast-msg.success { background: var(--success-light); color: var(--success); border: 1px solid #bbf7d0; display: flex; }
        .toast-msg.info { background: var(--primary-light); color: var(--primary); border: 1px solid var(--primary-border); display: flex; }

        /* ====== Recent Queries Section ====== */
        .recent-section {
            background: var(--card-bg);
            border-radius: var(--radius-lg);
            padding: 20px 24px;
            box-shadow: var(--shadow-sm);
            border: 1px solid var(--border);
            margin-bottom: 20px;
        }
        .section-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 14px;
        }
        .section-title {
            font-size: 14px;
            font-weight: 600;
            color: var(--text);
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .clear-all-link {
            font-size: 12px;
            color: var(--text-muted);
            background: none;
            border: none;
            cursor: pointer;
            padding: 2px 6px;
            border-radius: 4px;
        }
        .clear-all-link:hover { color: var(--error); }
        .recent-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .recent-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 14px;
            background: #f8fafc;
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            cursor: pointer;
            transition: all 0.15s ease;
        }
        .recent-item:hover {
            border-color: var(--primary);
            background: #f0fdf4;
            transform: translateX(2px);
        }
        .recent-left {
            display: flex;
            align-items: center;
            gap: 10px;
            min-width: 0;
        }
        .recent-code {
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            font-size: 14px;
            font-weight: 600;
            color: var(--primary);
            letter-spacing: 0.5px;
        }
        .recent-alias {
            font-size: 12px;
            color: var(--text-secondary);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .recent-right {
            display: flex;
            align-items: center;
            gap: 12px;
            flex-shrink: 0;
        }
        .recent-time {
            font-size: 11px;
            color: var(--text-muted);
        }
        .recent-del-btn {
            background: none;
            border: none;
            color: var(--text-muted);
            cursor: pointer;
            font-size: 14px;
            padding: 4px;
            border-radius: 4px;
            line-height: 1;
        }
        .recent-del-btn:hover { color: var(--error); }

        /* ====== Results View ====== */
        .result-section {
            display: none;
            animation: fadeIn 0.25s ease;
        }
        .result-nav-bar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 16px;
        }
        .back-query-btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: #ffffff;
            border: 1px solid var(--border);
            color: var(--text);
            font-size: 13px;
            font-weight: 600;
            padding: 8px 14px;
            border-radius: var(--radius-sm);
            cursor: pointer;
            box-shadow: var(--shadow-sm);
            transition: all 0.15s ease;
        }
        .back-query-btn:hover {
            border-color: var(--primary);
            color: var(--primary);
        }
        .auto-refresh-box {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 12px;
            color: var(--text-secondary);
            background: #ffffff;
            border: 1px solid var(--border);
            padding: 6px 12px;
            border-radius: var(--radius-sm);
        }
        .switch-toggle {
            position: relative;
            display: inline-block;
            width: 34px;
            height: 18px;
        }
        .switch-toggle input { opacity: 0; width: 0; height: 0; }
        .slider {
            position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0;
            background-color: #cbd5e1;
            transition: .2s;
            border-radius: 18px;
        }
        .slider:before {
            position: absolute; content: ""; height: 14px; width: 14px; left: 2px; bottom: 2px;
            background-color: white;
            transition: .2s;
            border-radius: 50%;
        }
        input:checked + .slider { background-color: var(--primary); }
        input:checked + .slider:before { transform: translateX(16px); }

        .result-summary-card {
            background: var(--card-bg);
            border-radius: var(--radius-lg);
            padding: 20px;
            box-shadow: var(--shadow);
            border: 1px solid var(--border);
            margin-bottom: 16px;
        }
        .summary-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 12px;
        }
        .summary-email {
            font-size: 16px;
            font-weight: 700;
            color: var(--text);
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .code-type-pill {
            font-size: 11px;
            padding: 2px 8px;
            border-radius: 9999px;
            font-weight: 600;
        }
        .pill-buyer { background: #dbeafe; color: #1e40af; }
        .pill-master { background: #fef3c7; color: #92400e; }
        .refresh-now-btn {
            background: var(--primary-light);
            color: var(--primary);
            border: 1px solid var(--primary-border);
            padding: 6px 12px;
            border-radius: var(--radius-sm);
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 4px;
            transition: all 0.15s;
        }
        .refresh-now-btn:hover { background: #dbeafe; }
        .summary-stats {
            display: flex;
            gap: 16px;
            font-size: 13px;
            color: var(--text-secondary);
            border-top: 1px solid var(--border);
            padding-top: 12px;
        }
        .summary-stat-item {
            display: flex;
            align-items: center;
            gap: 6px;
        }

        /* Filter bar for master query */
        .filter-wrapper {
            margin-bottom: 14px;
            display: none;
        }
        .filter-select {
            width: 100%;
            padding: 10px 14px;
            background: #ffffff;
            border: 1px solid var(--border);
            border-radius: var(--radius);
            font-size: 13px;
            color: var(--text);
            outline: none;
        }
        .filter-select:focus { border-color: var(--primary); }

        /* ====== Mail Cards ====== */
        .mail-list {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .mail-card {
            background: var(--card-bg);
            border-radius: var(--radius-lg);
            padding: 20px;
            box-shadow: var(--shadow-sm);
            border: 1px solid var(--border);
            transition: all 0.2s ease;
        }
        .mail-card:hover {
            border-color: var(--primary-border);
            box-shadow: var(--shadow);
        }
        /* Highlighted OTP Container */
        .otp-banner {
            background: linear-gradient(135deg, #eff6ff 0%, #f0fdf4 100%);
            border: 1.5px dashed #93c5fd;
            border-radius: var(--radius);
            padding: 16px;
            margin-bottom: 14px;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .otp-info {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .otp-title {
            font-size: 12px;
            color: var(--text-secondary);
            font-weight: 500;
        }
        .otp-code-text {
            font-size: 26px;
            font-weight: 800;
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            color: var(--primary);
            letter-spacing: 4px;
            line-height: 1.1;
        }
        .otp-copy-btn {
            background: var(--primary);
            color: #ffffff;
            border: none;
            padding: 8px 16px;
            border-radius: var(--radius-sm);
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            box-shadow: 0 2px 6px rgba(37, 99, 235, 0.25);
            transition: all 0.15s ease;
            white-space: nowrap;
        }
        .otp-copy-btn:hover { background: var(--primary-hover); }
        .otp-copy-btn.copied {
            background: var(--success);
            box-shadow: 0 2px 6px rgba(22, 163, 74, 0.25);
        }

        .mail-meta-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
            font-size: 12px;
            color: var(--text-muted);
        }
        .mail-from {
            font-weight: 600;
            color: var(--text-secondary);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            max-width: 70%;
        }
        .mail-subject {
            font-size: 15px;
            font-weight: 600;
            color: var(--text);
            margin-bottom: 10px;
            line-height: 1.4;
        }
        .toggle-body-btn {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            background: none;
            border: none;
            color: var(--primary);
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            padding: 4px 0;
        }
        .mail-body-content {
            display: none;
            margin-top: 14px;
            padding-top: 14px;
            border-top: 1px solid var(--border);
            font-size: 14px;
            color: var(--text);
            line-height: 1.6;
            word-break: break-word;
            max-height: 480px;
            overflow-y: auto;
        }
        .mail-body-content iframe {
            width: 100%;
            border: none;
            min-height: 240px;
            border-radius: var(--radius-sm);
        }
        .mail-body-content pre {
            white-space: pre-wrap;
            font-family: inherit;
            background: #f8fafc;
            padding: 12px;
            border-radius: var(--radius-sm);
            font-size: 13px;
        }
        .mail-card.open .mail-body-content { display: block; }

        .empty-mail-box {
            background: var(--card-bg);
            border-radius: var(--radius-lg);
            padding: 48px 24px;
            text-align: center;
            border: 1px solid var(--border);
        }
        .empty-icon { font-size: 40px; margin-bottom: 12px; }
        .empty-title { font-size: 16px; font-weight: 600; color: var(--text); margin-bottom: 6px; }
        .empty-desc { font-size: 13px; color: var(--text-secondary); max-width: 320px; margin: 0 auto 16px; }

        /* ====== FAQ Section ====== */
        .faq-section {
            background: var(--card-bg);
            border-radius: var(--radius-lg);
            padding: 24px;
            box-shadow: var(--shadow-sm);
            border: 1px solid var(--border);
            margin-bottom: 24px;
        }
        .faq-list {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .faq-item {
            padding-bottom: 12px;
            border-bottom: 1px solid var(--border);
        }
        .faq-item:last-child { border-bottom: none; padding-bottom: 0; }
        .faq-q {
            font-size: 14px;
            font-weight: 600;
            color: var(--text);
            margin-bottom: 4px;
            display: flex;
            align-items: flex-start;
            gap: 6px;
        }
        .faq-a {
            font-size: 13px;
            color: var(--text-secondary);
            line-height: 1.6;
            padding-left: 20px;
        }

        /* ====== Footer ====== */
        .portal-footer {
            text-align: center;
            font-size: 12px;
            color: var(--text-muted);
            line-height: 1.8;
            padding: 16px 0;
        }
        .portal-footer a {
            color: var(--primary);
            text-decoration: none;
        }

        /* Responsive tweaks */
        @media (max-width: 480px) {
            .container { padding: 16px 12px 36px; }
            .hero-title { font-size: 20px; }
            .query-card { padding: 20px 16px; }
            .code-input { font-size: 15px; }
            .otp-code-text { font-size: 22px; letter-spacing: 2px; }
            .otp-banner { flex-direction: column; align-items: flex-start; gap: 12px; }
            .otp-copy-btn { width: 100%; text-align: center; }
        }
    </style>
</head>
<body>
    <!-- Top Nav -->
    <header class="top-nav">
        <div class="top-nav-inner">
            <a href="/services" class="nav-back-link">
                <span>←</span> 返回商城服务
            </a>
            <div class="nav-status">
                <span class="status-dot"></span>
                <span>服务运行中</span>
            </div>
        </div>
    </header>

    <main class="container">
        <!-- Hero Header -->
        <section class="hero-section">
            <div class="hero-badge">⚡ MOYAO AI · 邮件中继服务</div>
            <h1 class="hero-title">邮件验证码实时查询中心</h1>
            <p class="hero-subtitle">输入买家专属查询码，实时收取 iCloud 邮箱验证码与通知邮件</p>
            <div class="feature-chips">
                <div class="chip">⚡ 秒级自动同步</div>
                <div class="chip">🔒 端到端隐私隔离</div>
                <div class="chip">📋 验证码一键复制</div>
                <div class="chip">⏱️ 倒计时自动刷新</div>
            </div>
        </section>

        <!-- Query Form Card -->
        <div class="query-card" id="queryCard">
            <div class="card-label">
                <span>🔑 专属查询码</span>
                <span class="card-label-hint">例: BUY-XXXX-XXXX 或 主查询码</span>
            </div>
            <div class="input-wrapper">
                <span class="input-icon">🔍</span>
                <input type="text" id="codeInput" class="code-input"
                       placeholder="输入查询码或点击右侧粘贴"
                       maxlength="20" autocomplete="off" spellcheck="false">
                <div class="input-actions">
                    <button type="button" class="clear-btn" id="clearBtn" title="清空" onclick="clearInput()">✕</button>
                    <button type="button" class="paste-btn" id="pasteBtn" title="从剪贴板粘贴" onclick="pasteFromClipboard()">
                        <span>📋</span> 粘贴
                    </button>
                </div>
            </div>
            <button type="button" class="query-btn" id="queryBtn" onclick="doQuery()">
                <span id="btnText">查 询 邮 件</span>
            </button>
            <div class="toast-msg" id="msgBox"></div>
        </div>

        <!-- Recent Queries Section -->
        <section class="recent-section" id="recentSection" style="display: none;">
            <div class="section-header">
                <div class="section-title">
                    <span>🕒</span> 最近查询记录
                </div>
                <button type="button" class="clear-all-link" onclick="clearAllHistory()">清空记录</button>
            </div>
            <div class="recent-list" id="recentList"></div>
        </section>

        <!-- Query Results Section -->
        <section class="result-section" id="resultSection">
            <div class="result-nav-bar">
                <button type="button" class="back-query-btn" onclick="goBack()">
                    <span>←</span> 重新查询
                </button>
                <div class="auto-refresh-box">
                    <span>自动刷新</span>
                    <label class="switch-toggle">
                        <input type="checkbox" id="autoRefreshToggle" onchange="toggleAutoRefresh(this)">
                        <span class="slider"></span>
                    </label>
                    <span id="countdownText" style="font-size: 11px; color: var(--primary); min-width: 24px;"></span>
                </div>
            </div>

            <!-- Summary Card -->
            <div class="result-summary-card">
                <div class="summary-header">
                    <div>
                        <div class="summary-email" id="summaryEmail">
                            <span>邮箱地址</span>
                            <span class="code-type-pill pill-buyer" id="summaryTypePill">买家专属</span>
                        </div>
                    </div>
                    <button type="button" class="refresh-now-btn" id="refreshNowBtn" onclick="refreshCurrentQuery()">
                        <span>🔄</span> 立即刷新
                    </button>
                </div>
                <div class="summary-stats">
                    <div class="summary-stat-item">
                        <span>📧</span>
                        <span id="totalMailCount">共 0 封邮件</span>
                    </div>
                    <div class="summary-stat-item" id="remainingDaysBox">
                        <span>⏳</span>
                        <span id="remainingDaysText">有效期剩余 30 天</span>
                    </div>
                </div>
            </div>

            <!-- Filter bar for master queries -->
            <div class="filter-wrapper" id="filterWrapper">
                <select id="filterSelect" class="filter-select" onchange="filterMails()">
                    <option value="">全部虚拟邮箱</option>
                </select>
            </div>

            <!-- Mail Cards List -->
            <div class="mail-list" id="mailList"></div>
        </section>

        <!-- FAQ & Help Section -->
        <section class="faq-section">
            <div class="section-header" style="margin-bottom: 16px;">
                <div class="section-title">
                    <span>💡</span> 常见问题与使用指南
                </div>
            </div>
            <div class="faq-list">
                <div class="faq-item">
                    <div class="faq-q">1. 查询码从哪里获取？</div>
                    <div class="faq-a">查询码通常在您购买商品的“发货卡密”、“订单详情”或商家发送的凭据中提供（一般格式为 <code>BUY-XXXX-XXXX</code>）。</div>
                </div>
                <div class="faq-item">
                    <div class="faq-q">2. 验证码多久能收到？</div>
                    <div class="faq-a">平台与 iCloud 邮件服务器保持实时互联，第三方服务发送验证码后，通常在 5 ~ 30 秒内送达。您可以开启上方的“自动刷新”或点击“立即刷新”。</div>
                </div>
                <div class="faq-item">
                    <div class="faq-q">3. 没收到邮件怎么办？</div>
                    <div class="faq-a">① 确认第三方发送的目标邮箱是否与本查询码绑定的邮箱完全一致；<br>② 第三方可能存在延迟，请等待 1~2 分钟后点击刷新；<br>③ 若长时间未收到，可联系客服协助排查。</div>
                </div>
            </div>
        </section>

        <!-- Footer -->
        <footer class="portal-footer">
            <p>🛡️ 数据经端到端加密与单向中继保护，仅凭对应查询码可读取邮件</p>
            <p>© MOYAO AI · <a href="/services">智能商业服务平台</a> · <a href="/support">联系客服</a></p>
        </footer>
    </main>

    <!-- Load external script from self to fully comply with strict CSP script-src 'self' -->
    <script src="/mail-query/portal.js"></script>
</body>
</html>`;
