import * as vscode from 'vscode';
import { projectConfig } from '../lib/workspaceConfig';
import * as path from 'path';
import { findBuiltWebAppDirectories, getBuiltWebAppDirectoryIssue } from '../lib/webAppFinder';
import { markInternalUpdate, clearInternalUpdate } from '../lib/state';

export function registerSelectBuiltWebAppDirectoryCommand(context: vscode.ExtensionContext): void {
    const disposable = vscode.commands.registerCommand('happy-spring-tomcat.selectBuiltWebAppDirectory', async (fromSetup?: boolean) => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) { return undefined; }

        const projectRoot = workspaceFolders[0].uri.fsPath;
        const candidates = await findBuiltWebAppDirectories(projectRoot);
        let selectedDirectory: string | undefined;

        if (candidates.length > 0) {
            selectedDirectory = await pickFromCandidates(projectRoot, candidates);
        } else {
            selectedDirectory = await pickFromDialog();
        }

        if (!selectedDirectory) { return undefined; }

        let configuredPath = selectedDirectory;
        const relative = path.relative(projectRoot, configuredPath);
        if (relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
            configuredPath = path.join('${workspaceFolder}', relative).replace(/\\/g, '/');
        }

        const config = projectConfig();
        if (fromSetup) { markInternalUpdate(); }
        try {
            await config.update('builtWebAppDirectory', configuredPath, vscode.ConfigurationTarget.WorkspaceFolder);
        } finally {
            if (fromSetup) { clearInternalUpdate(); }
        }
        vscode.window.showInformationMessage(vscode.l10n.t('Built web application directory set to: {0}', configuredPath));
        return configuredPath;
    });

    context.subscriptions.push(disposable);
}

async function pickFromCandidates(projectRoot: string, candidates: string[]): Promise<string | undefined> {
    const items = [
        ...candidates.map(c => ({
            label: `$(folder) ${path.relative(projectRoot, c)}`,
            description: vscode.l10n.t('Detected webapp directory'),
            fsPath: c
        })),
        { label: `$(folder-opened) ${vscode.l10n.t('Select manually...')}`, description: vscode.l10n.t('Browse for a different folder'), fsPath: 'MANUAL' }
    ];

    const selection = await vscode.window.showQuickPick(items, {
        placeHolder: vscode.l10n.t('Select Built Web App Directory')
    });

    if (!selection) { return undefined; }
    if (selection.fsPath === 'MANUAL') { return pickFromDialog(); }
    return selection.fsPath;
}

async function pickFromDialog(): Promise<string | undefined> {
    for (;;) {
        const picked = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: vscode.l10n.t('Select Built Web App Directory')
        });
        const dir = picked?.[0]?.fsPath;
        if (!dir) { return undefined; }

        const issue = await getBuiltWebAppDirectoryIssue(dir);
        if (!issue) { return dir; }

        const message = issue === 'no-web-inf'
            ? vscode.l10n.t('[{0}] has no readable WEB-INF directory. Select a built web application, e.g. ${{workspaceFolder}}/target/exploded.', dir)
            : vscode.l10n.t('[{0}] has no readable WEB-INF/lib directory. Run your project\'s web application build, then select its output directory.', dir);

        const btnSelectAgain = vscode.l10n.t('Select again');
        const answer = await vscode.window.showWarningMessage(message, btnSelectAgain, vscode.l10n.t('Cancel'));
        if (answer !== btnSelectAgain) { return undefined; }
    }
}
