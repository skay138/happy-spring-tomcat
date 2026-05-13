import * as fs from 'fs';
import * as path from 'path';
import { TOMCAT_DEBUG_CONFIG_NAME, START_TASK_NAME, STOP_TASK_NAME } from '../constants';

export function writeTasksJson(vscodeDir: string, preLaunchBuild: string = 'none'): void {
    const tasksJsonPath = path.join(vscodeDir, 'tasks.json');
    let tasksJson: any = { version: '2.0.0', tasks: [] };

    if (fs.existsSync(tasksJsonPath)) {
        try {
            const content = fs.readFileSync(tasksJsonPath, 'utf8');
            tasksJson = JSON.parse(content.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, ''));
        } catch (e) { /* recreate */ }
    }

    if (!tasksJson.tasks) { tasksJson.tasks = []; }

    const stopTaskDef: any = {
        label: STOP_TASK_NAME,
        type: 'shell',
        command: '${workspaceFolder}/.vscode/happy-spring-tomcat/stop-tomcat.sh',
        windows: { command: '${workspaceFolder}\\.vscode\\happy-spring-tomcat\\stop-tomcat.bat' },
        presentation: { reveal: 'silent', panel: 'shared', close: true, showReuseMessage: false }
    };

    const startTaskDef: any = {
        label: START_TASK_NAME,
        type: 'shell',
        command: '${workspaceFolder}/.vscode/happy-spring-tomcat/start-tomcat.sh',
        windows: { command: '${workspaceFolder}\\.vscode\\happy-spring-tomcat\\start-tomcat.bat' },
        isBackground: true,
        problemMatcher: {
            pattern: { regexp: '^$' },
            background: { activeOnStart: true, beginsPattern: 'Starting Tomcat', endsPattern: 'Server startup in' }
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

    fs.writeFileSync(tasksJsonPath, JSON.stringify(tasksJson, null, 4), 'utf8');
}

export function writeLaunchJson(vscodeDir: string, debugPort: number, httpPort: number, contextPath: string, autoOpenBrowser: boolean): void {
    const launchJsonPath = path.join(vscodeDir, 'launch.json');
    let launchJson: any = { version: '0.2.0', configurations: [] };

    if (fs.existsSync(launchJsonPath)) {
        try {
            const content = fs.readFileSync(launchJsonPath, 'utf8');
            launchJson = JSON.parse(content.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, ''));
        } catch (e) { /* ignore */ }
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

    fs.writeFileSync(launchJsonPath, JSON.stringify(launchJson, null, 4), 'utf8');
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
