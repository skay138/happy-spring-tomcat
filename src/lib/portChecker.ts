import * as net from 'net';
import { execFile } from 'child_process';

/**
 * Checks if something is listening on the given TCP port.
 * Returns true if Tomcat (or any process) appears to be running on that port.
 */
export function isTomcatRunning(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(400);
        socket.once('connect', () => { socket.destroy(); resolve(true); });
        socket.once('error', () => { socket.destroy(); resolve(false); });
        socket.once('timeout', () => { socket.destroy(); resolve(false); });
        socket.connect(port, '127.0.0.1');
    });
}

/**
 * Checks the OS listener table without connecting to the port. This is required for JDWP:
 * a plain TCP probe is treated as a debugger connection and produces handshake failures.
 */
export function isPortListening(port: number): Promise<boolean> {
    return new Promise(resolve => {
        if (process.platform === 'win32') {
            execFile('netstat.exe', ['-ano', '-p', 'TCP'], { timeout: 2000 }, (error, stdout) => {
                if (error && !stdout) { resolve(false); return; }
                const listening = stdout.split(/\r?\n/).some(line => {
                    const columns = line.trim().split(/\s+/);
                    return columns.length >= 5 && columns[0] === 'TCP' && columns[3] === 'LISTENING' &&
                        new RegExp(`:${port}$`).test(columns[1]);
                });
                resolve(listening);
            });
            return;
        }

        execFile('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { timeout: 2000 }, (error, stdout) => {
            resolve(!error && stdout.trim().length > 0);
        });
    });
}
