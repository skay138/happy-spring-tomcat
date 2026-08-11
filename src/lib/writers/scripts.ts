import * as fs from 'fs';
import * as path from 'path';
import { ConfigWriterOptions } from '../types';

export function writeScripts(opts: ConfigWriterOptions): DuplicateGuardResolution {
    const { vscodeDir, tomcatHome, tomcatBaseDir, httpPort, debugPort, contextPath, javaOpts, colorizeLogs } = opts;
    const extensionDir = path.join(vscodeDir, 'happy-spring-tomcat');

    if (!fs.existsSync(extensionDir)) {
        fs.mkdirSync(extensionDir, { recursive: true });
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

function buildColorizePs1(): string {
    return `$currentColor = "White"
$esc = [char]27
$input | ForEach-Object {
    $line = $_ -replace "\\x1b\\[[0-9;]*m",""

    $isNewEntry = $line -match '^(\\[?\\d{4}-\\d{2}-\\d{2}\\s|\\[?\\d{2}-\\w{3}-\\d{4}\\s|\\w{3}\\s\\d{2},\\s\\d{4})'

    if ($isNewEntry) {
        switch -Regex -CaseSensitive ($line) {
            '\\b(FATAL|CRITICAL)\\b' { $currentColor = "Magenta"; break }
            '\\b(ERROR|SEVERE)\\b|Exception\\b|Error\\b|심각' { $currentColor = "Red"; break }
            '\\b(WARN|WARNING|Potential)\\b|경고' { $currentColor = "Yellow"; break }
            '\\b(SQL|QUERY|sqltiming|HikariPool)\\b|Preparing:|Parameters:' { $currentColor = "DarkYellow"; break }
            '\\b(HTTP|REQUEST|RESPONSE|Mapping|Dispatching)\\b' { $currentColor = "Green"; break }
            '\\b(INFO|Started|Initializing)\\b|정보' { $currentColor = "Cyan"; break }
            '\\b(DEBUG|debug)\\b' { $currentColor = "Blue"; break }
            '\\b(TRACE|trace)\\b' { $currentColor = "DarkCyan"; break }
            default { $currentColor = "White" }
        }
        Write-Host $_ -ForegroundColor $currentColor
    } else {
        Write-Host "$esc[2m$_$esc[0m" -ForegroundColor $currentColor
    }
}`;
}

function buildStopOwnedProcessPs1(): string {
    return `param(
    [Parameter(Mandatory = $true)][int]$Port,
    [Parameter(Mandatory = $true)][string]$CatalinaBase
)

$processIds = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
$foreignFound = $false
$expectedBase = [IO.Path]::GetFullPath($CatalinaBase).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
foreach ($owningProcessId in $processIds) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $owningProcessId" -ErrorAction SilentlyContinue
    $commandLine = if ($process) { [string]$process.CommandLine } else { "" }
    $baseMatch = [regex]::Match($commandLine, '-Dcatalina\\.base=(?:"([^"]+)"|(\\S+))', [Text.RegularExpressions.RegexOptions]::IgnoreCase)
    $processBase = if ($baseMatch.Success) {
        $rawBase = if ($baseMatch.Groups[1].Success) { $baseMatch.Groups[1].Value } else { $baseMatch.Groups[2].Value }
        try { [IO.Path]::GetFullPath($rawBase).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) } catch { "" }
    } else { "" }
    if ([string]::Equals($processBase, $expectedBase, [StringComparison]::OrdinalIgnoreCase)) {
        Write-Host "Stopping Happy Spring Tomcat PID: $owningProcessId (port $Port)"
        try {
            Stop-Process -Id $owningProcessId -Force -ErrorAction Stop
        } catch {
            Write-Warning "Failed to stop Happy Spring Tomcat PID $($owningProcessId): $($_.Exception.Message)"
            $foreignFound = $true
        }
    } else {
        Write-Warning "Port $Port belongs to another process (PID $owningProcessId); it was not stopped."
        $foreignFound = $true
    }
}
if ($foreignFound) { exit 2 }
exit 0
`;
}

function buildColorizeAwk(): string {
    return `BEGIN {
    c_reset = "\\033[0m"
    c_dim = "\\033[2m"
    c_magenta = "\\033[35m"
    c_red = "\\033[31m"
    c_yellow = "\\033[33m"
    c_green = "\\033[32m"
    c_cyan = "\\033[36m"
    c_blue = "\\033[34m"
    c_orange = "\\033[38;5;208m"
    c_white = "\\033[37m"
    current_color = c_white
}
{
    line = $0
    sub(/^\\xef\\xbb\\xbf/, "", line)
    gsub(/\\033\\[[0-9;]*m/, "", line)

    if (line ~ /^(\\[?[0-9]{4}-[0-9]{2}-[0-9]{2} |\\[?[0-9]{2}-[a-zA-Z]{3}-[0-9]{4} |\\[?[a-zA-Z]{3} [0-9]{2}, [0-9]{4})/) {
        if (line ~ /FATAL|CRITICAL/) { current_color = c_magenta }
        else if (line ~ /ERROR|SEVERE|Exception|Error|심각/) { current_color = c_red }
        else if (line ~ /WARN|WARNING|Potential|경고/) { current_color = c_yellow }
        else if (line ~ /SQL|QUERY|sqltiming|HikariPool|Preparing:|Parameters:/) { current_color = c_orange }
        else if (line ~ /HTTP|REQUEST|RESPONSE|Mapping|Dispatching/) { current_color = c_green }
        else if (line ~ /INFO|Started|Initializing|정보/) { current_color = c_cyan }
        else if (line ~ /DEBUG|debug/) { current_color = c_blue }
        else if (line ~ /TRACE|trace/) { current_color = c_cyan }
        else { current_color = c_white }

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
        ? `call "%CATALINA_HOME%\\bin\\catalina.bat" jpda run 2>&1 | powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0colorize-logs.ps1"`
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
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-owned-process.ps1" -Port ${debugPort} -CatalinaBase "${safeTomcatBase}"
if errorlevel 1 exit /b 1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-owned-process.ps1" -Port ${httpPort} -CatalinaBase "${safeTomcatBase}"
if errorlevel 1 exit /b 1
timeout /t 1 /nobreak > nul
${duplicateProtection}

set "JAVA_OPTS=${safeJavaOpts}"
set "CATALINA_HOME=${safeTomcatHome}"
set "CATALINA_BASE=${safeTomcatBase}"
set "JPDA_ADDRESS=127.0.0.1:${debugPort}"

echo Tomcat is launching (HTTP Port ${httpPort})...
${catalinaRunLine}
${duplicateRestore}
if exist "%~dp0restart-requested" (
    del /Q "%~dp0restart-requested" > nul 2>&1
    echo Tomcat start was interrupted by Restart.
    exit /b 1
)
echo Tomcat process exited.
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

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-owned-process.ps1" -Port ${debugPort} -CatalinaBase "${escapeBat(tomcatBaseDir ?? '')}"
if errorlevel 1 goto :stop_failed
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-owned-process.ps1" -Port ${httpPort} -CatalinaBase "${escapeBat(tomcatBaseDir ?? '')}"
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
if [ -f "$(dirname "$0")/restart-requested" ]; then
    rm -f "$(dirname "$0")/restart-requested"
    echo "Tomcat start was interrupted by Restart."
    exit 1
fi
echo "Tomcat process exited."
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
