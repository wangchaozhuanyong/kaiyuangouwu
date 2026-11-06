# ============================================================
# clean-claude-proxy.ps1
# 清理 Claude Code / Codex 的代理配置（如 CCSwitch 残留）- Windows 版
# ============================================================

$ErrorActionPreference = 'Continue'

# 输出编码设为 UTF-8，避免中文乱码
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $OutputEncoding           = [System.Text.Encoding]::UTF8
} catch {}

function Write-Green  ($msg) { Write-Host $msg -ForegroundColor Green }
function Write-Yellow ($msg) { Write-Host $msg -ForegroundColor Yellow }
function Write-Red    ($msg) { Write-Host $msg -ForegroundColor Red }

function Show-FileContent ($path) {
    $lines = Get-Content -Path $path -Encoding UTF8
    foreach ($line in $lines) { Write-Host "    $line" }
}

Write-Host ""
Write-Host "🧹 Claude Code 代理配置清理工具 (Windows)"
Write-Host "================================"
Write-Host ""

$Changed  = 0
$UserHome = $env:USERPROFILE

# ---- 1. %USERPROFILE%\.claude\settings.json ----
$SettingsFile = Join-Path $UserHome '.claude\settings.json'
if (Test-Path $SettingsFile) {
    try {
        $raw = Get-Content $SettingsFile -Raw -Encoding UTF8
        if ($raw -match 'PROXY_MANAGED|ANTHROPIC_BASE_URL|ANTHROPIC_AUTH_TOKEN|ANTHROPIC_API_KEY') {
            Write-Yellow "[发现] $SettingsFile 包含代理配置"
            Write-Host  "  清理前内容："
            Show-FileContent $SettingsFile

            $data = $raw | ConvertFrom-Json

            if ($data.PSObject.Properties.Name -contains 'env' -and $null -ne $data.env) {
                foreach ($key in @('ANTHROPIC_AUTH_TOKEN','ANTHROPIC_BASE_URL','ANTHROPIC_API_KEY')) {
                    if ($data.env.PSObject.Properties.Name -contains $key) {
                        $data.env.PSObject.Properties.Remove($key)
                    }
                }
            } else {
                $data | Add-Member -NotePropertyName env -NotePropertyValue ([pscustomobject]@{}) -Force
            }

            ($data | ConvertTo-Json -Depth 20) |
                Set-Content -Path $SettingsFile -Encoding UTF8

            Write-Green "  ✅ 已清理 env 中的代理变量"
            Write-Host  "  清理后内容："
            Show-FileContent $SettingsFile
            $Changed++
        } else {
            Write-Green "[OK] $SettingsFile 无代理配置"
        }
    } catch {
        Write-Red "  ❌ 处理 $SettingsFile 时出错: $($_.Exception.Message)"
    }
} else {
    Write-Green "[OK] $SettingsFile 不存在，跳过"
}

Write-Host ""

# ---- 2. %USERPROFILE%\.codex\auth.json ----
$CodexAuth = Join-Path $UserHome '.codex\auth.json'
if (Test-Path $CodexAuth) {
    try {
        $raw = Get-Content $CodexAuth -Raw -Encoding UTF8
        if ($raw -match 'PROXY_MANAGED') {
            Write-Yellow "[发现] $CodexAuth 包含代理配置"
            Write-Host  "  清理前内容："
            Show-FileContent $CodexAuth

            '{}' | Set-Content -Path $CodexAuth -Encoding UTF8
            Write-Green "  ✅ 已重置为空配置"
            $Changed++
        } else {
            Write-Green "[OK] $CodexAuth 无代理配置"
        }
    } catch {
        Write-Red "  ❌ 处理 $CodexAuth 时出错: $($_.Exception.Message)"
    }
} else {
    Write-Green "[OK] $CodexAuth 不存在，跳过"
}

Write-Host ""

