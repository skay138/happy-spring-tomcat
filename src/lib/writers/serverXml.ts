import * as fs from 'fs';
import * as path from 'path';

export function setupTomcatBaseDir(tomcatHome: string, tomcatBaseDir: string): void {
    const confDir = path.join(tomcatBaseDir, 'conf');
    const sourceConfDir = path.join(tomcatHome, 'conf');

    if (!fs.existsSync(tomcatBaseDir)) {
        fs.mkdirSync(tomcatBaseDir, { recursive: true });
    }

    fs.cpSync(sourceConfDir, confDir, { recursive: true });

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
        let serverXml = fs.readFileSync(serverXmlPath, 'utf8');
        serverXml = serverXml.replace(
            /(<Connector[^>]*?)port="\d+"([^>]*?protocol="HTTP\/1\.1")/g,
            `$1port="${httpPort}"$2`
        );
        // This runtime is stopped by its generated process-aware scripts. Disabling Tomcat's
        // shutdown listener avoids the default 8005 collision between separate workspaces.
        serverXml = serverXml.replace(
            /(<Server\b[^>]*?\bport=")[^"]*(")/,
            '$1-1$2'
        );
        fs.writeFileSync(serverXmlPath, serverXml, 'utf8');
    }
}
