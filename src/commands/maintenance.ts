import * as vscode from 'vscode';
import { executeTaskAndWait } from '../lib/taskLifecycle';
import { projectConfig } from '../lib/workspaceConfig';
import * as fs from 'fs';
import * as path from 'path';
import { getTomcatBaseDir } from '../lib/tomcatValidator';
import { isPortListening } from '../lib/portChecker';
import { START_TASK_NAME, STOP_TASK_NAME } from '../lib/constants';
import { removeGeneratedVscodeEntries } from '../lib/writers/vscodeConfig';
import { findLegacyClassesBackups, restoreLegacyClassesBackup } from '../lib/legacyClassesBackup';
import { resolveProjectPath, readProjectPaths } from '../lib/configuration';

export function registerMaintenanceCommands(context: vscode.ExtensionContext): void {
    registerClearCacheCommand(context);
    registerViewLogsCommand(context);
    registerRemoveRuntimeCommand(context);
}

function registerRemoveRuntimeCommand(context: vscode.ExtensionContext): void {
    const disposable = vscode.commands.registerCommand('happy-spring-tomcat.removeRuntime', async () => {
        const folder = vscode.workspace.workspaceFolders?.[0];
        const tomcatBaseDir = getTomcatBaseDir(context);
        if (!folder || !context.storageUri || !tomcatBaseDir) {
            vscode.window.showWarningMessage(vscode.l10n.t('No workspace folder open. Please open a project first.'));
            return;
        }

        const projectRoot = folder.uri.fsPath;
        const docBase = resolveProjectPath(readProjectPaths(projectConfig()).builtWebAppDirectory, projectRoot);
        const generatedDir = path.join(projectRoot, '.vscode', 'happy-spring-tomcat');
        const expectedBase = path.join(context.storageUri.fsPath, 'tomcat-base');
        if (!samePath(tomcatBaseDir, expectedBase) || !isWithin(projectRoot, generatedDir)) {
            vscode.window.showErrorMessage(vscode.l10n.t('Runtime cleanup was cancelled because an owned path could not be verified.'));
            return;
        }

        if (!fs.existsSync(tomcatBaseDir) && !fs.existsSync(generatedDir) && !findLegacyClassesBackups(projectRoot, docBase).length) {
            vscode.window.showInformationMessage(vscode.l10n.t('No Happy Spring Tomcat runtime files were found for this project.'));
            return;
        }

        const remove = vscode.l10n.t('Remove Runtime');
        const answer = await vscode.window.showWarningMessage(
            vscode.l10n.t('Remove the Happy Spring Tomcat runtime for this project? Your Tomcat installation and project files will be kept.'),
            { modal: true },
            remove
        );
        if (answer !== remove) { return; }

        try {
            const tasks = await vscode.tasks.fetchTasks();
            const stopTask = tasks.find(task => task.name === STOP_TASK_NAME &&
                (task.scope === folder || task.scope === vscode.TaskScope.Workspace));
            if (stopTask) {
                if (!await executeTaskAndWait(stopTask, 15000)) {
                    throw new Error(vscode.l10n.t('the Tomcat stop task did not finish successfully'));
                }
            } else {
                const config = projectConfig();
                const httpPort = config.get<number>('httpPort', 8080);
                const debugPort = config.get<number>('debugPort', 8000);
                if (await isPortListening(httpPort) || await isPortListening(debugPort)) {
                    throw new Error(vscode.l10n.t('Tomcat may still be running, but its Stop task was not found'));
                }
            }

            if (!await waitForLifecycleTasks(10000)) {
                throw new Error(vscode.l10n.t('a Tomcat lifecycle task did not finish in time'));
            }

            restoreLegacyClassesBackup(projectRoot, docBase);
            removeGeneratedVscodeEntries(path.join(projectRoot, '.vscode'));
            fs.rmSync(tomcatBaseDir, { recursive: true, force: true });
            fs.rmSync(generatedDir, { recursive: true, force: true });
            vscode.window.showInformationMessage(vscode.l10n.t('Happy Spring Tomcat runtime files for this project were removed.'));
        } catch (err: any) {
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to remove the project runtime: {0}', err.message));
        }
    });

    context.subscriptions.push(disposable);
}

