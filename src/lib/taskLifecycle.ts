import * as vscode from 'vscode';

/** A task ending does not imply success. Cleanup/restart requires a zero process exit. */
export function executeTaskAndWait(task: vscode.Task, timeoutMs: number): Promise<boolean> {
    return new Promise(resolve => {
        let execution: vscode.TaskExecution | undefined;
        const earlyEvents = new Map<vscode.TaskExecution, number | undefined>();
        let settled = false;
        const finish = (success: boolean) => {
            if (settled) { return; }
            settled = true;
            clearTimeout(timer);
            listener.dispose();
            resolve(success);
        };
        const listener = vscode.tasks.onDidEndTaskProcess(event => {
            if (execution) {
                if (event.execution === execution) { finish(event.exitCode === 0); }
            } else if (event.execution.task.name === task.name && event.execution.task.scope === task.scope) {
                earlyEvents.set(event.execution, event.exitCode);
            }
        });
        const timer = setTimeout(() => finish(false), timeoutMs);
        Promise.resolve().then(() => vscode.tasks.executeTask(task)).then(started => {
            execution = started;
            if (earlyEvents.has(execution)) { finish(earlyEvents.get(execution) === 0); }
            earlyEvents.clear();
        }, () => finish(false));
    });
}