# ---- 3. %USERPROFILE%\.claude.json （清除旧账号 userID） ----
$ClaudeJson = Join-Path $UserHome '.claude.json'
if (Test-Path $ClaudeJson) {
    try {
        $raw = Get-Content $ClaudeJson -Raw -Encoding UTF8
        if ($raw -match '"userID"') {
            Write-Yellow "[发现] $ClaudeJson 包含旧账号 userID"

            $data = $raw | ConvertFrom-Json
            $removed = @()
            foreach ($key in @('userID','hasAvailableSubscription','subscriptionNoticeCount','clientDataCache')) {
                if ($data.PSObject.Properties.Name -contains $key) {
                    $data.PSObject.Properties.Remove($key)
                    $removed += $key
                }
            }
            $data | Add-Member -NotePropertyName numStartups            -NotePropertyValue 0     -Force
            $data | Add-Member -NotePropertyName hasCompletedOnboarding -NotePropertyValue $false -Force

            ($data | ConvertTo-Json -Depth 20) |
                Set-Content -Path $ClaudeJson -Encoding UTF8

            Write-Host  ("  移除字段: " + ($removed -join ', '))
            Write-Green "  ✅ 已清除旧账号信息"
            $Changed++
        } else {
            Write-Green "[OK] $ClaudeJson 无旧账号 userID"
        }
    } catch {
        Write-Red "  ❌ 处理 $ClaudeJson 时出错: $($_.Exception.Message)"
    }
} else {
    Write-Green "[OK] $ClaudeJson 不存在，跳过"
}

Write-Host ""

# ---- 4. 检查环境变量（用户级 + 系统级 + 当前进程） ----
Write-Host "检查环境变量..."
$EnvClean = $true
$VarsToCheck = @('ANTHROPIC_AUTH_TOKEN','ANTHROPIC_BASE_URL','ANTHROPIC_API_KEY')

foreach ($scope in 'User','Machine') {
    foreach ($v in $VarsToCheck) {
        try {
            $val = [Environment]::GetEnvironmentVariable($v, $scope)
            if ($val) {
                Write-Yellow "[警告] $scope 级环境变量 $v 存在，值为：$val"
                Write-Host  "  如需删除，请执行（Machine 级需管理员 PowerShell）："
                Write-Host  "    [Environment]::SetEnvironmentVariable('$v', `$null, '$scope')"
                $EnvClean = $false
            }
        } catch {}
    }
}

foreach ($v in $VarsToCheck) {
    $val = [Environment]::GetEnvironmentVariable($v, 'Process')
    if ($val) {
        Write-Yellow "[提示] 当前 PowerShell 进程中存在临时变量 $v = $val"
        Write-Host  "  关闭终端后会自动消失"
        $EnvClean = $false
    }
}

if ($EnvClean) {
    Write-Green "[OK] 环境变量无代理相关配置"
}

Write-Host ""

# ---- 5. 检查 PowerShell profile 中的代理设置 ----
Write-Host "检查 PowerShell 配置文件..."
$ProfileFiles = @(
    $PROFILE.CurrentUserCurrentHost,
    $PROFILE.CurrentUserAllHosts,
    $PROFILE.AllUsersCurrentHost,
    $PROFILE.AllUsersAllHosts
) | Select-Object -Unique

$ProfileClean = $true
foreach ($f in $ProfileFiles) {
    if ($f -and (Test-Path $f)) {
        try {
            $content = Get-Content $f -Raw -Encoding UTF8
            if ($content -match 'ANTHROPIC_AUTH_TOKEN|ANTHROPIC_BASE_URL|(ANTHROPIC_API_KEY.*PROXY)') {
                Write-Red "[警告] $f 中发现代理相关变量，请手动检查并删除："
                Select-String -Path $f -Pattern 'ANTHROPIC_AUTH_TOKEN|ANTHROPIC_BASE_URL|ANTHROPIC_API_KEY.*PROXY' |
                    ForEach-Object { Write-Host "    $($_.LineNumber): $($_.Line)" }
                $ProfileClean = $false
            }
        } catch {}
    }
}
if ($ProfileClean) {
    Write-Green "[OK] PowerShell 配置文件无代理变量"
}

Write-Host ""

# ---- 6. 检查 CC Switch 进程 ----
$ccProcs = Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessName -match 'cc-switch|CC.?Switch|CCSwitch' }

if ($ccProcs) {
    Write-Yellow "[提示] CC Switch 进程仍在运行，建议退出："
    $ccProcs | ForEach-Object { Write-Host "  PID $($_.Id)  $($_.ProcessName)" }
    Write-Host "  可以在系统托盘右键退出，或执行："
    Write-Host "    Get-Process cc-switch,'CC Switch' -ErrorAction SilentlyContinue | Stop-Process"
} else {
    Write-Green "[OK] CC Switch 进程未运行"
}

Write-Host ""
Write-Host "================================"
if ($Changed -gt 0) {
    Write-Green "✅ 清理完成！共修改 $Changed 个文件"
} else {
    Write-Green "✅ 所有配置已经是干净的，无需修改"
}
Write-Host ""
Write-Host "现在可以运行 'claude' 启动 Claude Code，使用网页授权登录新账号。"
Write-Host ""
