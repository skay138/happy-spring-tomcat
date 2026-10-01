import * as fs from 'fs';
import * as path from 'path';
import { ConfigWriterOptions } from '../types';

export function writeScripts(opts: ConfigWriterOptions): void {
    const { vscodeDir, tomcatHome, tomcatBaseDir, httpPort, debugPort, contextPath, javaOpts, colorizeLogs } = opts;
    const extensionDir = path.join(vscodeDir, 'happy-spring-tomcat');

    if (!fs.existsSync(extensionDir)) {
        fs.mkdirSync(extensionDir, { recursive: true });
    }

    // Remove files generated only by the abandoned Reload Window task-wrapper experiment.
    for (const staleName of ['record-start-task.ps1', 'stop-start-task.ps1', 'start-task.pid']) {
        fs.rmSync(path.join(extensionDir, staleName), { force: true });
    }

    // Windows
    fs.writeFileSync(path.join(extensionDir, 'colorize-logs.ps1'), '\uFEFF' + buildColorizePs1(), 'utf8');
    fs.writeFileSync(path.join(extensionDir, 'stop-owned-process.ps1'), '\uFEFF' + buildStopOwnedProcessPs1(), 'utf8');
    fs.writeFileSync(path.join(extensionDir, 'start-tomcat.bat'), buildStartBat({ tomcatHome, tomcatBaseDir, httpPort, debugPort, contextPath, javaOpts, colorizeLogs }), 'utf8');
    fs.writeFileSync(path.join(extensionDir, 'stop-tomcat.bat'), buildStopBat(httpPort, debugPort, tomcatBaseDir), 'utf8');

    // Mac/Linux
    fs.writeFileSync(path.join(extensionDir, 'colorize-logs.awk'), buildColorizeAwk(), 'utf8');
    const startShPath = path.join(extensionDir, 'start-tomcat.sh');
    const stopShPath = path.join(extensionDir, 'stop-tomcat.sh');
    fs.writeFileSync(startShPath, buildStartSh({ tomcatHome, tomcatBaseDir, httpPort, debugPort, contextPath, javaOpts, colorizeLogs }), 'utf8');
    fs.writeFileSync(stopShPath, buildStopSh(httpPort, debugPort, tomcatBaseDir), 'utf8');

    try {
        fs.chmodSync(startShPath, '755');
        fs.chmodSync(stopShPath, '755');
    } catch {
        // chmod not supported on Windows — safe to ignore
    }
}

function quoteSh(value: string): string {
    return `'${value.replace(/'/g, `'"'"'`)}'`;
}

