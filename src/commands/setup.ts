import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { validateTomcatHome, getTomcatBaseDir } from '../lib/tomcatValidator';
import { findBuiltWebAppDirectories, getBuiltWebAppDirectoryIssue } from '../lib/webAppFinder';
import { ConfigWriterOptions } from '../lib/types';
import { setupTomcatBaseDir, writeServerXml } from '../lib/writers/serverXml';
import { writeContextXml, validateContextOptions } from '../lib/writers/contextXml';
import { writeScripts } from '../lib/writers/scripts';
import { writeTasksJson, writeLaunchJson, validateVscodeConfig, validateTaskOptions, PreLaunchBuild } from '../lib/writers/vscodeConfig';
import { isTomcatRunning, isPortListening } from '../lib/portChecker';
import { markInternalUpdate, clearInternalUpdate } from '../lib/state';
import { resolveDebugConfigName } from '../lib/debugResolver';
import { restoreLegacyClassesBackup } from '../lib/legacyClassesBackup';
import { resolveProjectPath, validatePorts, readProjectPaths } from '../lib/configuration';

export function registerSetupCommand(context: vscode.ExtensionContext): void {
    const disposable = vscode.commands.registerCommand('happy-spring-tomcat.setup', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage(vscode.l10n.t('No workspace folder open. Please open a project first.'));
            return;
        }

        const projectRoot = workspaceFolders[0].uri.fsPath;
        const vscodeDir = path.join(projectRoot, '.vscode');

        if (!fs.existsSync(vscodeDir)) {
            fs.mkdirSync(vscodeDir, { recursive: true });
        }

        // --- Read configuration ---
        const config = vscode.workspace.getConfiguration('happySpringTomcat', workspaceFolders[0].uri);
        let tomcatHome = config.get<string>('tomcatHome', '');
        const httpPort = config.get<number>('httpPort', 8080);
        const debugPort = config.get<number>('debugPort', 8000);
        const contextPath = config.get<string>('contextPath', '');
        const { builtWebAppDirectory, webSourceDirectory, classesDirectory, resourcesDirectory } = readProjectPaths(config);
        const javaOpts = config.get<string>('javaOpts', '-Dfile.encoding=UTF-8 -Dsun.stdout.encoding=UTF-8 -Dsun.stderr.encoding=UTF-8');
        const jndiResources = config.get<any[]>('jndiResources', []);
        const colorizeLogs = config.get<boolean>('colorizeLogs', true);
        const preLaunchBuild = config.get<PreLaunchBuild>('preLaunchBuild', 'none');
        const customBuildTask = config.get<string>('customBuildTask', '');
        try {
            validatePorts(httpPort, debugPort);
            validateVscodeConfig(vscodeDir);
            validateTaskOptions(vscodeDir, { classesDirectory, resourcesDirectory, builtWebAppDirectory, preLaunchBuild, customBuildTask });
        } catch (error) {
            vscode.window.showErrorMessage(vscode.l10n.t('Tomcat setup failed: {0}', (error as Error).message));
            return;
        }

        // --- Ensure tomcatHome is set ---
        if (!tomcatHome) {
            const selectedHome = await vscode.commands.executeCommand<string>('happy-spring-tomcat.selectTomcatHome');
            if (selectedHome) {
                tomcatHome = selectedHome;
            } else {
                return;
            }
        }

        // --- Ensure storageUri is available ---
        const tomcatBaseDir = getTomcatBaseDir(context);
        if (!tomcatBaseDir) {
            vscode.window.showErrorMessage(vscode.l10n.t('Extension storage is not available. Please open a workspace folder.'));
            return;
        }

        // --- Resolve builtWebAppDirectory ---
        let resolvedBuiltWebAppDirectory: string;
        let resolvedWebSourceDirectory: string;
        let resolvedClassesDirectory: string;
        let resolvedResourcesDirectory: string;
        try {
            tomcatHome = resolveProjectPath(tomcatHome, projectRoot);
            resolvedBuiltWebAppDirectory = resolveProjectPath(builtWebAppDirectory, projectRoot);
            resolvedWebSourceDirectory = resolveProjectPath(webSourceDirectory, projectRoot);
            resolvedClassesDirectory = resolveProjectPath(classesDirectory, projectRoot);
            resolvedResourcesDirectory = resolveProjectPath(resourcesDirectory, projectRoot);
        } catch (error) {
            vscode.window.showErrorMessage(vscode.l10n.t('Tomcat setup failed: {0}', (error as Error).message));
            return;
        }
        if (!resolvedBuiltWebAppDirectory || await getBuiltWebAppDirectoryIssue(resolvedBuiltWebAppDirectory)) {
            const resolved = await resolveBuiltWebAppDirectory(projectRoot, builtWebAppDirectory);
            if (resolved === null) { return; }
            resolvedBuiltWebAppDirectory = resolved;
        }

        // --- Validate Tomcat Home ---
        const validation = validateTomcatHome(tomcatHome);
        if (!validation.valid) {
            vscode.window.showErrorMessage(vscode.l10n.t('Invalid Tomcat Home: {0}', validation.reason ?? ''));
            return;
        }

        const opts: ConfigWriterOptions = {
            tomcatHome, tomcatBaseDir, projectRoot, vscodeDir,
            httpPort, debugPort, contextPath,
            resolvedBuiltWebAppDirectory, resolvedWebSourceDirectory, resolvedClassesDirectory, resolvedResourcesDirectory,
            jndiResources, javaOpts, colorizeLogs
        };

        // --- Execute with progress indicator ---
        const applied = await Promise.resolve(vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('Applying Tomcat Debug Setup...'), cancellable: false },
            async (progress): Promise<boolean> => {
                validateContextOptions(opts);
                validateVscodeConfig(vscodeDir);
                progress.report({ message: vscode.l10n.t('Checking Tomcat status...') });
                const httpRunning = await isTomcatRunning(httpPort);
                const running = httpRunning || await isPortListening(debugPort);
                if (running) {
                    const btnContinue = vscode.l10n.t('Continue');
                    const answer = await vscode.window.showWarningMessage(
                        vscode.l10n.t('Tomcat appears to be running on port {0}. Overwriting conf while running may cause issues. Continue?', httpRunning ? httpPort : debugPort),
                        btnContinue, vscode.l10n.t('Cancel')
                    );
                    if (answer !== btnContinue) { return false; }
                }
                if (!running) { restoreLegacyClassesBackup(projectRoot, resolvedBuiltWebAppDirectory); }

                progress.report({ message: vscode.l10n.t('Setting up Tomcat base directory...') });
                setupTomcatBaseDir(tomcatHome, tomcatBaseDir);

                progress.report({ message: vscode.l10n.t('Writing server.xml...') });
                writeServerXml(tomcatBaseDir, httpPort);

                progress.report({ message: vscode.l10n.t('Writing context.xml...') });
                writeContextXml(opts);

                progress.report({ message: vscode.l10n.t('Writing start/stop scripts...') });
                writeScripts(opts);

                progress.report({ message: vscode.l10n.t('Writing tasks.json...') });
                writeTasksJson(vscodeDir, { classesDirectory: resolvedClassesDirectory, resourcesDirectory: resolvedResourcesDirectory,
                    builtWebAppDirectory: resolvedBuiltWebAppDirectory, preLaunchBuild, customBuildTask });

                progress.report({ message: vscode.l10n.t('Writing launch.json...') });
                writeLaunchJson(vscodeDir, debugPort);

                return true;
            }
        )).catch((error: Error) => {
            vscode.window.showErrorMessage(vscode.l10n.t('Tomcat setup failed: {0}', error.message));
            return false;
        });

        if (!applied) { return; }

        // Success notification with "Start Tomcat" action button
        const btnStartTomcat = vscode.l10n.t('Start Tomcat');
        const action = await vscode.window.showInformationMessage(
            vscode.l10n.t('Tomcat Debug Setup has been successfully applied!'),
            btnStartTomcat
        );
        if (action === btnStartTomcat) {
            const configName = resolveDebugConfigName(workspaceFolders[0]);
            if (configName) {
                vscode.debug.startDebugging(workspaceFolders[0], configName);
            } else {
                vscode.window.showErrorMessage(vscode.l10n.t('Tomcat debug configuration not found.'));
            }
        }
    });

    context.subscriptions.push(disposable);
}

