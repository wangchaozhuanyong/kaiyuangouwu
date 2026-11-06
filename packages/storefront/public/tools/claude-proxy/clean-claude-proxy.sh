#!/usr/bin/env bash
# ============================================================
# clean-claude-proxy.sh
# 清理 Claude Code / Codex 的代理配置（如 CCSwitch 残留）- macOS 版
# ============================================================

# 出错继续，不直接退出（对应 Windows 的 $ErrorActionPreference = 'Continue'）
set +e

# ---- 颜色输出 ----
if [ -t 1 ]; then
    C_GREEN='\033[0;32m'; C_YELLOW='\033[0;33m'; C_RED='\033[0;31m'; C_RESET='\033[0m'
else
    C_GREEN=''; C_YELLOW=''; C_RED=''; C_RESET=''
fi
green()  { printf "${C_GREEN}%s${C_RESET}\n"  "$1"; }
yellow() { printf "${C_YELLOW}%s${C_RESET}\n" "$1"; }
red()    { printf "${C_RED}%s${C_RESET}\n"    "$1"; }

show_file() {
    # 缩进展示文件内容
    while IFS= read -r line || [ -n "$line" ]; do
        printf "    %s\n" "$line"
    done < "$1"
}

# ---- 选择一个 JSON 处理运行时（Claude Code 用户必有 node；否则回退 python3）----
JSON_RT=""
if command -v node >/dev/null 2>&1; then
    JSON_RT="node"
elif command -v python3 >/dev/null 2>&1; then
    JSON_RT="python3"
fi

echo ""
echo "🧹 Claude Code 代理配置清理工具 (macOS)"
echo "================================"
echo ""

if [ -z "$JSON_RT" ]; then
    red "[警告] 未找到 node 或 python3，无法自动改写 JSON 文件。"
    echo  "  请安装 Node.js（运行 Claude Code 本就需要）后重试，或手动编辑相关文件。"
    echo  ""
fi

CHANGED=0
USER_HOME="$HOME"

# ============================================================
# 1. ~/.claude/settings.json —— 移除 env 中的代理变量
# ============================================================
SETTINGS_FILE="$USER_HOME/.claude/settings.json"
if [ -f "$SETTINGS_FILE" ]; then
    if grep -Eq 'PROXY_MANAGED|ANTHROPIC_BASE_URL|ANTHROPIC_AUTH_TOKEN|ANTHROPIC_API_KEY' "$SETTINGS_FILE"; then
        yellow "[发现] $SETTINGS_FILE 包含代理配置"
        echo   "  清理前内容："
        show_file "$SETTINGS_FILE"

        if [ "$JSON_RT" = "node" ]; then
            node -e '
                const fs=require("fs"); const p=process.argv[1];
                let d={}; try{d=JSON.parse(fs.readFileSync(p,"utf8"))}catch(e){}
                if(!d.env||typeof d.env!=="object"||Array.isArray(d.env)) d.env={};
                for(const k of ["ANTHROPIC_AUTH_TOKEN","ANTHROPIC_BASE_URL","ANTHROPIC_API_KEY"]) delete d.env[k];
                fs.writeFileSync(p, JSON.stringify(d,null,2)+"\n");
            ' "$SETTINGS_FILE" && {
                green "  ✅ 已清理 env 中的代理变量"
                echo  "  清理后内容："
                show_file "$SETTINGS_FILE"
                CHANGED=$((CHANGED+1))
            } || red "  ❌ 处理 $SETTINGS_FILE 时出错"
        elif [ "$JSON_RT" = "python3" ]; then
            python3 -c '
import json,sys
p=sys.argv[1]
try:
    d=json.load(open(p,encoding="utf-8"))
except Exception:
    d={}
if not isinstance(d.get("env"),dict): d["env"]={}
for k in ("ANTHROPIC_AUTH_TOKEN","ANTHROPIC_BASE_URL","ANTHROPIC_API_KEY"):
    d["env"].pop(k,None)
json.dump(d,open(p,"w",encoding="utf-8"),ensure_ascii=False,indent=2)
open(p,"a").write("\n")
' "$SETTINGS_FILE" && {
                green "  ✅ 已清理 env 中的代理变量"
                echo  "  清理后内容："
                show_file "$SETTINGS_FILE"
                CHANGED=$((CHANGED+1))
            } || red "  ❌ 处理 $SETTINGS_FILE 时出错"
        else
            red "  ⚠️  无可用 JSON 运行时，已跳过自动清理（请手动删除 env 中的 ANTHROPIC_* 变量）"
        fi
    else
        green "[OK] $SETTINGS_FILE 无代理配置"
    fi
else
    green "[OK] $SETTINGS_FILE 不存在，跳过"
fi

echo ""

# ============================================================
# 2. ~/.codex/auth.json —— 含 PROXY_MANAGED 则重置为空
# ============================================================
CODEX_AUTH="$USER_HOME/.codex/auth.json"
if [ -f "$CODEX_AUTH" ]; then
    if grep -q 'PROXY_MANAGED' "$CODEX_AUTH"; then
        yellow "[发现] $CODEX_AUTH 包含代理配置"
        echo   "  清理前内容："
        show_file "$CODEX_AUTH"

        printf '{}\n' > "$CODEX_AUTH" && {
            green "  ✅ 已重置为空配置"
            CHANGED=$((CHANGED+1))
        } || red "  ❌ 处理 $CODEX_AUTH 时出错"
    else
        green "[OK] $CODEX_AUTH 无代理配置"
    fi
else
    green "[OK] $CODEX_AUTH 不存在，跳过"
