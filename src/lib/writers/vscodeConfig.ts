import * as fs from 'fs';
import * as path from 'path';
import { applyEdits, modify, parse, ParseError, printParseErrorCode } from 'jsonc-parser';
import { TOMCAT_DEBUG_CONFIG_NAME, START_TASK_NAME, STOP_TASK_NAME, MAVEN_TASK_NAME, GRADLE_TASK_NAME } from '../constants';
import { gradlePreparationScript } from '../gradlePreparation';

export function validateVscodeConfig(vscodeDir: string): void {
    for (const [filename, key] of [['tasks.json', 'tasks'], ['launch.json', 'configurations']]) {
        const file = path.join(vscodeDir, filename);
        if (!fs.existsSync(file)) { continue; }
        const value = parseJsonc(fs.readFileSync(file, 'utf8'), file);
        if (value[key] !== undefined && !Array.isArray(value[key])) {
            throw new Error(`${filename}: ${key} must be an array.`);
        }
    }
}

export type PreLaunchBuild = 'none' | 'maven' | 'gradle' | 'custom';

export interface TaskWriterOptions {
    classesDirectory: string;
    resourcesDirectory?: string;
    builtWebAppDirectory: string;
    preLaunchBuild: PreLaunchBuild;
    customBuildTask?: string;
}

const ownedTasks = [START_TASK_NAME, STOP_TASK_NAME, MAVEN_TASK_NAME, GRADLE_TASK_NAME,
    'Prepare Happy Tomcat', 'Validate Happy Tomcat', 'Happy Spring Tomcat: Maven Resources', 'Happy Spring Tomcat: Maven Compile'];

export function validateTaskOptions(vscodeDir: string, options: TaskWriterOptions): void {
    const root = path.dirname(vscodeDir);
    if (!['none', 'maven', 'gradle', 'custom'].includes(options.preLaunchBuild)) {
        throw new Error('Pre Launch Build must be none, maven, gradle, or custom.');
    }
    if (options.preLaunchBuild === 'maven' && !fs.existsSync(path.join(root, 'pom.xml'))) {
        throw new Error('Maven preparation requires pom.xml in the workspace folder. Open the web application module or select custom.');
    }
    if (options.preLaunchBuild === 'gradle' && !['build.gradle', 'build.gradle.kts'].some(file => fs.existsSync(path.join(root, file)))) {
        throw new Error('Gradle preparation requires build.gradle or build.gradle.kts in the workspace folder.');
    }
    if (options.resourcesDirectory && !options.classesDirectory) {
        throw new Error('Resources Directory requires Classes Directory.');
    }
    if (options.preLaunchBuild !== 'custom') { return; }
    const label = options.customBuildTask?.trim();
    if (!label || ownedTasks.includes(label)) {
        throw new Error('Custom Build Task must name an existing VS Code task, not a Tomcat lifecycle task.');
    }
    const file = path.join(vscodeDir, 'tasks.json');
    const tasks = fs.existsSync(file) ? parseJsonc(fs.readFileSync(file, 'utf8'), file).tasks || [] : [];
    const visit = (name: string, visiting = new Set<string>()): void => {
        if (ownedTasks.includes(name) || visiting.has(name)) {
            throw new Error('Custom Build Task has a dependency cycle with the Tomcat lifecycle.');
        }
        const task = tasks.find((entry: any) => entry.label === name);
        if (!task) { return; }
        if (task.isBackground) { throw new Error('Custom Build Task must finish before Tomcat starts; background tasks are not supported.'); }
        const next = new Set(visiting).add(name);
        for (const dependency of Array.isArray(task.dependsOn) ? task.dependsOn : [task.dependsOn]) {
            if (typeof dependency === 'string') { visit(dependency, next); }
        }
    };
    visit(label);
}

export function writeTasksJson(vscodeDir: string, options: TaskWriterOptions): void {
    validateTaskOptions(vscodeDir, options);
    const root = path.dirname(vscodeDir);
    const file = path.join(vscodeDir, 'tasks.json');
    const original = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '{"version":"2.0.0","tasks":[]}';
    const json = parseJsonc(original, file);
    const tasks = (json.tasks || []).filter((task: any) => !ownedTasks.includes(task.label));
    const windows = process.platform === 'win32';
    const shell = windows ? { executable: 'cmd.exe', args: ['/d', '/c'] } : { executable: '/bin/bash', args: ['-c'] };
    const lifecycle = (name: string) => windows
        ? '${workspaceFolder}\\.vscode\\happy-spring-tomcat\\' + name + '.bat'
        : '${workspaceFolder}/.vscode/happy-spring-tomcat/' + name + '.sh';
    tasks.push({
        label: STOP_TASK_NAME, type: 'shell', command: lifecycle('stop-tomcat'), options: { shell },
        presentation: { reveal: 'silent', panel: 'shared', close: true, showReuseMessage: false }
    });
    const dependencies = [STOP_TASK_NAME];
    if (options.preLaunchBuild === 'custom') {
        dependencies.push(options.customBuildTask!.trim());
    } else if (options.preLaunchBuild !== 'none') {
        const maven = options.preLaunchBuild === 'maven';
        const wrapper = maven ? (windows ? 'mvnw.cmd' : 'mvnw') : (windows ? 'gradlew.bat' : 'gradlew');
        const command = fs.existsSync(path.join(root, wrapper))
            ? (windows ? '.\\' : './') + wrapper : (maven ? 'mvn' : 'gradle');
        let args: string[];
        if (maven) {
            args = [options.classesDirectory ? 'compile' : 'package', '-DskipTests'];
        } else if (options.classesDirectory) {
            args = ['classes'];
        } else {
            const init = path.join(vscodeDir, 'happy-spring-tomcat/gradle.init.gradle');
            fs.mkdirSync(path.dirname(init), { recursive: true });
            fs.writeFileSync(init, gradlePreparationScript, 'utf8');
            args = [
                '--no-configuration-cache', '--init-script', init, 'happyTomcatPrepare',
                '-PhappyTomcatWebApp=' + options.builtWebAppDirectory
            ];
        }
        const label = maven ? MAVEN_TASK_NAME : GRADLE_TASK_NAME;
        tasks.push({
            label, type: 'shell', command, args, options: { cwd: '${workspaceFolder}', shell },
            problemMatcher: [], presentation: { reveal: 'always', panel: 'shared' }
        });
        dependencies.push(label);
    }
    tasks.push({
        label: START_TASK_NAME, type: 'shell', command: lifecycle('start-tomcat'), options: { shell },
        dependsOn: dependencies, dependsOrder: 'sequence', isBackground: true,
        problemMatcher: {
            pattern: { regexp: '^$' },
            background: { activeOnStart: true, beginsPattern: 'Starting Tomcat', endsPattern: 'Listening for transport dt_socket at address:' }
        },
        presentation: { reveal: 'always', panel: 'dedicated', group: 'tomcat', showReuseMessage: false }
    });
    fs.writeFileSync(file, updateJsoncProperty(original, 'tasks', tasks), 'utf8');
}

