import * as fs from 'fs';
import * as path from 'path';
import { ConfigWriterOptions } from '../types';

export function writeScripts(opts: ConfigWriterOptions): DuplicateGuardResolution {
    const { vscodeDir, tomcatHome, tomcatBaseDir, httpPort, debugPort, contextPath, javaOpts, colorizeLogs } = opts;
    const extensionDir = path.join(vscodeDir, 'happy-spring-tomcat');

    if (!fs.existsSync(extensionDir)) {
        fs.mkdirSync(extensionDir, { recursive: true });
    }

    // Remove files generated only by the abandoned Reload Window task-wrapper experiment.
    for (const staleName of ['record-start-task.ps1', 'stop-start-task.ps1', 'start-task.pid']) {
        fs.rmSync(path.join(extensionDir, staleName), { force: true });
    }

    const resolution = resolveDuplicateGuard(opts);
    const winGuard = styleGuard(resolution, 'win');
    const posixGuard = styleGuard(resolution, 'posix');

    // Windows
    fs.writeFileSync(path.join(extensionDir, 'colorize-logs.ps1'), '\uFEFF' + buildColorizePs1(), 'utf8');
    fs.writeFileSync(path.join(extensionDir, 'stop-owned-process.ps1'), '\uFEFF' + buildStopOwnedProcessPs1(), 'utf8');
    fs.writeFileSync(path.join(extensionDir, 'start-tomcat.bat'), buildStartBat({ tomcatHome, tomcatBaseDir, httpPort, debugPort, contextPath, javaOpts, colorizeLogs, guard: winGuard }), 'utf8');
    fs.writeFileSync(path.join(extensionDir, 'stop-tomcat.bat'), buildStopBat(httpPort, debugPort, winGuard, tomcatBaseDir), 'utf8');

    // Mac/Linux
    fs.writeFileSync(path.join(extensionDir, 'colorize-logs.awk'), buildColorizeAwk(), 'utf8');
    const startShPath = path.join(extensionDir, 'start-tomcat.sh');
    const stopShPath = path.join(extensionDir, 'stop-tomcat.sh');
    fs.writeFileSync(startShPath, buildStartSh({ tomcatHome, tomcatBaseDir, httpPort, debugPort, contextPath, javaOpts, colorizeLogs, guard: posixGuard }), 'utf8');
    fs.writeFileSync(stopShPath, buildStopSh(httpPort, debugPort, posixGuard, tomcatBaseDir), 'utf8');

    try {
        fs.chmodSync(startShPath, '755');
        fs.chmodSync(stopShPath, '755');
    } catch {
        // chmod not supported on Windows — safe to ignore
    }

    return resolution;
}

/**
 * Paths for the duplicate `/WEB-INF/classes` guard.
 *
 * When `classesBase` is mounted at `/WEB-INF/classes` via PreResources while docBase
 * already contains its own `WEB-INF/classes`, Tomcat's WebappClassLoader registers both
 * directories as separate classpath entries. `ClassLoader.getResources()` then returns the
 * same file twice, so Spring parses `classpath*:` configs twice (duplicate bean definitions,
 * duplicate Spring Security filter chains, ...). The generated scripts move docBase's copy
 * aside while Tomcat runs so only one entry remains.
 */
interface DuplicateGuard {
    docBaseClasses: string;
    /** Backup location — deliberately OUTSIDE docBase, see resolveDuplicateGuard(). */
    backupClasses: string;
    /** Parent of backupClasses; the scripts must create it before moving. */
    backupParent: string;
}

export type DuplicateGuardResolution =
    /** A collision exists and can be guarded against. */
    | { kind: 'active'; guard: DuplicateGuard }
    /** Opted out, or both mounts already point at the same directory. */
    | { kind: 'not-needed' }
    /** A collision exists, but there is no build output directory to stash the copy in. */
    | { kind: 'no-build-dir' };

/** Directories safe to stash a build artifact in: disposable, and conventionally git-ignored. */
const BUILD_OUTPUT_DIR_NAMES = ['target', 'build', 'out'];

function isBuildOutputDir(dir: string): boolean {
    return BUILD_OUTPUT_DIR_NAMES.includes(path.basename(dir).toLowerCase());
}

/** Windows renames are only instant within one volume; a cross-volume move is a full copy. */
function isSameVolume(a: string, b: string): boolean {
    return path.parse(path.resolve(a)).root.toLowerCase() === path.parse(path.resolve(b)).root.toLowerCase();
}

