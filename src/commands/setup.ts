import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { validateTomcatHome, getTomcatBaseDir } from '../lib/tomcatValidator';
import { findDocBaseCandidates } from '../lib/docBaseFinder';
import { ConfigWriterOptions } from '../lib/types';
import { setupTomcatBaseDir, writeServerXml } from '../lib/writers/serverXml';
import { writeContextXml } from '../lib/writers/contextXml';
import { writeScripts } from '../lib/writers/scripts';
import { writeTasksJson, writeLaunchJson } from '../lib/writers/vscodeConfig';
import { isTomcatRunning } from '../lib/portChecker';
import { markInternalUpdate, clearInternalUpdate } from '../lib/state';
import { resolveDebugConfigName } from '../lib/debugResolver';

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
        const config = vscode.workspace.getConfiguration('happySpringTomcat');
        let tomcatHome = config.get<string>('tomcatHome', '');
        const httpPort = config.get<number>('httpPort', 8080);
        const debugPort = config.get<number>('debugPort', 8000);
        const contextPath = config.get<string>('contextPath', '');
        const docBase = config.get<string>('docBase', '${workspaceFolder}/target/exploded');
        const javaOpts = config.get<string>('javaOpts', '-Dfile.encoding=UTF-8 -Dsun.stdout.encoding=UTF-8 -Dsun.stderr.encoding=UTF-8');
        const sourceBase = config.get<string>('sourceBase', '${workspaceFolder}/src/main/webapp');
        const classesBase = config.get<string>('classesBase', '${workspaceFolder}/target/classes');
        const jndiResources = config.get<any[]>('jndiResources', []);
        const colorizeLogs = config.get<boolean>('colorizeLogs', true);
        const autoOpenBrowser = config.get<boolean>('autoOpenBrowser', true);
        const preLaunchBuild = config.get<string>('preLaunchBuild', 'none');

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

        // --- Resolve docBase ---
        let resolvedDocBase = docBase.replace(/\$\{workspaceFolder\}/g, projectRoot);
        if (!fs.existsSync(resolvedDocBase)) {
            const resolved = await resolveDocBase(projectRoot, docBase);
            if (resolved === null) { return; }
            resolvedDocBase = resolved;
        }

        // --- Validate Tomcat Home ---
        const validation = validateTomcatHome(tomcatHome);
        if (!validation.valid) {
            vscode.window.showErrorMessage(vscode.l10n.t('Invalid Tomcat Home: {0}', validation.reason ?? ''));
            return;
        }

        // --- Resolve source / classes paths ---
        const resolvedSourceBase = sourceBase.replace(/\$\{workspaceFolder\}/g, projectRoot);
        const resolvedClassesBase = classesBase.replace(/\$\{workspaceFolder\}/g, projectRoot);

        const opts: ConfigWriterOptions = {
            tomcatHome, tomcatBaseDir, projectRoot, vscodeDir,
            httpPort, debugPort, contextPath,
            resolvedDocBase, resolvedSourceBase, resolvedClassesBase,
            jndiResources, javaOpts, colorizeLogs, autoOpenBrowser
        };

        // --- Execute with progress indicator ---
        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('Applying Tomcat Debug Setup...'), cancellable: false },
            async (progress) => {
                progress.report({ message: vscode.l10n.t('Checking Tomcat status...') });
                const running = await isTomcatRunning(httpPort);
                if (running) {
                    const btnContinue = vscode.l10n.t('Continue');
                    const answer = await vscode.window.showWarningMessage(
                        vscode.l10n.t('Tomcat appears to be running on port {0}. Overwriting conf while running may cause issues. Continue?', httpPort),
                        btnContinue, vscode.l10n.t('Cancel')
                    );
                    if (answer !== btnContinue) { return; }
                }

                progress.report({ message: vscode.l10n.t('Setting up Tomcat base directory...') });
                setupTomcatBaseDir(tomcatHome, tomcatBaseDir);

                progress.report({ message: vscode.l10n.t('Writing server.xml...') });
                writeServerXml(tomcatBaseDir, httpPort);

                progress.report({ message: vscode.l10n.t('Writing context.xml...') });
                writeContextXml(opts);

                progress.report({ message: vscode.l10n.t('Writing start/stop scripts...') });
                writeScripts(opts);

                progress.report({ message: vscode.l10n.t('Writing tasks.json...') });
                writeTasksJson(vscodeDir, preLaunchBuild);

                progress.report({ message: vscode.l10n.t('Writing launch.json...') });
                writeLaunchJson(vscodeDir, debugPort, httpPort, contextPath, autoOpenBrowser);
            }
        );

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

async function resolveDocBase(projectRoot: string, docBase: string): Promise<string | null> {
    const candidates = findDocBaseCandidates(projectRoot);

    if (candidates.length === 1) {
        const autoDocBase = candidates[0].replace(projectRoot, '${workspaceFolder}').replace(/\\/g, '/');
        markInternalUpdate();
        await vscode.workspace.getConfiguration('happySpringTomcat').update('docBase', autoDocBase, vscode.ConfigurationTarget.Workspace);
        clearInternalUpdate();
        vscode.window.showInformationMessage(vscode.l10n.t('docBase automatically detected: {0}', autoDocBase));
        return candidates[0];
    }

    const prompt = candidates.length > 1
        ? vscode.l10n.t('Multiple docBase candidates found. Please select one.')
        : vscode.l10n.t('docBase [{0}] does not exist. Please select yours.', docBase);

    const btnSelectDocBase = vscode.l10n.t('Select docBase');
    const pick = await vscode.window.showInformationMessage(prompt, btnSelectDocBase, vscode.l10n.t('Cancel'));
    if (pick !== btnSelectDocBase) { return null; }

    const selectedDocBaseConfig = await vscode.commands.executeCommand<string>('happy-spring-tomcat.selectDocBase', true);
    if (!selectedDocBaseConfig) { return null; }

    return selectedDocBaseConfig.replace(/\$\{workspaceFolder\}/g, projectRoot);
}
