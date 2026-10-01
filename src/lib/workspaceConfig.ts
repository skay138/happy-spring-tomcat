import * as vscode from 'vscode';

/** All commands operate on the same project folder and its folder-level settings. */
export function projectConfig(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration('happySpringTomcat', vscode.workspace.workspaceFolders?.[0]?.uri);
}