export function writeLaunchJson(vscodeDir: string, debugPort: number): void {
    const launchJsonPath = path.join(vscodeDir, 'launch.json');
    let launchJson: any = { version: '0.2.0', configurations: [] };
    let original = JSON.stringify(launchJson, null, 4);

    if (fs.existsSync(launchJsonPath)) {
        original = fs.readFileSync(launchJsonPath, 'utf8');
        launchJson = parseJsonc(original, launchJsonPath);
    }

    if (!launchJson.configurations) { launchJson.configurations = []; }

    const launchName = TOMCAT_DEBUG_CONFIG_NAME;
    const launchConfigDef: any = {
        type: 'java',
        name: launchName,
        request: 'attach',
        hostName: 'localhost',
        port: debugPort,
        preLaunchTask: START_TASK_NAME,
        postDebugTask: STOP_TASK_NAME,
        internalConsoleOptions: 'neverOpen'
    };

    // Note: serverReadyAction is intentionally omitted — it is not supported for
    // request: "attach" configurations. Browser auto-open is handled by the
    // extension itself via vscode.debug.onDidStartDebugSession + port polling.

    const idx = launchJson.configurations.findIndex((c: any) => c.name === launchName);
    if (idx >= 0) {
        launchJson.configurations[idx] = { ...launchJson.configurations[idx], ...launchConfigDef };
    } else {
        launchJson.configurations.push(launchConfigDef);
    }

    fs.writeFileSync(launchJsonPath, updateJsoncProperty(original, 'configurations', launchJson.configurations), 'utf8');
}

/** Removes only entries owned by this extension while preserving JSONC comments and user entries. */
export function removeGeneratedVscodeEntries(vscodeDir: string): void {
    const tasksJsonPath = path.join(vscodeDir, 'tasks.json');
    if (fs.existsSync(tasksJsonPath)) {
        const original = fs.readFileSync(tasksJsonPath, 'utf8');
        const tasksJson = parseJsonc(original, tasksJsonPath);
        if (Array.isArray(tasksJson.tasks)) {
            const tasks = tasksJson.tasks.filter((task: any) =>
                !ownedTasks.includes(task?.label) &&
                task?.label !== 'Happy Spring Tomcat: Maven Resources' &&
                task?.label !== 'Happy Spring Tomcat: Maven Compile'
            );
            fs.writeFileSync(tasksJsonPath, updateJsoncProperty(original, 'tasks', tasks), 'utf8');
        }
    }

    const launchJsonPath = path.join(vscodeDir, 'launch.json');
    if (fs.existsSync(launchJsonPath)) {
        const original = fs.readFileSync(launchJsonPath, 'utf8');
        const launchJson = parseJsonc(original, launchJsonPath);
        if (Array.isArray(launchJson.configurations)) {
            const configurations = launchJson.configurations.filter(
                (configuration: any) => configuration?.name !== TOMCAT_DEBUG_CONFIG_NAME
            );
            fs.writeFileSync(launchJsonPath, updateJsoncProperty(original, 'configurations', configurations), 'utf8');
        }
    }
}

function parseJsonc(content: string, filePath: string): any {
    const errors: ParseError[] = [];
    const value = parse(content, errors, { allowTrailingComma: true, disallowComments: false });
    if (errors.length > 0 || !value || typeof value !== 'object' || Array.isArray(value)) {
        const detail = errors.map(e => `${printParseErrorCode(e.error)} at offset ${e.offset}`).join(', ');
        throw new Error(`Cannot update invalid JSONC file [${filePath}]: ${detail || 'root is not an object'}`);
    }
    return value;
}

function updateJsoncProperty(content: string, property: string, value: unknown): string {
    const edits = modify(content, [property], value, {
        formattingOptions: { insertSpaces: true, tabSize: 4, eol: content.includes('\r\n') ? '\r\n' : '\n' }
    });
    return applyEdits(content, edits);
}
