import * as vscode from 'vscode';
import { executeTaskAndWait } from '../lib/taskLifecycle';
import { projectConfig } from '../lib/workspaceConfig';
import * as fs from 'fs';
import * as path from 'path';
import { isPortListening, isTomcatRunning } from '../lib/portChecker';
import { isInternalUpdate } from '../lib/state';
import { START_TASK_NAME, STOP_TASK_NAME } from '../lib/constants';
import { isTomcatDebugSession, resolveDebugConfigName } from '../lib/debugResolver';

/**
 * Watches for the Tomcat debug session to start, then polls the HTTP port
 * until Tomcat is ready, and opens the browser via vscode.env.openExternal.
 *
 * This is the correct extension-native approach instead of serverReadyAction,
 * which does not work for request: "attach" launch configurations.
 */
export function registerAutoOpenBrowser(context: vscode.ExtensionContext): void {
    let disposed = false;
    const listener = vscode.debug.onDidStartDebugSession(async (session) => {
        const config = projectConfig();
        const debugPort = config.get<number>('debugPort', 8000);

        if (!isTomcatDebugSession(session, debugPort)) { return; }
        if (!config.get<boolean>('autoOpenBrowser', true)) { return; }

        const httpPort = config.get<number>('httpPort', 8080);
        const contextPath = config.get<string>('contextPath', '/');
        const normalizedContext = contextPath.startsWith('/') ? contextPath : '/' + contextPath;
        const url = `http://localhost:${httpPort}${normalizedContext}`;

        let ended = false;
        const termination = vscode.debug.onDidTerminateDebugSession(closed => { if (closed.id === session.id) { ended = true; } });
        // Opening the HTTP port is not an application health check. Stop polling with the session.
        const maxAttempts = 60;
        const intervalMs = 1000;
        try {
            for (let i = 0; i < maxAttempts; i++) {
                await new Promise(resolve => setTimeout(resolve, intervalMs));
                if (disposed || ended || !projectConfig().get<boolean>('autoOpenBrowser', true)) { return; }
                const running = await isTomcatRunning(httpPort);
                if (running && !disposed && !ended) {
                    await vscode.env.openExternal(vscode.Uri.parse(url));
                    return;
                }
            }
        } finally {
            termination.dispose();
        }
    });

    context.subscriptions.push({ dispose: () => { disposed = true; listener.dispose(); } });
}