/** Escapes values expanded while cmd.exe parses a generated batch file. */
function escapeBat(value: string): string {
    return value.replace(/%/g, '%%').replace(/\^/g, '^^').replace(/"/g, '^"');
}

type LogColor = 'Magenta' | 'Red' | 'Yellow' | 'DarkYellow' | 'Green' | 'Cyan' | 'Blue' | 'DarkCyan';

interface LogColorRule {
    color: LogColor;
    psPattern: string;
    awkPattern: string;
}

/** Keep the PowerShell and AWK colorizers semantically aligned. */
const LOG_COLOR_RULES: LogColorRule[] = [
    { color: 'Red', psPattern: '^\\s*(Exception in thread|[\\w.$]+(?:Exception|Error)(?::|$))|심각', awkPattern: '^[[:space:]]*(exception in thread|[[:alnum:]_.$]+(exception|error)(:|$))|심각' },
    { color: 'Yellow', psPattern: '\\b(WARN|WARNING|Potential)\\b|경고', awkPattern: 'warn|warning|potential|경고' },
    { color: 'DarkYellow', psPattern: '\\b(SQL|QUERY|sqltiming|HikariPool)\\b|Hibernate:|Preparing:|Parameters:', awkPattern: 'sql|query|sqltiming|hikaripool|hibernate:|preparing:|parameters:' },
    { color: 'Green', psPattern: '\\b(HTTP|REQUEST|RESPONSE|Mapping|Dispatching)\\b', awkPattern: 'http|request|response|mapping|dispatching' },
    { color: 'Cyan', psPattern: '\\b(Started|Initializing)\\b|정보', awkPattern: 'started|initializing|정보' },
];

const AWK_COLOR_NAMES: Record<LogColor, string> = {
    Magenta: 'c_magenta', Red: 'c_red', Yellow: 'c_yellow', DarkYellow: 'c_orange',
    Green: 'c_green', Cyan: 'c_cyan', Blue: 'c_blue', DarkCyan: 'c_dark_cyan',
};

function buildColorizePs1(): string {
    const switches = LOG_COLOR_RULES
        .map(rule => `            '${rule.psPattern}' { $currentColor = "${rule.color}"; $matched = $true; break }`)
        .join('\n');

    return `param(
    [Parameter(Mandatory = $true)][string]$CatalinaScript
)

$currentColor = "White"
$esc = [char]27
& $CatalinaScript jpda run 2>&1 | ForEach-Object {
    $line = [string]$_
    if ($line.Length -gt 16384) {
        [Console]::Out.WriteLine($line)
        return
    }
    $line = $line -replace "\\x1b\\[[0-9;]*m",""
    $level = ""
    if ($line -match '(?i)"level"\\s*:\\s*"(TRACE|DEBUG|INFO|WARN|ERROR|FATAL|SEVERE|CRITICAL)"') {
        $level = $Matches[1].ToUpperInvariant()
    } else {
        # Timestamp layouts vary, so inspect only a bounded header for an uppercase level token.
        # The bound avoids treating level-like words deep in a message body as log metadata.
        $header = $line.Substring(0, [Math]::Min($line.Length, 160))
        if ($header -cmatch '(?<![A-Za-z0-9_])(TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL|SEVERE|CRITICAL)(?![A-Za-z0-9_])') {
            $level = $Matches[1]
        }
    }

    if ($line -match '^\\s+at\\s+\\S+\\([^)]*\\)\\s*$') {
        Write-Host "$esc[2m$line$esc[0m" -ForegroundColor $currentColor
        return
    }
    if ($line -match '^\\s*\\.\\.\\.\\s+\\d+\\s+(more|common frames omitted)\\s*$') {
        Write-Host "$esc[2m$line$esc[0m" -ForegroundColor DarkCyan
        return
    }

    $matched = $false
    if ($line -match '^\\s*Caused by:') {
        $currentColor = "Red"; $matched = $true
    } elseif ($line -match '^\\s*Suppressed:') {
        $currentColor = "Yellow"; $matched = $true
    } elseif ($level) {
        switch -Regex ($level) {
            'FATAL|CRITICAL' { $currentColor = "Magenta"; break }
            'ERROR|SEVERE' { $currentColor = "Red"; break }
            'WARN' { $currentColor = "Yellow"; break }
            'INFO' { $currentColor = "Cyan"; break }
            'DEBUG' { $currentColor = "Blue"; break }
            'TRACE' { $currentColor = "DarkCyan"; break }
        }
        $matched = $true
    } else { switch -Regex ($line) {
${switches}
    } }

    if ($matched) {
        Write-Host $line -ForegroundColor $currentColor
    } else {
        Write-Host "$esc[2m$line$esc[0m" -ForegroundColor $currentColor
    }
}
$catalinaExitCode = $LASTEXITCODE
if ($null -eq $catalinaExitCode) { $catalinaExitCode = 1 }
exit $catalinaExitCode`;
}

function buildStopOwnedProcessPs1(): string {
    return `param(
    [Parameter(Mandatory = $true)][string]$Ports,
    [Parameter(Mandatory = $true)][string]$CatalinaBase
)

$requestedPorts = @($Ports.Split(',') | ForEach-Object { [int]$_.Trim() })
$listenersByProcess = @{}
& "$env:SystemRoot\\System32\\netstat.exe" -ano -p TCP | ForEach-Object {
    $columns = $_.Trim() -split '\\s+'
    if ($columns.Count -ge 5 -and $columns[0] -eq 'TCP' -and $columns[3] -eq 'LISTENING' -and $columns[1] -match ':(\\d+)$') {
        $listenerPort = [int]$Matches[1]
        if ($requestedPorts -contains $listenerPort) {
            $processId = [int]$columns[4]
            if (!$listenersByProcess.ContainsKey($processId)) { $listenersByProcess[$processId] = @() }
            $listenersByProcess[$processId] += $listenerPort
        }
    }
}
$foreignFound = $false
$expectedBase = [IO.Path]::GetFullPath($CatalinaBase).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
foreach ($owningProcessId in $listenersByProcess.Keys) {
    $listenerPorts = ($listenersByProcess[$owningProcessId] | Sort-Object -Unique) -join ', '
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $owningProcessId" -ErrorAction SilentlyContinue
    $commandLine = if ($process) { [string]$process.CommandLine } else { "" }
    $baseMatch = [regex]::Match($commandLine, '-Dcatalina\\.base=(?:"([^"]+)"|(\\S+))', [Text.RegularExpressions.RegexOptions]::IgnoreCase)
    $processBase = if ($baseMatch.Success) {
        $rawBase = if ($baseMatch.Groups[1].Success) { $baseMatch.Groups[1].Value } else { $baseMatch.Groups[2].Value }
        try { [IO.Path]::GetFullPath($rawBase).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) } catch { "" }
    } else { "" }
    if ([string]::Equals($processBase, $expectedBase, [StringComparison]::OrdinalIgnoreCase)) {
        Write-Host "Stopping Happy Spring Tomcat PID: $owningProcessId (ports $listenerPorts)"
        try {
            Stop-Process -Id $owningProcessId -Force -ErrorAction Stop
        } catch {
            Write-Warning "Failed to stop Happy Spring Tomcat PID $($owningProcessId): $($_.Exception.Message)"
            $foreignFound = $true
        }
    } else {
        Write-Warning "Port(s) $listenerPorts belong to another process (PID $owningProcessId); it was not stopped."
        $foreignFound = $true
    }
}
if ($foreignFound) { exit 2 }
exit 0
`;
}

function buildColorizeAwk(): string {
    const matches = LOG_COLOR_RULES
        .map((rule, index) => `${index === 0 ? 'if' : 'else if'} (normalized ~ /${rule.awkPattern}/) { current_color = ${AWK_COLOR_NAMES[rule.color]}; matched = 1 }`)
        .join('\n        ');

    return `function has_level(level, header, pattern) {
    # Timestamp layouts vary, so inspect only a bounded header for an uppercase level token.
    header = substr(line, 1, 160)
    pattern = "(^|[^[:alnum:]_])" level "([^[:alnum:]_]|$)"
    return normalized ~ ("\\\"level\\\"[[:space:]]*:[[:space:]]*\\\"" tolower(level) "\\\"") || header ~ pattern
}
BEGIN {
    c_reset = "\\033[0m"
    c_dim = "\\033[2m"
    c_magenta = "\\033[35m"
    c_red = "\\033[31m"
    c_yellow = "\\033[33m"
    c_green = "\\033[32m"
    c_cyan = "\\033[36m"
    c_dark_cyan = "\\033[36m"
    c_blue = "\\033[34m"
    c_orange = "\\033[38;5;208m"
    c_white = "\\033[37m"
    current_color = c_white
}
{
    line = $0
    if (length(line) > 16384) {
        print line
        fflush(); next
    }
    sub(/^\\xef\\xbb\\xbf/, "", line)
    gsub(/\\033\\[[0-9;]*m/, "", line)
    normalized = tolower(line)
    is_new_entry = has_level("TRACE") || has_level("DEBUG") || has_level("INFO") || has_level("WARN") || has_level("WARNING") || has_level("ERROR") || has_level("FATAL") || has_level("SEVERE") || has_level("CRITICAL")
    matched = 0

    if (normalized ~ /^[[:space:]]+at[[:space:]]+[^[:space:]]+\\([^)]*\\)[[:space:]]*$/) {
        printf "%s%s%s%s\\n", current_color, c_dim, line, c_reset
        fflush(); next
    }
    if (normalized ~ /^[[:space:]]*\\.\\.\\.[[:space:]]+[0-9]+[[:space:]]+(more|common frames omitted)[[:space:]]*$/) {
        printf "%s%s%s%s\\n", c_dark_cyan, c_dim, line, c_reset
        fflush(); next
    }

    if (normalized ~ /^[[:space:]]*caused by:/) { current_color = c_red; matched = 1 }
    else if (normalized ~ /^[[:space:]]*suppressed:/) { current_color = c_yellow; matched = 1 }
    else if (has_level("FATAL") || has_level("CRITICAL")) { current_color = c_magenta; matched = 1 }
    else if (has_level("ERROR") || has_level("SEVERE")) { current_color = c_red; matched = 1 }
    else if (has_level("WARN") || has_level("WARNING")) { current_color = c_yellow; matched = 1 }
    else if (has_level("INFO")) { current_color = c_cyan; matched = 1 }
    else if (has_level("DEBUG")) { current_color = c_blue; matched = 1 }
    else if (has_level("TRACE")) { current_color = c_dark_cyan; matched = 1 }
    else {
        ${matches}
    }

    if (matched || is_new_entry) {
        if (!matched) { current_color = c_white }
        printf "%s%s%s\\n", current_color, line, c_reset
    } else {
        printf "%s%s%s%s\\n", current_color, c_dim, line, c_reset
    }
    fflush()
}`;
}

function buildStartBat(opts: {
    tomcatHome: string; tomcatBaseDir: string; httpPort: number; debugPort: number;
    contextPath: string; javaOpts: string; colorizeLogs: boolean;
}): string {
    const { tomcatHome, tomcatBaseDir, httpPort, debugPort, contextPath, javaOpts, colorizeLogs } = opts;
    const safeTomcatHome = escapeBat(tomcatHome);
    const safeTomcatBase = escapeBat(tomcatBaseDir);
    const safeJavaOpts = escapeBat(javaOpts);
    const catalinaRunLine = colorizeLogs
        ? `powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0colorize-logs.ps1" -CatalinaScript "%CATALINA_HOME%\\bin\\catalina.bat"`
        : `call "%CATALINA_HOME%\\bin\\catalina.bat" jpda run`;

    return `@echo off
chcp 65001 > nul
echo ====================================================
echo Starting Tomcat in DEBUG mode (Port ${debugPort})...
echo HTTP Port: ${httpPort}
echo Context Path: "${escapeBat(contextPath)}"
echo ====================================================
echo Cleaning up previous Tomcat instances...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-owned-process.ps1" -Ports "${debugPort},${httpPort}" -CatalinaBase "${safeTomcatBase}"
if errorlevel 1 exit /b 1
timeout /t 1 /nobreak > nul

set "JAVA_OPTS=${safeJavaOpts}"
set "CATALINA_HOME=${safeTomcatHome}"
set "CATALINA_BASE=${safeTomcatBase}"
set "JPDA_ADDRESS=127.0.0.1:${debugPort}"

echo Tomcat is launching (HTTP Port ${httpPort})...
${catalinaRunLine}
set "HST_CATALINA_EXIT=%ERRORLEVEL%"
if exist "%~dp0restart-requested" (
    del /Q "%~dp0restart-requested" > nul 2>&1
    echo Tomcat start was interrupted by Restart.
    exit /b 0
)
echo Tomcat process exited.
exit /b %HST_CATALINA_EXIT%
`;
}

function buildStopBat(httpPort: number, debugPort: number, tomcatBaseDir: string): string {
    return `@echo off
chcp 65001 > nul
echo ====================================================
echo Stopping Tomcat...
echo ====================================================

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-owned-process.ps1" -Ports "${debugPort},${httpPort}" -CatalinaBase "${escapeBat(tomcatBaseDir ?? '')}"
if errorlevel 1 goto :stop_failed
echo Tomcat stopped cleanly.
exit /b 0

:stop_failed
echo WARNING: Tomcat was not stopped.
exit /b 1
`;
}

function buildStartSh(opts: {
    tomcatHome: string; tomcatBaseDir: string; httpPort: number; debugPort: number;
    contextPath: string; javaOpts: string; colorizeLogs: boolean;
}): string {
    const { tomcatHome, tomcatBaseDir, httpPort, debugPort, contextPath, javaOpts, colorizeLogs } = opts;

    return `#!/bin/bash
# start-tomcat.sh — generated by happy-spring-tomcat extension
set -o pipefail
echo "==================================================="
echo "Starting Tomcat in DEBUG mode (Port ${debugPort})..."
echo "HTTP Port: ${httpPort}"
printf '%s\n' ${quoteSh(`Context Path: ${contextPath}`)}
echo "==================================================="
echo "Cleaning up previous Tomcat instances..."
hst_stop_owned_port() {
    local port="$1" pid command foreign=0
    for pid in $(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null); do
        command=$(ps -p "$pid" -o args= 2>/dev/null || true)
        case "$command" in
            *"-Dcatalina.base=$CATALINA_BASE"*) kill -9 "$pid" ;;
            *) echo "Port $port belongs to another process (PID $pid); it was not stopped." >&2; foreign=1 ;;
        esac
    done
    return "$foreign"
}

export CATALINA_BASE=${quoteSh(tomcatBaseDir)}
hst_stop_owned_port ${debugPort} || exit 1
hst_stop_owned_port ${httpPort} || exit 1
sleep 1

export JAVA_OPTS=${quoteSh(javaOpts)}
export CATALINA_HOME=${quoteSh(tomcatHome)}
export JPDA_ADDRESS="127.0.0.1:${debugPort}"
export JPDA_TRANSPORT="dt_socket"

echo "Tomcat is launching (HTTP Port ${httpPort})..."
${colorizeLogs
    ? `"$CATALINA_HOME/bin/catalina.sh" jpda run 2>&1 | awk -f "$(dirname "$0")/colorize-logs.awk"`
    : `"$CATALINA_HOME/bin/catalina.sh" jpda run`}
hst_catalina_exit=$?
if [ -f "$(dirname "$0")/restart-requested" ]; then
    rm -f "$(dirname "$0")/restart-requested"
    echo "Tomcat start was interrupted by Restart."
    exit 0
fi
echo "Tomcat process exited."
exit "$hst_catalina_exit"
`;
}

function buildStopSh(httpPort: number, debugPort: number, tomcatBaseDir: string): string {
    return `#!/bin/bash
# stop-tomcat.sh — generated by happy-spring-tomcat extension
echo "==================================================="
echo "Stopping Tomcat..."
echo "==================================================="

CATALINA_BASE=${quoteSh(tomcatBaseDir ?? '')}
hst_stop_failed=0
for hst_port in ${debugPort} ${httpPort}; do
    for hst_pid in $(lsof -tiTCP:"$hst_port" -sTCP:LISTEN 2>/dev/null); do
        hst_command=$(ps -p "$hst_pid" -o args= 2>/dev/null || true)
        case "$hst_command" in
            *"-Dcatalina.base=$CATALINA_BASE"*) kill -9 "$hst_pid" ;;
            *) echo "Port $hst_port belongs to another process (PID $hst_pid); it was not stopped." >&2; hst_stop_failed=1 ;;
        esac
    done
done
if [ "$hst_stop_failed" -ne 0 ]; then
    echo "WARNING: Tomcat was not stopped." >&2
    exit 1
fi
echo "Tomcat stopped cleanly."
`;
}