/**
 * Where to stash docBase's `WEB-INF/classes`.
 *
 * Requirements, in order of importance:
 *  1. Outside docBase — maven-war-plugin does not clean stale files under its webappDirectory,
 *     so a backup left inside would be packaged into the next WAR built without `clean`.
 *  2. Inside a build output directory — disposable, already git-ignored, and `mvn clean` tidies
 *     it up. Never a source tree, and never outside the workspace.
 *  3. Same volume as docBase — keeps the move an instant, atomic rename instead of a full copy
 *     of what can be tens of thousands of class files.
 */
function resolveBackupRoot(resolvedDocBase: string, projectRoot: string): string | null {
    // target/ROOT, target/exploded, build/exploded, ...
    const docBaseParent = path.dirname(resolvedDocBase);
    if (isBuildOutputDir(docBaseParent)) { return docBaseParent; }

    // docBase lives elsewhere (e.g. an absolute path outside the project): fall back to the
    // project's own build output directory, as long as moving there stays a rename.
    for (const name of BUILD_OUTPUT_DIR_NAMES) {
        const candidate = path.join(projectRoot, name);
        if (fs.existsSync(candidate) && isSameVolume(candidate, resolvedDocBase)) { return candidate; }
    }

    return null;
}

function resolveDuplicateGuard(opts: ConfigWriterOptions): DuplicateGuardResolution {
    const { preventDuplicateClasses, resolvedDocBase, resolvedClassesBase, projectRoot } = opts;
    if (!preventDuplicateClasses || !resolvedDocBase || !resolvedClassesBase) { return { kind: 'not-needed' }; }

    const docBaseClasses = path.join(resolvedDocBase, 'WEB-INF', 'classes');

    // Nothing to guard against when both mounts already point at the same directory.
    const classesBase = path.normalize(resolvedClassesBase);
    const isSameDir = process.platform === 'win32'
        ? docBaseClasses.toLowerCase() === classesBase.toLowerCase()
        : docBaseClasses === classesBase;
    if (isSameDir) { return { kind: 'not-needed' }; }

    const backupRoot = resolveBackupRoot(resolvedDocBase, projectRoot);
    if (!backupRoot) { return { kind: 'no-build-dir' }; }

    const backupParent = path.join(backupRoot, '.happy-spring-tomcat');
    return {
        kind: 'active',
        guard: { docBaseClasses, backupParent, backupClasses: path.join(backupParent, 'classes-backup') },
    };
}

