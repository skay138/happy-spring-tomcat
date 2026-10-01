const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const listeners = new Set();
let start;
const vscode = { tasks: {
    onDidEndTaskProcess: listener => { listeners.add(listener); return { dispose: () => listeners.delete(listener) }; },
    executeTask: task => start(task)
} };
const load = Module._load;
Module._load = function(name, ...args) { return name === 'vscode' ? vscode : load.call(this, name, ...args); };
const { executeTaskAndWait } = require('../out/lib/taskLifecycle');
Module._load = load;
const emit = event => { for (const listener of listeners) listener(event); };

test('stop completion requires exit code zero, including events before executeTask resolves', async () => {
    for (const exitCode of [0, 2, undefined]) {
        const task = { name: 'Stop Happy Tomcat', scope: 1 };
        start = async () => {
            const execution = { task };
            emit({ execution, exitCode });
            return execution;
        };
        assert.equal(await executeTaskAndWait(task, 100), exitCode === 0);
        assert.equal(listeners.size, 0);
    }
});

test('task launch rejection and timeout clean up listeners and prevent runtime deletion', async () => {
    const task = { name: 'Stop Happy Tomcat', scope: 1 };
    start = () => { throw new Error('launch failed'); };
    assert.equal(await executeTaskAndWait(task, 100), false);
    start = async () => ({ task });
    assert.equal(await executeTaskAndWait(task, 10), false);
    assert.equal(listeners.size, 0);
});
