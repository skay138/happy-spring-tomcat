import * as fs from 'fs';
import * as path from 'path';

/** One-time migration only. The caller must ensure Tomcat is stopped. */
export function restoreLegacyClassesBackup(projectRoot: string, docBase: string): void {
    // Until a built application is selected, leave the backup in place.
    if (!docBase) { return; }
    const destination = path.resolve(docBase, 'WEB-INF', 'classes');
    if (fs.existsSync(destination)) { return; } // Never discard or overwrite a newer build.
    const backups = findLegacyClassesBackups(projectRoot, docBase);
    if (backups.length > 1) {
        throw new Error('Multiple legacy classes backups were found. Restore the matching backup to the built application\'s WEB-INF/classes before running Setup.');
    }
    if (!backups.length) { return; }
    for (const candidate of [backups[0], destination]) {
        let ancestor = candidate;
        while (path.dirname(ancestor) !== ancestor) {
            if (fs.existsSync(ancestor) && fs.lstatSync(ancestor).isSymbolicLink()) {
                throw new Error(`Cannot restore a legacy classes backup through a symbolic link: ${ancestor}`);
            }
            ancestor = path.dirname(ancestor);
        }
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.renameSync(backups[0], destination);
}

export function findLegacyClassesBackups(projectRoot: string, docBase: string): string[] {
    const buildNames = ['target', 'build', 'out'];
    const roots = buildNames.map(name => path.join(projectRoot, name));
    const docParent = docBase ? path.dirname(path.resolve(docBase)) : '';
    if (buildNames.includes(path.basename(docParent).toLowerCase())) { roots.unshift(docParent); }
    const uniqueRoots = new Map(roots.map(root => {
        const resolved = path.resolve(root);
        return [process.platform === 'win32' ? resolved.toLowerCase() : resolved, resolved];
    }));
    return [...uniqueRoots.values()]
        .map(root => path.join(root, '.happy-spring-tomcat', 'classes-backup'))
        .filter(backup => fs.existsSync(backup));
}