async function resolveBuiltWebAppDirectory(projectRoot: string, builtWebAppDirectory: string): Promise<string | null> {
    const candidates = await findBuiltWebAppDirectories(projectRoot);

    if (candidates.length === 1) {
        const detectedPath = candidates[0].replace(projectRoot, '${workspaceFolder}').replace(/\\/g, '/');
        markInternalUpdate();
        try {
            await vscode.workspace.getConfiguration('happySpringTomcat', vscode.workspace.workspaceFolders?.[0]?.uri).update('builtWebAppDirectory', detectedPath, vscode.ConfigurationTarget.WorkspaceFolder);
        } finally {
            clearInternalUpdate();
        }
        vscode.window.showInformationMessage(vscode.l10n.t('Built web application detected: {0}', detectedPath));
        return candidates[0];
    }

    const prompt = candidates.length > 1
        ? vscode.l10n.t('Multiple built web applications found. Please select one.')
        : builtWebAppDirectory
            ? vscode.l10n.t('Built web application directory [{0}] is unavailable or missing WEB-INF/lib. Please select one.', builtWebAppDirectory)
            : vscode.l10n.t('No built web application directory found. Run your project\'s web application build, then select its output directory.');

    const selectDirectory = vscode.l10n.t('Select Built Web App Directory');
    const pick = await vscode.window.showInformationMessage(prompt, selectDirectory, vscode.l10n.t('Cancel'));
    if (pick !== selectDirectory) { return null; }

    const selectedPath = await vscode.commands.executeCommand<string>('happy-spring-tomcat.selectBuiltWebAppDirectory', true);
    if (!selectedPath) { return null; }

    return selectedPath.replace(/\$\{workspaceFolder\}/g, projectRoot);
}