export function registerStatusBar(context: vscode.ExtensionContext): void {
    // --- Status Bar Item ---
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'happy-spring-tomcat.showMenu';
    context.subscriptions.push(statusBarItem);

    const initialConfig = projectConfig();
    if (initialConfig.get<boolean>('showStatusBar', true)) {
        statusBarItem.show();
    }

    function updateStatusBar(running: boolean): void {
        statusBarItem.text = running ? '$(list-flat) Tomcat $(server)' : '$(list-flat) Tomcat';
        statusBarItem.tooltip = running
            ? vscode.l10n.t('Tomcat is running — Click for menu')
            : vscode.l10n.t('Tomcat is stopped — Click for menu');
    }

    async function pollTomcatStatus(): Promise<void> {
        const port = projectConfig().get<number>('httpPort', 8080);
        const running = await isTomcatRunning(port);
        updateStatusBar(running);
    }

    updateStatusBar(false);
    pollTomcatStatus();
    const statusPollInterval = setInterval(pollTomcatStatus, 5000);
    context.subscriptions.push({ dispose: () => clearInterval(statusPollInterval) });

    // VS Code does not expose a list of all debug sessions. Track ours so Restart also works
    // when another debug session is currently active in the UI.
    const tomcatDebugSessions = new Set<vscode.DebugSession>();
    const activeSession = vscode.debug.activeDebugSession;
    const initialDebugPort = initialConfig.get<number>('debugPort', 8000);
    if (activeSession && isTomcatDebugSession(activeSession, initialDebugPort)) {
        tomcatDebugSessions.add(activeSession);
    }
    context.subscriptions.push(
        vscode.debug.onDidStartDebugSession(session => {
            const port = projectConfig().get<number>('debugPort', 8000);
            if (isTomcatDebugSession(session, port)) { tomcatDebugSessions.add(session); }
        }),
        vscode.debug.onDidTerminateDebugSession(session => tomcatDebugSessions.delete(session))
    );

    // --- Open Settings Command ---
    context.subscriptions.push(
        vscode.commands.registerCommand('happy-spring-tomcat.openSettings', () => {
            vscode.commands.executeCommand('workbench.action.openWorkspaceSettings', 'happySpringTomcat');
        })
    );

    // --- Restart Command ---
    context.subscriptions.push(
        vscode.commands.registerCommand('happy-spring-tomcat.restart', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) { return; }

            const folder = workspaceFolders[0];
            const config = projectConfig();
            const httpPort = config.get<number>('httpPort', 8080);
            const debugPort = config.get<number>('debugPort', 8000);
            const tasks = await vscode.tasks.fetchTasks();
            const stopTask = tasks.find(t => t.name === STOP_TASK_NAME &&
                (t.scope === folder || t.scope === vscode.TaskScope.Workspace));
            const restartMarker = path.join(folder.uri.fsPath, '.vscode', 'happy-spring-tomcat', 'restart-requested');
            const startTaskRunning = vscode.tasks.taskExecutions.some(
                e => e.task.name === START_TASK_NAME
            );
            if (startTaskRunning) {
                fs.writeFileSync(restartMarker, String(Date.now()), 'utf8');
            }

            // Restart is a clean replacement, not an attempt to preserve Reload Window's
            // partially reconstructed lifecycle state. Stop only this workspace's owned JVM,
            // then close its debug adapters and retire its generated tasks/terminals.
            if (!stopTask || !await executeTaskAndWait(stopTask, 15000)) {
                fs.rmSync(restartMarker, { force: true });
                vscode.window.showErrorMessage(vscode.l10n.t('Restart cancelled: the Tomcat stop task did not finish successfully.'));
                return;
            }

            await delay(500);
            const sessionsToStop = getTomcatDebugSessions(tomcatDebugSessions, debugPort);
            for (const tomcatSession of sessionsToStop) {
                await vscode.debug.stopDebugging(tomcatSession);
            }
            if (!await waitForTomcatDebugSessionsToStop(tomcatDebugSessions, debugPort, 5000)) {
                fs.rmSync(restartMarker, { force: true });
                vscode.window.showErrorMessage(vscode.l10n.t('Restart cancelled: the current Tomcat debug session did not stop in time.'));
                return;
            }

            if (!await waitForTaskToStop(START_TASK_NAME, 10000)) {
                fs.rmSync(restartMarker, { force: true });
                vscode.window.showErrorMessage(vscode.l10n.t('Restart cancelled: the previous Tomcat start task did not stop in time.'));
                return;
            }

            if (!await waitForTomcatToStop(httpPort, debugPort, 15000)) {
                fs.rmSync(restartMarker, { force: true });
                vscode.window.showErrorMessage(vscode.l10n.t(
                    'Restart cancelled: HTTP port {0} is still in use. The process was not stopped.',
                    httpPort
                ));
                return;
            }
            // An old Start task consumes this marker when it exits. Remove any leftover marker
            // when Restart was invoked without an active Start task or the task exited unusually.
            fs.rmSync(restartMarker, { force: true });

            const configName = resolveDebugConfigName(folder);
            if (!configName) {
                const btnRunSetup = vscode.l10n.t('Run Setup');
                const selection = await vscode.window.showErrorMessage(
                    vscode.l10n.t('Tomcat debug configuration not found. Please run Setup again.'),
                    btnRunSetup
                );
                if (selection === btnRunSetup) {
                    vscode.commands.executeCommand('happy-spring-tomcat.setup');
                }
                return;
            }

            // Keep F5 and Restart on the same Start/Stop task lifecycle.
            const started = await vscode.debug.startDebugging(folder, configName);
            if (!started) {
                vscode.window.showErrorMessage(vscode.l10n.t('Restart failed: VS Code did not start the Tomcat debug configuration.'));
            }
        })
    );

    // --- Configuration Change Listener with internal-update guard ---
    let configChangeTimer: ReturnType<typeof setTimeout> | undefined;
    const configListener = vscode.workspace.onDidChangeConfiguration(e => {
        if (!e.affectsConfiguration('happySpringTomcat')) { return; }

        if (e.affectsConfiguration('happySpringTomcat.showStatusBar')) {
            const updatedConfig = projectConfig();
            if (updatedConfig.get<boolean>('showStatusBar', true)) {
                statusBarItem.show();
            } else {
                statusBarItem.hide();
            }
        }

        // Debounce + guard: don't prompt if the extension itself made the change
        const settingsAffectingScripts = [
            'happySpringTomcat.tomcatHome',
            'happySpringTomcat.httpPort',
            'happySpringTomcat.debugPort',
            'happySpringTomcat.contextPath',
            'happySpringTomcat.builtWebAppDirectory',
            'happySpringTomcat.javaOpts',
            'happySpringTomcat.webSourceDirectory',
            'happySpringTomcat.classesDirectory',
            'happySpringTomcat.jndiResources',
            'happySpringTomcat.colorizeLogs',
            'happySpringTomcat.preLaunchBuild',
            'happySpringTomcat.customBuildTask',
            'happySpringTomcat.resourcesDirectory'
        ];
        if (settingsAffectingScripts.some(key => e.affectsConfiguration(key))) {
            if (isInternalUpdate()) { return; }

            if (configChangeTimer) { clearTimeout(configChangeTimer); }
            const btnYes = vscode.l10n.t('Yes');
            configChangeTimer = setTimeout(() => {
                vscode.window.showInformationMessage(
                    vscode.l10n.t('Tomcat settings changed. Would you like to re-apply the debug setup?'),
                    btnYes, vscode.l10n.t('No')
                ).then(selection => {
                    if (selection === btnYes) {
                        vscode.commands.executeCommand('happy-spring-tomcat.setup');
                    }
                });
            }, 1500);
        }
    });
    context.subscriptions.push(configListener, { dispose: () => { if (configChangeTimer) { clearTimeout(configChangeTimer); } } });

    // --- Show Menu Command ---
    const showMenuDisposable = vscode.commands.registerCommand('happy-spring-tomcat.showMenu', async () => {
        const items = [
            { label: `$(play) ${vscode.l10n.t('Start Tomcat (Attach Debug)')}`, description: vscode.l10n.t('Launch and attach debugger'), action: 'workbench.action.debug.start' },
            { label: `$(debug-restart) ${vscode.l10n.t('Restart Tomcat')}`, description: vscode.l10n.t('Stop then re-launch Tomcat'), action: 'happy-spring-tomcat.restart' },
            { label: `$(primitive-square) ${vscode.l10n.t('Stop Tomcat')}`, description: vscode.l10n.t('Kill Tomcat processes'), action: 'workbench.action.tasks.runTask', args: STOP_TASK_NAME },
            { label: `$(trash) ${vscode.l10n.t('Clear Tomcat Cache')}`, description: vscode.l10n.t('Delete work/temp directory contents'), action: 'happy-spring-tomcat.clearCache' },
            { label: `$(close-all) ${vscode.l10n.t('Remove Project Runtime')}`, description: vscode.l10n.t('Remove this project\'s Tomcat runtime and generated scripts'), action: 'happy-spring-tomcat.removeRuntime' },
            { label: `$(list-unordered) ${vscode.l10n.t('View Logs')}`, description: vscode.l10n.t('Choose a Tomcat log file'), action: 'happy-spring-tomcat.viewLogs' },
            { label: `$(check-all) ${vscode.l10n.t('Apply Debug Setup')}`, description: vscode.l10n.t('Apply settings to debug setup'), action: 'happy-spring-tomcat.setup' },
            { label: `$(settings-gear) ${vscode.l10n.t('Open Settings')}`, description: vscode.l10n.t('Configure Happy Spring Tomcat'), action: 'happy-spring-tomcat.openSettings' }
        ];

        const selected = await vscode.window.showQuickPick(items, { placeHolder: vscode.l10n.t('Happy Spring Tomcat Menu') });
        if (!selected) { return; }

        if (selected.action === 'workbench.action.tasks.runTask') {
            const tasks = await vscode.tasks.fetchTasks();
            const task = tasks.find(t => t.name === (selected as any).args);
            if (task) { vscode.tasks.executeTask(task); }
        } else if (selected.action === 'workbench.action.debug.start') {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders) {
                const configName = resolveDebugConfigName(workspaceFolders[0]);
                if (configName) {
                    vscode.debug.startDebugging(workspaceFolders[0], configName);
                } else {
                    const btnRunSetup = vscode.l10n.t('Run Setup');
                    const selection = await vscode.window.showErrorMessage(
                        vscode.l10n.t('Tomcat debug configuration not found. Please run Setup again.'),
                        btnRunSetup
                    );
                    if (selection === btnRunSetup) {
                        vscode.commands.executeCommand('happy-spring-tomcat.setup');
                    }
                }
            }
        } else {
            vscode.commands.executeCommand(selected.action);
        }
    });
    context.subscriptions.push(showMenuDisposable);
}

