import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getTomcatBaseDir } from '../lib/tomcatValidator';

export function registerMaintenanceCommands(context: vscode.ExtensionContext): void {
    registerClearCacheCommand(context);
    registerViewLogsCommand(context);
}

function registerClearCacheCommand(context: vscode.ExtensionContext): void {
    const disposable = vscode.commands.registerCommand('happy-spring-tomcat.clearCache', async () => {
        const tomcatBaseDir = getTomcatBaseDir(context);

        if (!tomcatBaseDir || !fs.existsSync(tomcatBaseDir)) {
            vscode.window.showWarningMessage(vscode.l10n.t('Tomcat base directory not found. Please run Setup first.'));
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

        const files = fs.readdirSync(logsDir);
        if (files.length === 0) {
            vscode.window.showInformationMessage(vscode.l10n.t('No log files found in the logs directory.'));
            return;
        }

        const latestFile = files
            .map(file => ({ file, mtime: fs.statSync(path.join(logsDir, file)).mtime }))
            .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())[0].file;

        const document = await vscode.workspace.openTextDocument(path.join(logsDir, latestFile));
        await vscode.window.showTextDocument(document, { preview: false });
    });

    context.subscriptions.push(disposable);
}