function samePath(a: string, b: string): boolean {
    const normalize = (value: string) => path.resolve(value).replace(/[\\/]+$/, '');
    return process.platform === 'win32'
        ? normalize(a).toLowerCase() === normalize(b).toLowerCase()
        : normalize(a) === normalize(b);
}

function isWithin(parent: string, child: string): boolean {
    const relative = path.relative(path.resolve(parent), path.resolve(child));
    return relative !== '' && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative);
}

async function waitForLifecycleTasks(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const running = vscode.tasks.taskExecutions.some(execution =>
            execution.task.name === START_TASK_NAME || execution.task.name === STOP_TASK_NAME
        );
        if (!running) { return true; }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    return false;
}

function registerClearCacheCommand(context: vscode.ExtensionContext): void {
    const disposable = vscode.commands.registerCommand('happy-spring-tomcat.clearCache', async () => {
        const tomcatBaseDir = getTomcatBaseDir(context);

        if (!tomcatBaseDir || !fs.existsSync(tomcatBaseDir)) {
            vscode.window.showWarningMessage(vscode.l10n.t('Tomcat base directory not found. Please run Setup first.'));
            return;
        }
        const config = projectConfig();
        if (await isPortListening(config.get<number>('httpPort', 8080)) || await isPortListening(config.get<number>('debugPort', 8000))) {
            vscode.window.showWarningMessage(vscode.l10n.t('Stop Tomcat before clearing its cache.'));
            return;
        }

        const foldersToClear = ['work', 'temp'];
        const clearedPaths: string[] = [];

        try {
            for (const folder of foldersToClear) {
                const folderPath = path.join(tomcatBaseDir, folder);
                if (fs.existsSync(folderPath)) {
                    for (const file of fs.readdirSync(folderPath)) {
                        fs.rmSync(path.join(folderPath, file), { recursive: true, force: true });
                    }
                    clearedPaths.push(folder);
                }
            }
            vscode.window.showInformationMessage(vscode.l10n.t('Successfully cleared Tomcat cache: {0}', clearedPaths.join(', ')));
        } catch (err: any) {
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to clear cache: {0}. (Is Tomcat still running?)', err.message));
        }
    });

    context.subscriptions.push(disposable);
}

function registerViewLogsCommand(context: vscode.ExtensionContext): void {
    const disposable = vscode.commands.registerCommand('happy-spring-tomcat.viewLogs', async () => {
        const tomcatBaseDir = getTomcatBaseDir(context);
        const logsDir = tomcatBaseDir ? path.join(tomcatBaseDir, 'logs') : '';

        if (!logsDir || !fs.existsSync(logsDir)) {
            vscode.window.showWarningMessage(vscode.l10n.t('Tomcat logs directory not found. Please start Tomcat first.'));
            return;
        }

        try {
            const files = fs.readdirSync(logsDir, { withFileTypes: true })
                .filter(entry => entry.isFile())
                .map(entry => entry.name);
            if (files.length === 0) {
                vscode.window.showInformationMessage(vscode.l10n.t('No log files found in the logs directory.'));
                return;
            }
            const choices = files
                .map(file => ({ file, mtime: fs.statSync(path.join(logsDir, file)).mtime }))
                .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
                .map(entry => ({ label: entry.file, description: entry.mtime.toLocaleString() }));
            const choice = await vscode.window.showQuickPick(choices, {
                placeHolder: vscode.l10n.t('Select a Tomcat log. Filter initialization errors are usually in localhost logs.')
            });
            if (!choice) { return; }
            const document = await vscode.workspace.openTextDocument(path.join(logsDir, choice.label));
            await vscode.window.showTextDocument(document, { preview: false });
        } catch (err: any) {
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to open log: {0}', err.message));
        }
    });

    context.subscriptions.push(disposable);
}
