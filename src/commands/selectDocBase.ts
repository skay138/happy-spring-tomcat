import * as vscode from 'vscode';
import { findDocBaseCandidates } from '../lib/docBaseFinder';
import { markInternalUpdate, clearInternalUpdate } from '../lib/state';

export function registerSelectDocBaseCommand(context: vscode.ExtensionContext): void {
    const disposable = vscode.commands.registerCommand('happy-spring-tomcat.selectDocBase', async (fromSetup?: boolean) => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) { return undefined; }

        const projectRoot = workspaceFolders[0].uri.fsPath;
        const candidates = findDocBaseCandidates(projectRoot);
        let selectedDocBase: string | undefined;

        if (candidates.length > 0) {
            selectedDocBase = await pickFromCandidates(projectRoot, candidates);
        } else {
            selectedDocBase = await pickFromDialog();
        }

        if (!selectedDocBase) { return undefined; }

        let docBaseConfig = selectedDocBase;
        if (docBaseConfig.startsWith(projectRoot)) {
            docBaseConfig = docBaseConfig.replace(projectRoot, '${workspaceFolder}').replace(/\\/g, '/');
        }

        const config = vscode.workspace.getConfiguration('happySpringTomcat');
        if (fromSetup) {
            markInternalUpdate();
        }
        await config.update('docBase', docBaseConfig, vscode.ConfigurationTarget.Workspace);
        if (fromSetup) {
            clearInternalUpdate();
        }
        vscode.window.showInformationMessage(vscode.l10n.t('docBase set to: {0}', docBaseConfig));
        return docBaseConfig;
    });

    context.subscriptions.push(disposable);
}

async function pickFromCandidates(projectRoot: string, candidates: string[]): Promise<string | undefined> {
    const items = [
        ...candidates.map(c => ({
            label: `$(folder) ${c.replace(projectRoot, '').replace(/^[/\\]/, '')}`,
            description: vscode.l10n.t('Detected webapp directory'),
            fsPath: c
        })),
        { label: `$(folder-opened) ${vscode.l10n.t('Select manually...')}`, description: vscode.l10n.t('Browse for a different folder'), fsPath: 'MANUAL' }
    ];

    const selection = await vscode.window.showQuickPick(items, {
        placeHolder: vscode.l10n.t('Select Webapp docBase Directory')
    });

    if (!selection) { return undefined; }
    if (selection.fsPath === 'MANUAL') { return pickFromDialog(); }
    return selection.fsPath;
}

async function pickFromDialog(): Promise<string | undefined> {
    const picked = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: vscode.l10n.t('Select Webapp docBase Directory')
    });
    return picked?.[0]?.fsPath;
}
