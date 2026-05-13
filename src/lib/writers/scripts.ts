import * as fs from 'fs';
import * as path from 'path';
import { ConfigWriterOptions } from '../types';

export function writeScripts(opts: ConfigWriterOptions): void {
    const { vscodeDir, tomcatHome, tomcatBaseDir, httpPort, debugPort, contextPath, javaOpts, colorizeLogs } = opts;
    const extensionDir = path.join(vscodeDir, 'happy-spring-tomcat');

    if (!fs.existsSync(extensionDir)) {
        fs.mkdirSync(extensionDir, { recursive: true });
    }

    // Windows
    fs.writeFileSync(path.join(extensionDir, 'colorize-logs.ps1'), '﻿' + buildColorizePs1(), 'utf8');
    fs.writeFileSync(path.join(extensionDir, 'start-tomcat.bat'), buildStartBat({ tomcatHome, tomcatBaseDir, httpPort, debugPort, contextPath, javaOpts, colorizeLogs }), 'utf8');
    fs.writeFileSync(path.join(extensionDir, 'stop-tomcat.bat'), buildStopBat(httpPort, debugPort), 'utf8');

    // Mac/Linux
    fs.writeFileSync(path.join(extensionDir, 'colorize-logs.awk'), buildColorizeAwk(), 'utf8');
    const startShPath = path.join(extensionDir, 'start-tomcat.sh');
    const stopShPath = path.join(extensionDir, 'stop-tomcat.sh');
    fs.writeFileSync(startShPath, buildStartSh({ tomcatHome, tomcatBaseDir, httpPort, debugPort, contextPath, javaOpts, colorizeLogs }), 'utf8');
    fs.writeFileSync(stopShPath, buildStopSh(httpPort, debugPort), 'utf8');

    try {
        fs.chmodSync(startShPath, '755');
        fs.chmodSync(stopShPath, '755');
    } catch {
        // chmod not supported on Windows — safe to ignore
    }
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
}): string {
    const { tomcatHome, tomcatBaseDir, httpPort, debugPort, contextPath, javaOpts, colorizeLogs } = opts;
    const catalinaRunLine = colorizeLogs
        ? `call "%CATALINA_HOME%\\bin\\catalina.bat" jpda run 2>&1 | powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0colorize-logs.ps1"`
        : `call "%CATALINA_HOME%\\bin\\catalina.bat" jpda run`;

    return `@echo off
chcp 65001 > nul
echo ====================================================
echo Starting Tomcat in DEBUG mode (Port ${debugPort})...
echo HTTP Port: ${httpPort}
echo Context Path: ${contextPath}
echo ====================================================

echo Cleaning up previous Tomcat instances...
FOR /F "tokens=5" %%T IN ('netstat -a -n -o ^| findstr "LISTENING" ^| findstr ":${debugPort}"') DO (
    taskkill /F /PID %%T > nul 2>&1
)
FOR /F "tokens=5" %%T IN ('netstat -a -n -o ^| findstr "LISTENING" ^| findstr ":${httpPort}"') DO (
    taskkill /F /PID %%T > nul 2>&1
)
timeout /t 1 /nobreak > nul

set "JAVA_OPTS=${javaOpts}"
set "CATALINA_HOME=${tomcatHome}"
set "CATALINA_BASE=${tomcatBaseDir}"
set "JPDA_ADDRESS=127.0.0.1:${debugPort}"

echo Tomcat is launching (HTTP Port ${httpPort})...
${catalinaRunLine}

echo Tomcat process exited.
`;
}

function buildStopBat(httpPort: number, debugPort: number): string {
    return `@echo off
chcp 65001 > nul
echo ====================================================
echo Stopping Tomcat...
echo ====================================================

FOR /F "tokens=5" %%T IN ('netstat -a -n -o ^| findstr "LISTENING" ^| findstr ":${debugPort}"') DO (
    echo Killing debug port PID: %%T
    taskkill /F /PID %%T
)
FOR /F "tokens=5" %%T IN ('netstat -a -n -o ^| findstr "LISTENING" ^| findstr ":${httpPort}"') DO (
    echo Killing HTTP port PID: %%T
    taskkill /F /PID %%T
)
echo Tomcat stopped cleanly.
`;
}

function buildStartSh(opts: {
    tomcatHome: string; tomcatBaseDir: string; httpPort: number; debugPort: number;
    contextPath: string; javaOpts: string; colorizeLogs: boolean;
}): string {
    const { tomcatHome, tomcatBaseDir, httpPort, debugPort, contextPath, javaOpts, colorizeLogs } = opts;
    return `#!/bin/bash
# start-tomcat.sh — generated by happy-spring-tomcat extension
echo "==================================================="
echo "Starting Tomcat in DEBUG mode (Port ${debugPort})..."
echo "HTTP Port: ${httpPort}"
echo "Context Path: ${contextPath}"
echo "==================================================="

echo "Cleaning up previous Tomcat instances..."
lsof -ti :${debugPort} | xargs kill -9 2>/dev/null || true
lsof -ti :${httpPort} | xargs kill -9 2>/dev/null || true
sleep 1

export JAVA_OPTS="${javaOpts}"
export CATALINA_HOME="${tomcatHome}"
export CATALINA_BASE="${tomcatBaseDir}"
export JPDA_ADDRESS="127.0.0.1:${debugPort}"
export JPDA_TRANSPORT="dt_socket"

echo "Tomcat is launching (HTTP Port ${httpPort})..."
${colorizeLogs
    ? `"$CATALINA_HOME/bin/catalina.sh" jpda run 2>&1 | awk -f "$(dirname "$0")/colorize-logs.awk"`
    : `"$CATALINA_HOME/bin/catalina.sh" jpda run`}
echo "Tomcat process exited."
`;
}

function buildStopSh(httpPort: number, debugPort: number): string {
    return `#!/bin/bash
# stop-tomcat.sh — generated by happy-spring-tomcat extension
echo "==================================================="
echo "Stopping Tomcat..."
echo "==================================================="

lsof -ti :${debugPort} | xargs kill -9 2>/dev/null || true
lsof -ti :${httpPort} | xargs kill -9 2>/dev/null || true
echo "Tomcat stopped cleanly."
`;
}