fi

echo ""

# ============================================================
# 3. ~/.claude.json —— 清除旧账号 userID 等字段
# ============================================================
CLAUDE_JSON="$USER_HOME/.claude.json"
if [ -f "$CLAUDE_JSON" ]; then
    if grep -q '"userID"' "$CLAUDE_JSON"; then
        yellow "[发现] $CLAUDE_JSON 包含旧账号 userID"

        if [ "$JSON_RT" = "node" ]; then
            node -e '
                const fs=require("fs"); const p=process.argv[1];
                let d={}; try{d=JSON.parse(fs.readFileSync(p,"utf8"))}catch(e){}
                const removed=[];
                for(const k of ["userID","hasAvailableSubscription","subscriptionNoticeCount","clientDataCache"]){
                    if(Object.prototype.hasOwnProperty.call(d,k)){ delete d[k]; removed.push(k); }
                }
                d.numStartups=0; d.hasCompletedOnboarding=false;
                fs.writeFileSync(p, JSON.stringify(d,null,2)+"\n");
                console.log("  移除字段: "+removed.join(", "));
            ' "$CLAUDE_JSON" && {
                green "  ✅ 已清除旧账号信息"
                CHANGED=$((CHANGED+1))
            } || red "  ❌ 处理 $CLAUDE_JSON 时出错"
        elif [ "$JSON_RT" = "python3" ]; then
            python3 -c '
import json,sys
p=sys.argv[1]
try:
    d=json.load(open(p,encoding="utf-8"))
except Exception:
    d={}
removed=[]
for k in ("userID","hasAvailableSubscription","subscriptionNoticeCount","clientDataCache"):
    if k in d:
        d.pop(k); removed.append(k)
d["numStartups"]=0
d["hasCompletedOnboarding"]=False
json.dump(d,open(p,"w",encoding="utf-8"),ensure_ascii=False,indent=2)
open(p,"a").write("\n")
print("  移除字段: "+", ".join(removed))
' "$CLAUDE_JSON" && {
                green "  ✅ 已清除旧账号信息"
                CHANGED=$((CHANGED+1))
            } || red "  ❌ 处理 $CLAUDE_JSON 时出错"
        else
            red "  ⚠️  无可用 JSON 运行时，已跳过（请手动删除 userID 等字段）"
        fi
    else
        green "[OK] $CLAUDE_JSON 无旧账号 userID"
    fi
else
    green "[OK] $CLAUDE_JSON 不存在，跳过"
fi

echo ""

# ============================================================
# 4. 检查环境变量（当前进程）
#    macOS 没有 Windows 的 用户级/系统级 注册表式变量，
#    代理变量通常写在 shell 配置文件里（见第 5 步）
# ============================================================
echo "检查环境变量..."
ENV_CLEAN=1
for v in ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL ANTHROPIC_API_KEY; do
    # 间接取值，兼容 bash/zsh
    val="${!v-}"
    if [ -n "$val" ]; then
        yellow "[提示] 当前 shell 进程中存在变量 $v = $val"
        echo   "  本次会话临时生效，关闭终端后消失；若每次都出现，请检查第 5 步的配置文件"
        echo   "  立即清除（仅当前会话）：unset $v"
        ENV_CLEAN=0
    fi
done
if [ "$ENV_CLEAN" -eq 1 ]; then
    green "[OK] 环境变量无代理相关配置"
fi

echo ""

# ============================================================
# 5. 检查 shell 配置文件中的代理设置
# ============================================================
echo "检查 shell 配置文件..."
PROFILE_FILES=(
    "$USER_HOME/.zshrc"
    "$USER_HOME/.zprofile"
    "$USER_HOME/.zshenv"
    "$USER_HOME/.bashrc"
    "$USER_HOME/.bash_profile"
    "$USER_HOME/.profile"
)
PROFILE_CLEAN=1
for f in "${PROFILE_FILES[@]}"; do
    if [ -f "$f" ]; then
        if grep -Eq 'ANTHROPIC_AUTH_TOKEN|ANTHROPIC_BASE_URL|ANTHROPIC_API_KEY' "$f"; then
            red "[警告] $f 中发现代理相关变量，请手动检查并删除："
            grep -nE 'ANTHROPIC_AUTH_TOKEN|ANTHROPIC_BASE_URL|ANTHROPIC_API_KEY' "$f" \
                | while IFS= read -r m; do printf "    %s\n" "$m"; done
            PROFILE_CLEAN=0
        fi
    fi
done
if [ "$PROFILE_CLEAN" -eq 1 ]; then
    green "[OK] shell 配置文件无代理变量"
fi

echo ""

# ============================================================
# 6. 检查 CC Switch 进程
# ============================================================
CC_PIDS="$(pgrep -fil 'cc.?switch|ccswitch' 2>/dev/null)"
if [ -n "$CC_PIDS" ]; then
    yellow "[提示] CC Switch 进程仍在运行，建议退出："
    echo "$CC_PIDS" | while IFS= read -r line; do printf "  %s\n" "$line"; done
    echo "  可以在菜单栏图标右键退出，或执行："
    echo "    pkill -fi 'cc.?switch'"
else
    green "[OK] CC Switch 进程未运行"
fi

echo ""
echo "================================"
if [ "$CHANGED" -gt 0 ]; then
    green "✅ 清理完成！共修改 $CHANGED 个文件"
else
    green "✅ 所有配置已经是干净的，无需修改"
fi
echo ""
echo "现在可以运行 'claude' 启动 Claude Code，使用网页授权登录新账号。"
echo ""