function getTomcatDebugSessions(
    trackedSessions: Set<vscode.DebugSession>,
    debugPort: number
): vscode.DebugSession[] {
    const sessions = new Map<string, vscode.DebugSession>();
    for (const candidate of trackedSessions) {
        if (isTomcatDebugSession(candidate, debugPort)) { sessions.set(candidate.id, candidate); }
    }
    const active = vscode.debug.activeDebugSession;
    if (active && isTomcatDebugSession(active, debugPort)) { sessions.set(active.id, active); }
    return [...sessions.values()];
}

async function waitForTomcatDebugSessionsToStop(
    trackedSessions: Set<vscode.DebugSession>, debugPort: number, timeoutMs: number
): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (getTomcatDebugSessions(trackedSessions, debugPort).length === 0) { return true; }
        await delay(100);
    }
    return false;
}

async function waitForTaskToStop(taskName: string, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (!vscode.tasks.taskExecutions.some(e => e.task.name === taskName)) { return true; }
        await delay(100);
    }
    return false;
}

async function waitForTomcatToStop(httpPort: number, debugPort: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    let consecutiveClosedChecks = 0;

    while (Date.now() < deadline) {
        const httpOpen = await isTomcatRunning(httpPort);
        const debugOpen = await isPortListening(debugPort);
        if (!httpOpen && !debugOpen) {
            consecutiveClosedChecks++;
            // Require a full second of quiet so the old debug session's postDebugTask has time
            // to be scheduled and complete before a new Tomcat can claim the same ports.
            if (consecutiveClosedChecks >= 4) { return true; }
        } else {
            consecutiveClosedChecks = 0;
        }
        await delay(250);
    }
    return false;
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
