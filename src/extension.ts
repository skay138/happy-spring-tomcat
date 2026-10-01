import * as vscode from 'vscode';
import { registerSetupCommand } from './commands/setup';
import { registerSelectTomcatHomeCommand } from './commands/selectTomcatHome';
import { registerSelectBuiltWebAppDirectoryCommand } from './commands/selectBuiltWebAppDirectory';
import { registerMaintenanceCommands } from './commands/maintenance';
import { registerStatusBar, registerAutoOpenBrowser } from './commands/statusBar';

export function activate(context: vscode.ExtensionContext) {
    registerSetupCommand(context);
    registerSelectTomcatHomeCommand(context);
    registerSelectBuiltWebAppDirectoryCommand(context);
    registerMaintenanceCommands(context);
    registerStatusBar(context);
    registerAutoOpenBrowser(context);
}


export function deactivate() {}
