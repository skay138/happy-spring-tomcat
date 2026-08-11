import * as fs from 'fs';
import * as path from 'path';
import { applyEdits, modify, parse, ParseError, printParseErrorCode } from 'jsonc-parser';
import { TOMCAT_DEBUG_CONFIG_NAME, START_TASK_NAME, STOP_TASK_NAME } from '../constants';

export function writeTasksJson(vscodeDir: string, preLaunchBuild: string = 'none'): void {
    const tasksJsonPath = path.join(vscodeDir, 'tasks.json');
    let tasksJson: any = { version: '2.0.0', tasks: [] };
    let original = JSON.stringify(tasksJson, null, 4);

    if (fs.existsSync(tasksJsonPath)) {
        original = fs.readFileSync(tasksJsonPath, 'utf8');
        tasksJson = parseJsonc(original, tasksJsonPath);
    }

    if (!tasksJson.tasks) { tasksJson.tasks = []; }

    const isWindows = process.platform === 'win32';
    const lifecycleCommand = (scriptName: 'start-tomcat' | 'stop-tomcat') => isWindows
        ? `\${workspaceFolder}\\.vscode\\happy-spring-tomcat\\${scriptName}.bat`
        : `\${workspaceFolder}/.vscode/happy-spring-tomcat/${scriptName}.sh`;
    const lifecycleShell = isWindows
        ? { executable: 'cmd.exe', args: ['/d', '/c'] }
        : { executable: '/bin/bash', args: ['-c'] };

    const stopTaskDef: any = {
        label: STOP_TASK_NAME,
        type: 'shell',
        command: lifecycleCommand('stop-tomcat'),
        options: { shell: lifecycleShell },
        presentation: { reveal: 'silent', panel: 'shared', close: true, showReuseMessage: false }
    };

    const startTaskDef: any = {
        label: START_TASK_NAME,
        type: 'shell',
        command: lifecycleCommand('start-tomcat'),
        options: { shell: lifecycleShell },
        isBackground: true,
        problemMatcher: {
            pattern: { regexp: '^$' },
            // The debugger only needs JDWP to be listening; waiting for full Tomcat/Spring
            // startup creates a long window where Restart/Stop can interrupt a pending attach.
            background: {
                activeOnStart: true,
                beginsPattern: 'Starting Tomcat',
                endsPattern: 'Listening for transport dt_socket at address:'
            }
        },
        presentation: { reveal: 'always', panel: 'dedicated', group: 'tomcat', showReuseMessage: false }
    };

    if (preLaunchBuild === 'maven') {
        upsertByLabel(tasksJson.tasks, 'Maven Build', {
            label: 'Maven Build',
            type: 'shell',
            command: 'mvn package -DskipTests',
            group: 'build',
            presentation: { reveal: 'always', panel: 'shared' }
        }, false);
        startTaskDef.dependsOn = ['Maven Build'];
    } else if (preLaunchBuild === 'gradle') {
        upsertByLabel(tasksJson.tasks, 'Gradle Build', {
            label: 'Gradle Build',
            type: 'shell',
            command: './gradlew build -x test',
            windows: { command: 'gradlew.bat build -x test' },
            group: 'build',
            presentation: { reveal: 'always', panel: 'shared' }
        }, false);
        startTaskDef.dependsOn = ['Gradle Build'];
    }

    upsertByLabel(tasksJson.tasks, STOP_TASK_NAME, stopTaskDef, true);
    upsertByLabel(tasksJson.tasks, START_TASK_NAME, startTaskDef, false);

    fs.writeFileSync(tasksJsonPath, updateJsoncProperty(original, 'tasks', tasksJson.tasks), 'utf8');
}

export function writeLaunchJson(vscodeDir: string, debugPort: number, httpPort: number, contextPath: string, autoOpenBrowser: boolean): void {
    const launchJsonPath = path.join(vscodeDir, 'launch.json');
    let launchJson: any = { version: '0.2.0', configurations: [] };
    let original = JSON.stringify(launchJson, null, 4);

    if (fs.existsSync(launchJsonPath)) {
        original = fs.readFileSync(launchJsonPath, 'utf8');
        launchJson = parseJsonc(original, launchJsonPath);
    }

    if (!launchJson.configurations) { launchJson.configurations = []; }

    const launchName = TOMCAT_DEBUG_CONFIG_NAME;
    const launchConfigDef: any = {
        type: 'java',
        name: launchName,
        request: 'attach',
        hostName: 'localhost',
        port: debugPort,
        preLaunchTask: START_TASK_NAME,
        postDebugTask: STOP_TASK_NAME,
        internalConsoleOptions: 'neverOpen'
    };

    // Note: serverReadyAction is intentionally omitted — it is not supported for
    // request: "attach" configurations. Browser auto-open is handled by the
    // extension itself via vscode.debug.onDidStartDebugSession + port polling.

    const idx = launchJson.configurations.findIndex((c: any) => c.name === launchName);
    if (idx >= 0) {
        launchJson.configurations[idx] = launchConfigDef;
    } else {
        launchJson.configurations.push(launchConfigDef);
    }

    fs.writeFileSync(launchJsonPath, updateJsoncProperty(original, 'configurations', launchJson.configurations), 'utf8');
}

function parseJsonc(content: string, filePath: string): any {
    const errors: ParseError[] = [];
    const value = parse(content, errors, { allowTrailingComma: true, disallowComments: false });
    if (errors.length > 0 || !value || typeof value !== 'object') {
        const detail = errors.map(e => `${printParseErrorCode(e.error)} at offset ${e.offset}`).join(', ');
        throw new Error(`Cannot update invalid JSONC file [${filePath}]: ${detail || 'root is not an object'}`);
    }
    return value;
}

function updateJsoncProperty(content: string, property: string, value: unknown): string {
    const edits = modify(content, [property], value, {
        formattingOptions: { insertSpaces: true, tabSize: 4, eol: content.includes('\r\n') ? '\r\n' : '\n' }
    });
    return applyEdits(content, edits);
}

function upsertByLabel(arr: any[], label: string, def: any, prepend: boolean): void {
    const idx = arr.findIndex((t: any) => t.label === label);
    if (idx >= 0) {
        arr[idx] = def;
    } else if (prepend) {
        arr.unshift(def);
    } else {
        arr.push(def);
    }
}
