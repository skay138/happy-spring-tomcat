import * as path from 'path';

export function readProjectPaths(config: Pick<import('vscode').WorkspaceConfiguration, 'get'>) {
    return {
        builtWebAppDirectory: config.get<string>('builtWebAppDirectory', ''),
        webSourceDirectory: config.get<string>('webSourceDirectory', '${workspaceFolder}/src/main/webapp'),
        classesDirectory: config.get<string>('classesDirectory', '${workspaceFolder}/target/classes'),
        resourcesDirectory: config.get<string>('resourcesDirectory', '')
    };
}

export function resolveProjectPath(value: string, projectRoot: string): string {
    if (!value) { return ''; }
    const expanded = value.replace(/\$\{workspaceFolder\}/g, projectRoot);
    if (/\$\{/.test(expanded)) { throw new Error(`Unsupported path variable: ${value}. Use an absolute path or \${workspaceFolder}.`); }
    return path.resolve(projectRoot, expanded);
}

export function validatePorts(httpPort: number, debugPort: number): void {
    for (const [name, port] of [['httpPort', httpPort], ['debugPort', debugPort]] as const) {
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
            throw new Error(`${name} must be an integer between 1 and 65535.`);
        }
    }
    if (httpPort === debugPort) { throw new Error('httpPort and debugPort must be different.'); }
}
