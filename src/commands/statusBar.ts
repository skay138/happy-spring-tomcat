import * as vscode from 'vscode';
import { isTomcatRunning } from '../lib/portChecker';
import { isInternalUpdate } from '../lib/state';
import { STOP_TASK_NAME } from '../lib/constants';
import { isTomcatDebugSession, resolveDebugConfigName } from '../lib/debugResolver';

/**
 * Watches for the Tomcat debug session to start, then polls the HTTP port
 * until Tomcat is ready, and opens the browser via vscode.env.openExternal.
 *
 * This is the correct extension-native approach instead of serverReadyAction,
 * which does not work for request: "attach" launch configurations.
 */
export function registerAutoOpenBrowser(context: vscode.ExtensionContext): void {
    const listener = vscode.debug.onDidStartDebugSession(async (session) => {
        const config = vscode.workspace.getConfiguration('happySpringTomcat');
        const debugPort = config.get<number>('debugPort', 8000);

        if (!isTomcatDebugSession(session, debugPort)) { return; }
        if (!config.get<boolean>('autoOpenBrowser', true)) { return; }

        const httpPort = config.get<number>('httpPort', 8080);
        const contextPath = config.get<string>('contextPath', '/');
        const normalizedContext = contextPath.startsWith('/') ? contextPath : '/' + contextPath;
        const url = `http://localhost:${httpPort}${normalizedContext}`;

        // Poll until the HTTP port is accepting connections (max 60 seconds)
        const maxAttempts = 60;
        const intervalMs = 1000;
        for (let i = 0; i < maxAttempts; i++) {
            await new Promise(resolve => setTimeout(resolve, intervalMs));
            const running = await isTomcatRunning(httpPort);
            if (running) {
                vscode.env.openExternal(vscode.Uri.parse(url));
                return;
            }
        }
    });

    context.subscriptions.push(listener);
}

export function registerStatusBar(context: vscode.ExtensionContext): void {
    // --- Status Bar Item ---
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'happy-spring-tomcat.showMenu';
    context.subscriptions.push(statusBarItem);

    const initialConfig = vscode.workspace.getConfiguration('happySpringTomcat');
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
        const port = vscode.workspace.getConfiguration('happySpringTomcat').get<number>('httpPort', 8080);
        const running = await isTomcatRunning(port);
        updateStatusBar(running);
    }

    updateStatusBar(false);
    pollTomcatStatus();
    const statusPollInterval = setInterval(pollTomcatStatus, 5000);
    context.subscriptions.push({ dispose: () => clearInterval(statusPollInterval) });

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

            // Stop: run Stop Tomcat task and wait for completion
            const tasks = await vscode.tasks.fetchTasks();
            const stopTask = tasks.find(t => t.name === STOP_TASK_NAME);
            if (stopTask) {
                const execution = await vscode.tasks.executeTask(stopTask);
                await new Promise<void>(resolve => {
                    let settled = false;
                    let listener: vscode.Disposable;

                    const timer = setTimeout(() => {
                        if (!settled) {
                            settled = true;
                            listener.dispose();
                            resolve();
                        }
                    }, 10000);

                    listener = vscode.tasks.onDidEndTask(e => {
                        if (e.execution === execution && !settled) {
                            settled = true;
                            clearTimeout(timer);
                            listener.dispose();
                            resolve();
                        }
                    });
                });
            }

            // Start: attach debugger (which triggers Start Tomcat as preLaunchTask)
            const configName = resolveDebugConfigName(workspaceFolders[0]);
            if (configName) {
                await vscode.debug.startDebugging(workspaceFolders[0], configName);
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
        })
    );

    // --- Configuration Change Listener with internal-update guard ---
    let configChangeTimer: ReturnType<typeof setTimeout> | undefined;
    const configListener = vscode.workspace.onDidChangeConfiguration(e => {
        if (!e.affectsConfiguration('happySpringTomcat')) { return; }

        if (e.affectsConfiguration('happySpringTomcat.showStatusBar')) {
            const updatedConfig = vscode.workspace.getConfiguration('happySpringTomcat');
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
            'happySpringTomcat.docBase',
            'happySpringTomcat.javaOpts',
            'happySpringTomcat.sourceBase',
            'happySpringTomcat.classesBase',
            'happySpringTomcat.jndiResources',
            'happySpringTomcat.colorizeLogs',
            'happySpringTomcat.preLaunchBuild'
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
    context.subscriptions.push(configListener);

    // --- Show Menu Command ---
    const showMenuDisposable = vscode.commands.registerCommand('happy-spring-tomcat.showMenu', async () => {
        const items = [
            { label: `$(play) ${vscode.l10n.t('Start Tomcat (Attach Debug)')}`, description: vscode.l10n.t('Launch and attach debugger'), action: 'workbench.action.debug.start' },
            { label: `$(debug-restart) ${vscode.l10n.t('Restart Tomcat')}`, description: vscode.l10n.t('Stop then re-launch Tomcat'), action: 'happy-spring-tomcat.restart' },
            { label: `$(primitive-square) ${vscode.l10n.t('Stop Tomcat')}`, description: vscode.l10n.t('Kill Tomcat processes'), action: 'workbench.action.tasks.runTask', args: STOP_TASK_NAME },
            { label: `$(trash) ${vscode.l10n.t('Clear Tomcat Cache')}`, description: vscode.l10n.t('Delete work/temp directory contents'), action: 'happy-spring-tomcat.clearCache' },
            { label: `$(list-unordered) ${vscode.l10n.t('View Latest Logs')}`, description: vscode.l10n.t('Open the most recent log file'), action: 'happy-spring-tomcat.viewLogs' },
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
