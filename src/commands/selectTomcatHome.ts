import * as vscode from 'vscode';
import { validateTomcatHome } from '../lib/tomcatValidator';
import { markInternalUpdate } from '../lib/state';

export function registerSelectTomcatHomeCommand(context: vscode.ExtensionContext): void {
    const disposable = vscode.commands.registerCommand('happy-spring-tomcat.selectTomcatHome', async () => {
        const selectedFolder = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: vscode.l10n.t('Select Tomcat Home Directory')
        });

        if (!selectedFolder || !selectedFolder[0]) { return undefined; }

        const tomcatHome = selectedFolder[0].fsPath;

        const validation = validateTomcatHome(tomcatHome);
        if (!validation.valid) {
            vscode.window.showErrorMessage(vscode.l10n.t('Selected path is not a valid Tomcat Home: {0}', validation.reason ?? ''));
            return undefined;
        }

        markInternalUpdate();  // [Item 9]
        const config = vscode.workspace.getConfiguration('happySpringTomcat');
        await config.update('tomcatHome', tomcatHome, vscode.ConfigurationTarget.Workspace);
        vscode.window.showInformationMessage(vscode.l10n.t('Tomcat Home set to: {0}', tomcatHome));
        return tomcatHome;
    });

    context.subscriptions.push(disposable);
}
