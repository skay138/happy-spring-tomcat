import * as fs from 'fs';
import * as path from 'path';

export type BuiltWebAppDirectoryIssue = 'no-web-inf' | 'no-lib';

/** The picker and automatic detection use the same directory checks. */
export async function getBuiltWebAppDirectoryIssue(directory: string): Promise<BuiltWebAppDirectoryIssue | null> {
    const isDirectory = async (value: string) => {
        try { return (await fs.promises.stat(value)).isDirectory(); }
        catch { return false; }
    };
    const webInf = path.join(directory, 'WEB-INF');
    if (!directory || !await isDirectory(webInf)) { return 'no-web-inf'; }
    if (!await isDirectory(path.join(webInf, 'lib'))) { return 'no-lib'; }
    return null;
}

/** Search build outputs without blocking the extension host or following directory links. */
export async function findBuiltWebAppDirectories(projectRoot: string): Promise<string[]> {
    const candidates: string[] = [];
    const excluded = new Set(['node_modules', 'classes', 'test-classes']);
    for (const name of ['target', 'build', 'out', 'bin']) {
        const root = path.join(projectRoot, name);
        try {
            const entry = await fs.promises.lstat(root);
            if (!entry.isDirectory() || entry.isSymbolicLink()) { continue; }
        } catch { continue; }

        const pending = [root];
        while (pending.length) {
            const directory = pending.pop()!;
            let entries: fs.Dirent[];
            try { entries = await fs.promises.readdir(directory, { withFileTypes: true }); }
            catch { continue; } // A missing/unreadable branch must not hide its siblings.

            if (await getBuiltWebAppDirectoryIssue(directory) === null) {
                candidates.push(directory);
                continue; // Do not search inside an already identified application.
            }
            for (const entry of entries) {
                if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith('.') ||
                    excluded.has(entry.name.toLowerCase())) { continue; }
                pending.push(path.join(directory, entry.name));
            }
        }
    }
    return candidates.sort();
}
