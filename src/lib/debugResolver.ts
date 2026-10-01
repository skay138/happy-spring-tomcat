import * as vscode from 'vscode';
import { projectConfig } from './workspaceConfig';
import { TOMCAT_DEBUG_CONFIG_NAME, START_TASK_NAME } from './constants';

export function isTomcatDebugSession(session: vscode.DebugSession, debugPort: number): boolean {
    const isExactMatch = session.name === TOMCAT_DEBUG_CONFIG_NAME;
    const isJavaAttachForOurPort = session.type === 'java' &&
        session.configuration.request === 'attach' &&
        String(session.configuration.port) === String(debugPort) &&
        session.configuration.preLaunchTask === START_TASK_NAME;

    return (isExactMatch && session.type === 'java' && session.configuration.request === 'attach') || isJavaAttachForOurPort;
}

export function resolveDebugConfigName(folder: vscode.WorkspaceFolder): string | undefined {
    const launchConfig = vscode.workspace.getConfiguration('launch', folder.uri);
    const configurations = launchConfig.get<any[]>('configurations', []);

    // 1. Exact match
    const exactMatch = configurations.find(c => c.name === TOMCAT_DEBUG_CONFIG_NAME);
    if (exactMatch) { return exactMatch.name; }

    // 2. Fuzzy match
    const happyConfig = projectConfig();
    const debugPort = happyConfig.get<number>('debugPort', 8000);

    const fuzzyMatch = configurations.find(c => 
        c.type === 'java' && 
        c.request === 'attach' && 
        String(c.port) === String(debugPort) &&
        c.preLaunchTask === START_TASK_NAME
    );

    return fuzzyMatch ? fuzzyMatch.name : undefined;
}
