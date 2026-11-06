type Copy = readonly [zh: string, en: string];

export interface CleanupCommand {
    label: Copy;
    value: string;
}

interface PlatformGuide {
    heading: Copy;
    name: string;
    file: string;
    size: string;
    steps: ReadonlyArray<{ title: Copy; content: ReadonlyArray<Copy | CleanupCommand> }>;
    issuesHeading: Copy;
    issues: readonly Copy[];
}

// Chinese instructions follow the supplied cleanup chapter. Download names and paths match its commands.
export const proxyCleanupPlatforms: readonly PlatformGuide[] = [
    {
        heading: ['【Windows PowerShell 清理脚本】', 'Windows PowerShell cleanup script'],
        name: 'Windows',
        file: 'clean-claude-proxy.ps1',
        size: '7.77KB',
        steps: [
            {
                title: ['1. 下载脚本', '1. Download the script'],
                content: [
                    [
                        '下载下方的 clean-claude-proxy.ps1 文件，保存到桌面。',
                        'Download clean-claude-proxy.ps1 below and save it to your desktop.',
                    ],
                ],
            },
            {
                title: ['2. 打开 PowerShell', '2. Open PowerShell'],
                content: [
                    [
                        '按 Win + X，选择"Windows PowerShell"（或"终端"）。',
                        'Press Win + X and select Windows PowerShell or Terminal.',
                    ],
                ],
            },
            {
                title: ['3. 允许运行脚本（首次需要）', '3. Allow scripts in the current session (first run)'],
                content: [
                    ['复制下面这行回车：', 'Copy the following line and press Enter:'],
                    {
                        label: ['复制 Windows 执行权限命令', 'Copy Windows execution policy command'],
                        value: 'Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass',
                    },
                ],
            },
            {
                title: ['4. 执行脚本', '4. Run the script'],
                content: [
                    [
                        '复制下面这行回车（如果你的桌面路径不同，请改成实际路径）：',
                        'Copy the following line and press Enter. If your desktop path differs, substitute its actual location:',
                    ],
                    {
                        label: ['复制 Windows 命令', 'Copy Windows command'],
                        value: '& "$env:USERPROFILE\\Desktop\\clean-claude-proxy.ps1"',
                    },
                ],
            },
            {
                title: ['5. 验证结果', '5. Check the result'],
                content: [
                    [
                        '看到 ✅ 清理完成 即可，然后运行 claude 重新登录。',
                        'When you see ✅ Cleanup complete, run claude and sign in again.',
                    ],
                    { label: ['复制 Windows 登录命令', 'Copy Windows sign-in command'], value: 'claude' },
                ],
            },
        ],
        issuesHeading: ['6. 常见问题：', '6. Common problems:'],
        issues: [
            [
                '报错"无法加载文件，因为在此系统上禁止运行脚本" → 漏了第 3 步，先执行那条命令',
                'If PowerShell says script execution is disabled, run the command in step 3 first.',
            ],
            [
                '报错"无法将...项识别为 cmdlet" → 文件不在桌面，用资源管理器找到实际位置，把第 4 步的路径换掉',
                'If the command is not recognized, locate the file in Explorer and use its actual path in step 4.',
            ],
            [
                '文件名变成 clean-claude-proxy (1).ps1 → 重命名去掉 (1)，或者命令里加上这部分',
                'If the name ends in (1).ps1, rename it to remove (1) or include (1) in the command.',
            ],
        ],
    },
    {
        heading: ['【macOS 终端清理脚本】', 'macOS Terminal cleanup script'],
        name: 'macOS',
        file: 'clean-claude-proxy.sh',
        size: '9.17KB',
        steps: [
            {
                title: ['1. 下载脚本', '1. Download the script'],
                content: [
                    [
                        '下载下方的 clean-claude-proxy.sh 文件，保存到「下载」文件夹（或桌面）。',
                        'Download clean-claude-proxy.sh below and save it in Downloads or on your desktop.',
                    ],
                ],
            },
            {
                title: ['2. 打开 终端', '2. Open Terminal'],
                content: [
                    [
                        '按 Command + 空格 打开聚焦搜索，输入 Terminal（终端）回车；或在「访达 → 应用程序 → 实用工具」里找到「终端」。',
                        'Press Command + Space, type Terminal and press Enter. You can also find Terminal in Finder → Applications → Utilities.',
                    ],
                ],
            },
            {
                title: ['3. 添加执行权限（首次需要）', '3. Add execute permission (first run)'],
                content: [
                    [
                        '复制下面这行回车（如果文件不在「下载」文件夹，请改成实际路径）：',
                        'Copy the following line and press Enter. If the file is outside Downloads, substitute its actual path:',
                    ],
                    {
                        label: ['复制 macOS 执行权限命令', 'Copy macOS execute permission command'],
                        value: 'chmod +x ~/Downloads/clean-claude-proxy.sh',
                    },
                ],
            },
            {
                title: ['4. 执行脚本', '4. Run the script'],
                content: [
                    ['复制下面这行回车：', 'Copy the following line and press Enter:'],
                    {
                        label: ['复制 macOS 命令', 'Copy macOS command'],
                        value: '~/Downloads/clean-claude-proxy.sh',
                    },
                    [
                        '如果上一步报 unidentified developer / 无法打开 之类的安全拦截，改用下面这条绕过隔离属性运行：',
                        'If macOS reports an unidentified developer or blocks the script from opening, run it with Bash:',
                    ],
                    {
                        label: ['复制 macOS Bash 命令', 'Copy macOS Bash command'],
                        value: 'bash ~/Downloads/clean-claude-proxy.sh',
                    },
                ],
            },
            {
                title: ['5. 验证结果', '5. Check the result'],
                content: [
                    [
                        '看到 ✅ 清理完成 即可，然后运行 claude 重新走网页授权登录。',
                        'When you see ✅ Cleanup complete, run claude and sign in through your browser again.',
                    ],
                    { label: ['复制 macOS 登录命令', 'Copy macOS sign-in command'], value: 'claude' },
                ],
            },
        ],
        issuesHeading: ['6.常见问题：', '6. Common problems:'],
        issues: [
            [
                '报错 permission denied → 漏了第 3 步，先执行 chmod +x 那条命令。',
                'If you see permission denied, run the chmod +x command in step 3 first.',
            ],
            [
                '报错 no such file or directory → 文件不在「下载」文件夹。用访达找到实际位置，把第 3、4 步的路径换掉；或先 cd 到文件所在目录再运行 ./clean-claude-proxy.sh。',
                'If the file cannot be found, locate it in Finder and update the paths in steps 3 and 4. You can also ' +
                    'cd into that folder and run ./clean-claude-proxy.sh.',
            ],
            [
                '报错 unidentified developer / 系统拦截 → 从浏览器下载的文件带了隔离属性，用 bash ~/Downloads/clean-claude-proxy.sh 运行即可绕过。',
                'If macOS blocks the downloaded file as an unidentified developer, run bash ~/Downloads/clean-claude-proxy.sh.',
            ],
            [
                '文件名变成 clean-claude-proxy (1).sh → 重命名去掉 (1)，或在命令里把文件名改成带 (1) 的完整名字（注意有空格时要加引号）。',
                'If the name ends in (1).sh, remove (1) or use the complete filename. Quote paths containing spaces.',
            ],
        ],
    },
];