/** Renders a resolved guard with the separators the target script expects. */
function styleGuard(resolution: DuplicateGuardResolution, style: 'win' | 'posix'): DuplicateGuard | null {
    if (resolution.kind !== 'active') { return null; }
    const toStyle = (p: string) => style === 'posix' ? p.replace(/\\/g, '/') : p.replace(/\//g, '\\');
    const { docBaseClasses, backupClasses, backupParent } = resolution.guard;
    return {
        docBaseClasses: toStyle(docBaseClasses),
        backupClasses: toStyle(backupClasses),
        backupParent: toStyle(backupParent),
    };
}

function quoteSh(value: string): string {
    return `'${value.replace(/'/g, `'"'"'`)}'`;
}

/** Escapes values expanded while cmd.exe parses a generated batch file. */
function escapeBat(value: string): string {
    return value.replace(/%/g, '%%').replace(/\^/g, '^^').replace(/"/g, '^"');
}

/**
 * Restores what the start script moved aside, leaving docBase a complete artifact again.
 * Idempotent, so it is safe to run from several places (start script tail, stop script, trap).
 * If the build regenerated classes while Tomcat was running, the backup is stale — drop it.
 */
function buildRestoreBat(guard: DuplicateGuard): string {
    const backupClasses = escapeBat(guard.backupClasses);
    const docBaseClasses = escapeBat(guard.docBaseClasses);
    return `if exist "${backupClasses}" (
    if exist "${docBaseClasses}" (
        rmdir /S /Q "${backupClasses}"
    ) else (
        move "${backupClasses}" "${docBaseClasses}" > nul
        echo [Duplicate Protection] Restored WEB-INF\\classes in docBase.
    )
)`;
}

/** Shell counterpart of buildRestoreBat(), as a function so it can be wired to `trap`. */
function buildRestoreShFunction(guard: DuplicateGuard): string {
    const backupClasses = quoteSh(guard.backupClasses);
    const docBaseClasses = quoteSh(guard.docBaseClasses);
    return `hst_restore_classes() {
    if [ -d ${backupClasses} ]; then
        if [ -d ${docBaseClasses} ]; then
            rm -rf ${backupClasses}
        else
            mv ${backupClasses} ${docBaseClasses}
            echo "[Duplicate Protection] Restored WEB-INF/classes in docBase."
        fi
    fi
}`;
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
    } elseif ($line -match '(?i)^\\s*(?:(?:\\[?\\d{4}-\\d{2}-\\d{2}[^ ]*|\\[?\\d{2}-[A-Za-z]{3}-\\d{4}[^ ]*|\\d{2}:\\d{2}:\\d{2}(?:[.,]\\d+)?)\\s+)?(?:\\[[^]]+\\]\\s*)*(TRACE|DEBUG|INFO|WARN|ERROR|FATAL|SEVERE|CRITICAL)(?:\\s|:|-|\\])') {
        $level = $Matches[1].ToUpperInvariant()
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

    return `function has_level(level, pattern) {
    pattern = "^[[:space:]]*((\\[?[0-9]{4}-[0-9]{2}-[0-9]{2}[^ ]*[[:space:]]+([0-9]{2}:[^ ]+[[:space:]]+)?)|(\\[?[0-9]{2}-[a-z]{3}-[0-9]{4}[^ ]*[[:space:]]+)|([0-9]{2}:[0-9]{2}:[0-9]{2}([.,][0-9]+)?[[:space:]]+))?(\\[[^]]+\\][[:space:]]*)*" level "([[:space:]:-]|$)"
    return normalized ~ ("\\\"level\\\"[[:space:]]*:[[:space:]]*\\\"" level "\\\"") || normalized ~ pattern
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
    is_new_entry = line ~ /^(\\[?[0-9]{4}-[0-9]{2}-[0-9]{2} |\\[?[0-9]{2}-[a-zA-Z]{3}-[0-9]{4} |\\[?[a-zA-Z]{3} [0-9]{2}, [0-9]{4})/ || normalized ~ /^[[:space:]]*\\[?(trace|debug|info|warn|error|fatal|severe|critical)\\]?([[:space:]:-]|$)/ || normalized ~ /"level"[[:space:]]*:[[:space:]]*"/
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
    else if (has_level("fatal") || has_level("critical")) { current_color = c_magenta; matched = 1 }
    else if (has_level("error") || has_level("severe")) { current_color = c_red; matched = 1 }
    else if (has_level("warn") || has_level("warning")) { current_color = c_yellow; matched = 1 }
    else if (has_level("info")) { current_color = c_cyan; matched = 1 }
    else if (has_level("debug")) { current_color = c_blue; matched = 1 }
    else if (has_level("trace")) { current_color = c_dark_cyan; matched = 1 }
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
    guard: DuplicateGuard | null;
}): string {
    const { tomcatHome, tomcatBaseDir, httpPort, debugPort, contextPath, javaOpts, colorizeLogs, guard } = opts;
    const safeTomcatHome = escapeBat(tomcatHome);
    const safeTomcatBase = escapeBat(tomcatBaseDir);
    const safeJavaOpts = escapeBat(javaOpts);
    const catalinaRunLine = colorizeLogs
        ? `powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0colorize-logs.ps1" -CatalinaScript "%CATALINA_HOME%\\bin\\catalina.bat"`
        : `call "%CATALINA_HOME%\\bin\\catalina.bat" jpda run`;

    // Recover first: a previous run may have been killed before it could restore.
    const duplicateProtection = !guard ? '' : `
echo [Duplicate Protection] Checking for duplicate WEB-INF\\classes...
if exist "${escapeBat(guard.docBaseClasses)}" (
    echo [Duplicate Protection] Moving WEB-INF\\classes out of docBase to prevent duplicate Spring loading.
    if exist "${escapeBat(guard.backupClasses)}" rmdir /S /Q "${escapeBat(guard.backupClasses)}"
    if not exist "${escapeBat(guard.backupParent)}" mkdir "${escapeBat(guard.backupParent)}"
    move "${escapeBat(guard.docBaseClasses)}" "${escapeBat(guard.backupClasses)}" > nul
    if exist "${escapeBat(guard.docBaseClasses)}" echo [Duplicate Protection] WARNING: could not move WEB-INF\\classes ^(a build running, or a file locked?^). Spring may load its configuration twice.
)
`;

    // catalina.bat runs in the foreground, so this is reached whenever Tomcat exits on its own —
    // the common case, since stop-tomcat kills the JVM and control returns here. Windows batch has
    // no trap equivalent, so a killed terminal is still covered only by the recovery above.
    const duplicateRestore = !guard ? '' : `
${buildRestoreBat(guard)}
`;

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
${duplicateProtection}

set "JAVA_OPTS=${safeJavaOpts}"
set "CATALINA_HOME=${safeTomcatHome}"
set "CATALINA_BASE=${safeTomcatBase}"
set "JPDA_ADDRESS=127.0.0.1:${debugPort}"

echo Tomcat is launching (HTTP Port ${httpPort})...
${catalinaRunLine}
set "HST_CATALINA_EXIT=%ERRORLEVEL%"
${duplicateRestore}
if exist "%~dp0restart-requested" (
    del /Q "%~dp0restart-requested" > nul 2>&1
    echo Tomcat start was interrupted by Restart.
    exit /b 0
)
echo Tomcat process exited.
exit /b %HST_CATALINA_EXIT%
`;
}

function buildStopBat(httpPort: number, debugPort: number, guard: DuplicateGuard | null, tomcatBaseDir?: string): string {
    // Also restored by the start script once catalina returns; both paths are idempotent.
    const duplicateRestore = !guard ? '' : `
${buildRestoreBat(guard)}
`;

    return `@echo off
chcp 65001 > nul
echo ====================================================
echo Stopping Tomcat...
echo ====================================================

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-owned-process.ps1" -Ports "${debugPort},${httpPort}" -CatalinaBase "${escapeBat(tomcatBaseDir ?? '')}"
if errorlevel 1 goto :stop_failed
${duplicateRestore}
echo Tomcat stopped cleanly.
exit /b 0

:stop_failed
echo WARNING: Tomcat was not stopped. WEB-INF\classes was not restored while the process is still running.
exit /b 1
`;
}

function buildStartSh(opts: {
    tomcatHome: string; tomcatBaseDir: string; httpPort: number; debugPort: number;
    contextPath: string; javaOpts: string; colorizeLogs: boolean;
    guard: DuplicateGuard | null;
}): string {
    const { tomcatHome, tomcatBaseDir, httpPort, debugPort, contextPath, javaOpts, colorizeLogs, guard } = opts;

    // The trap is installed before the move, so Ctrl-C at any point still restores. EXIT also
    // covers catalina returning on its own, which is why the shell script needs no explicit tail.
    const duplicateProtection = !guard ? '' : `
${buildRestoreShFunction(guard)}
trap hst_restore_classes EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "[Duplicate Protection] Checking for duplicate WEB-INF/classes..."
if [ -d ${quoteSh(guard.docBaseClasses)} ]; then
    echo "[Duplicate Protection] Moving WEB-INF/classes out of docBase to prevent duplicate Spring loading."
    rm -rf ${quoteSh(guard.backupClasses)}
    mkdir -p ${quoteSh(guard.backupParent)}
    if ! mv ${quoteSh(guard.docBaseClasses)} ${quoteSh(guard.backupClasses)}; then
        echo "[Duplicate Protection] WARNING: could not move WEB-INF/classes (a build running, or a file locked?). Spring may load its configuration twice."
    fi
fi
`;

    return `#!/bin/bash
# start-tomcat.sh — generated by happy-spring-tomcat extension
set -o pipefail
echo "==================================================="
echo "Starting Tomcat in DEBUG mode (Port ${debugPort})..."
echo "HTTP Port: ${httpPort}"
printf '%s\n' ${quoteSh(`Context Path: ${contextPath}`)}
echo "==================================================="
${duplicateProtection}
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

function buildStopSh(httpPort: number, debugPort: number, guard: DuplicateGuard | null, tomcatBaseDir?: string): string {
    // start-tomcat.sh restores via its own trap; this covers being stopped from elsewhere.
    const duplicateRestore = !guard ? '' : `
${buildRestoreShFunction(guard)}
hst_restore_classes
`;

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
    echo "WARNING: Tomcat was not stopped. WEB-INF/classes was not restored while the process is still running." >&2
    exit 1
fi
${duplicateRestore}
echo "Tomcat stopped cleanly."
`;
}
