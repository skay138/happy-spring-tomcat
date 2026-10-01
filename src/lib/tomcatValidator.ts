import * as fs from 'fs';
import * as path from 'path';

/**
 * Validates that the given directory is a valid Tomcat installation.
 */
export function validateTomcatHome(tomcatHome: string): { valid: boolean; reason?: string } {
    if (!tomcatHome) {
        return { valid: false, reason: 'Tomcat Home path is empty.' };
    }
    const launcher = process.platform === 'win32' ? 'bin/catalina.bat' : 'bin/catalina.sh';
    for (const relative of [launcher, 'bin/bootstrap.jar', 'bin/tomcat-juli.jar', 'conf/server.xml', 'lib/catalina.jar']) {
        try {
            if (fs.statSync(path.join(tomcatHome, relative)).isFile()) { continue; }
        } catch { /* Report missing, unreadable, and wrong-type paths consistently. */ }
        return { valid: false, reason: `Missing or unreadable Tomcat file: ${relative}` };
    }

    return { valid: true };
}

/**
 * Gets the workspace-specific Tomcat runtime base directory from extension storage.
 */
export function getTomcatBaseDir(context: import('vscode').ExtensionContext): string | undefined {
    if (context.storageUri) {
        return path.join(context.storageUri.fsPath, 'tomcat-base');
    }
    return undefined;
}
