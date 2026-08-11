import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
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
        const relative = path.relative(projectRoot, docBaseConfig);
        if (relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
            docBaseConfig = path.join('${workspaceFolder}', relative).replace(/\\/g, '/');
        }

        const config = vscode.workspace.getConfiguration('happySpringTomcat');
        if (fromSetup) { markInternalUpdate(); }
        try {
            await config.update('docBase', docBaseConfig, vscode.ConfigurationTarget.Workspace);
        } finally {
            if (fromSetup) { clearInternalUpdate(); }
        }
        vscode.window.showInformationMessage(vscode.l10n.t('docBase set to: {0}', docBaseConfig));
        return docBaseConfig;
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
        placeHolder: vscode.l10n.t('Select Webapp docBase Directory')
    });

    if (!selection) { return undefined; }
    if (selection.fsPath === 'MANUAL') { return pickFromDialog(); }
    return selection.fsPath;
}

/**
 * Candidates from findDocBaseCandidates() are already known to hold WEB-INF/lib, but the manual
 * dialog accepts any folder. Picking a non-webapp folder (a source root, the project root) is
 * silently persisted and only shows up later as "Tomcat won't start", so flag it at pick time.
 */
export type DocBaseIssue = 'no-web-inf' | 'no-lib';

export function validateDocBaseFolder(dir: string): DocBaseIssue | null {
    const webInf = path.join(dir, 'WEB-INF');
    if (!fs.existsSync(webInf) || !fs.statSync(webInf).isDirectory()) { return 'no-web-inf'; }
    if (!fs.existsSync(path.join(webInf, 'lib'))) { return 'no-lib'; }
    return null;
}

async function pickFromDialog(): Promise<string | undefined> {
    for (;;) {
        const picked = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: vscode.l10n.t('Select Webapp docBase Directory')
        });
        const dir = picked?.[0]?.fsPath;
        if (!dir) { return undefined; }

        const issue = validateDocBaseFolder(dir);
        if (!issue) { return dir; }

        const message = issue === 'no-web-inf'
            ? vscode.l10n.t('[{0}] has no WEB-INF folder, so it does not look like a webapp root. Tomcat will not be able to load the application. Pick the build output instead, e.g. ${{workspaceFolder}}/target/ROOT.', dir)
            : vscode.l10n.t('[{0}] has WEB-INF but no WEB-INF/lib, so dependency JARs would be missing from the classpath. This is usually the source webapp folder rather than the build output — run a build first, then pick the exploded folder.', dir);

        const btnSelectAgain = vscode.l10n.t('Select again');
        const btnUseAnyway = vscode.l10n.t('Use anyway');
        const answer = await vscode.window.showWarningMessage(message, btnSelectAgain, btnUseAnyway);
        if (answer === btnUseAnyway) { return dir; }
        if (answer !== btnSelectAgain) { return undefined; }
    }
}
