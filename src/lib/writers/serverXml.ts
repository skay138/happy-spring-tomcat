import * as fs from 'fs';
import * as path from 'path';
import { parseXml, serializeXml } from '../xml';

export function setupTomcatBaseDir(tomcatHome: string, tomcatBaseDir: string): void {
    const confDir = path.join(tomcatBaseDir, 'conf');
    const sourceConfDir = path.join(tomcatHome, 'conf');

    if (!fs.existsSync(tomcatBaseDir)) {
        fs.mkdirSync(tomcatBaseDir, { recursive: true });
    }

    fs.mkdirSync(confDir, { recursive: true });
    // Do not import other applications from conf/Catalina or overwrite local logging changes.
    for (const entry of fs.readdirSync(sourceConfDir, { withFileTypes: true })) {
        if (!entry.isFile()) { continue; }
        const destination = path.join(confDir, entry.name);
        if (!fs.existsSync(destination)) { fs.copyFileSync(path.join(sourceConfDir, entry.name), destination); }
    }

    ['logs', 'temp', 'work', 'webapps'].forEach(dir => {
        const dirPath = path.join(tomcatBaseDir, dir);
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath);
        }
    });
}

export function writeServerXml(tomcatBaseDir: string, httpPort: number): void {
    const serverXmlPath = path.join(tomcatBaseDir, 'conf', 'server.xml');
    if (fs.existsSync(serverXmlPath)) {
        const document = parseXml(fs.readFileSync(serverXmlPath, 'utf8'), 'Server');
        const connectors = Array.from(document.getElementsByTagName('Connector'));
        const http = connectors.find(connector => {
            const protocol = connector.getAttribute('protocol') || 'HTTP/1.1';
            return (protocol === 'HTTP/1.1' || protocol.includes('.http11.')) &&
                connector.getAttribute('SSLEnabled') !== 'true' && connector.getAttribute('secure') !== 'true';
        });
        if (!http) { throw new Error('Tomcat server.xml must contain a plain HTTP connector for local debugging.'); }
        http.setAttribute('port', String(httpPort));
        // One managed HTTP connector: no unused AJP/HTTPS port collisions between workspaces.
        for (const connector of connectors) {
            if (connector !== http) { connector.parentNode!.removeChild(connector); }
        }
        document.documentElement!.setAttribute('port', '-1');
        document.documentElement!.removeAttribute('portOffset');
        fs.writeFileSync(serverXmlPath, serializeXml(document), 'utf8');
    }
}
