const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DOMParser } = require('@xmldom/xmldom');
const { readProjectPaths, resolveProjectPath, validatePorts } = require('../out/lib/configuration');
const { setupTomcatBaseDir, writeServerXml } = require('../out/lib/writers/serverXml');
const { writeContextXml } = require('../out/lib/writers/contextXml');
const { writeLaunchJson } = require('../out/lib/writers/vscodeConfig');

function directory(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hst settings '));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    return root;
}
function put(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); }
const parse = text => new DOMParser().parseFromString(text, 'application/xml');

test('project paths use current settings and honor explicit empty values', () => {
    const config = values => ({ get: (key, fallback) => values[key] ?? fallback });
    const settings = config({
        builtWebAppDirectory: 'target/ROOT', webSourceDirectory: '', classesDirectory: '', resourcesDirectory: ''
    });
    assert.deepEqual(readProjectPaths(settings), {
        builtWebAppDirectory: 'target/ROOT', webSourceDirectory: '', classesDirectory: '', resourcesDirectory: ''
    });
    assert.deepEqual(readProjectPaths(config({})), {
        builtWebAppDirectory: '',
        webSourceDirectory: '${workspaceFolder}/src/main/webapp',
        classesDirectory: '${workspaceFolder}/target/classes', resourcesDirectory: ''
    });
});

test('settings expose development paths without obsolete options', () => {
    const properties = Object.assign({}, ...require('../package.json').contributes.configuration.map(group => group.properties));
    for (const key of ['docBase', 'sourceBase', 'classesBase', 'preventDuplicateClasses', 'deploymentMode', 'buildTask']) {
        assert.equal(properties[`happySpringTomcat.${key}`], undefined);
    }
    assert.deepEqual(properties['happySpringTomcat.preLaunchBuild'].enum, ['none', 'maven', 'gradle', 'custom']);
    assert.equal(properties['happySpringTomcat.preLaunchBuild'].default, 'none');
    for (const key of ['builtWebAppDirectory', 'webSourceDirectory', 'classesDirectory']) {
        assert.equal(properties[`happySpringTomcat.${key}`].scope, 'resource');
        assert.equal(properties[`happySpringTomcat.${key}`].markdownDeprecationMessage, undefined);
    }
});

test('relative paths use the project folder and invalid/conflicting ports fail early', t => {
    const root = directory(t);
    assert.equal(resolveProjectPath('target/classes', root), path.join(root, 'target/classes'));
    assert.equal(resolveProjectPath('${workspaceFolder}/target/classes', root), path.join(root, 'target/classes'));
    assert.equal(resolveProjectPath('', root), '');
    assert.throws(() => resolveProjectPath('${unsupported}/classes', root), /Unsupported path variable/);
    for (const ports of [[8080, 8080], [0, 8000], [65536, 8000], [8080.5, 8000], [8080, NaN]]) {
        assert.throws(() => validatePorts(...ports));
    }
    validatePorts(8080, 8000);
});

test('isolated server has one HTTP connector regardless of attribute order/protocol class', t => {
    const root = directory(t);
    const file = path.join(root, 'conf/server.xml');
    put(file, `<Server port='8005' portOffset='100'><Service name='Catalina'>
      <!-- <Connector port="9999" protocol="HTTP/1.1"/> -->
      <Connector protocol='org.apache.coyote.http11.Http11NioProtocol' connectionTimeout='20000' port='8080'/>
      <Connector protocol='AJP/1.3' port='8009'/><Connector protocol='HTTP/1.1' SSLEnabled='true' port='8443'/>
      <Engine name='Catalina' defaultHost='localhost'><Host name='localhost' appBase='webapps'/></Engine>
    </Service></Server>`);
    writeServerXml(root, 9090);
    const doc = parse(fs.readFileSync(file, 'utf8'));
    const connectors = doc.getElementsByTagName('Connector');
    assert.equal(connectors.length, 1);
    assert.equal(connectors[0].getAttribute('port'), '9090');
    assert.equal(connectors[0].getAttribute('connectionTimeout'), '20000');
    assert.equal(connectors[0].hasAttribute('address'), false);
    assert.equal(doc.documentElement.getAttribute('port'), '-1');
    assert.equal(doc.documentElement.hasAttribute('portOffset'), false);
});

test('Setup preserves runtime logging edits and does not import unrelated applications', t => {
    const root = directory(t);
    const home = path.join(root, 'home');
    const runtime = path.join(root, 'runtime');
    put(path.join(home, 'conf/logging.properties'), 'default logging');
    put(path.join(home, 'conf/Catalina/localhost/other.xml'), '<Context/>');
    put(path.join(runtime, 'conf/logging.properties'), 'project logging');
    setupTomcatBaseDir(home, runtime);
    assert.equal(fs.readFileSync(path.join(runtime, 'conf/logging.properties'), 'utf8'), 'project logging');
    assert.equal(fs.existsSync(path.join(runtime, 'conf/Catalina/localhost/other.xml')), false);
});

test('settings override named JNDI resources once; custom attributes and other nodes survive', t => {
    const root = directory(t);
    const docBase = path.join(root, 'app');
    put(path.join(docBase, 'META-INF/context.xml'), `<Context>
      <Resource name='jdbc/main' url='old' type='javax.sql.DataSource'/>
      <Resource name='jdbc/other' url='keep'/><Environment name='env' value='keep' type='java.lang.String'/>
    </Context>`);
    const opts = { resolvedBuiltWebAppDirectory: docBase, resolvedWebSourceDirectory: '', resolvedClassesDirectory: '',
        tomcatBaseDir: path.join(root, 'runtime'), contextPath: '',
        jndiResources: [{ name: 'jdbc/main', url: 'new?a=1&b=2', maxTotal: 10, testOnBorrow: true }] };
    writeContextXml(opts);
    const file = path.join(opts.tomcatBaseDir, 'conf/Catalina/localhost/ROOT.xml');
    const document = parse(fs.readFileSync(file, 'utf8'));
    const resources = Array.from(document.getElementsByTagName('Resource'));
    assert.equal(resources.length, 2);
    assert.equal(resources.find(node => node.getAttribute('name') === 'jdbc/main').getAttribute('url'), 'new?a=1&b=2');
    assert.equal(document.getElementsByTagName('Environment').length, 1);
    assert.equal(document.documentElement.hasAttribute('clearReferencesThreadLocals'), false);
    const before = fs.readFileSync(file, 'utf8');
    assert.throws(() => writeContextXml({ ...opts, jndiResources: [{ name: 'same' }, { name: 'same' }] }), /Duplicate JNDI/);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    put(path.join(docBase, 'META-INF/context.xml'), '<Context><Resource></Context>');
    assert.throws(() => writeContextXml(opts), /Invalid Context XML/);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('launch regeneration preserves Java debugger options and unrelated configurations', t => {
    const root = directory(t);
    const file = path.join(root, 'launch.json');
    put(file, JSON.stringify({ version: '0.2.0', configurations: [
        { name: 'Happy Spring Tomcat - Debug', port: 8000, projectName: 'my-project', stepFilters: { skipClasses: ['java.*'] } },
        { name: 'Other app', type: 'node', request: 'launch' }
    ] }));
    writeLaunchJson(root, 9000);
    const configurations = JSON.parse(fs.readFileSync(file, 'utf8')).configurations;
    assert.equal(configurations[0].port, 9000);
    assert.equal(configurations[0].projectName, 'my-project');
    assert.deepEqual(configurations[0].stepFilters.skipClasses, ['java.*']);
    assert.equal(configurations[1].name, 'Other app');
});

test('all manifest settings and commands have English and Korean labels', () => {
    const manifest = require('../package.json');
    for (const locale of ['../package.nls.json', '../package.nls.ko.json']) {
        const labels = require(locale);
        for (const match of JSON.stringify(manifest).matchAll(/%([^%]+)%/g)) {
            assert.ok(labels[match[1]], `${locale}: missing ${match[1]}`);
        }
    }
});

test('runtime messages are translated and setting links target registered commands', () => {
    const ts = require('typescript');
    const labels = require('../l10n/bundle.l10n.ko.json');
    const manifest = require('../package.json');
    const registered = new Set();
    const missing = new Set();
    function scan(directory) {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const file = path.join(directory, entry.name);
            if (entry.isDirectory()) { scan(file); continue; }
            if (!file.endsWith('.ts')) { continue; }
            const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
            function visit(node) {
                if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
                    const expression = node.expression.getText(source);
                    const value = node.arguments[0].text;
                    if (expression === 'vscode.commands.registerCommand') { registered.add(value); }
                    if (expression === 'vscode.l10n.t' && !labels[value]) { missing.add(value); }
                }
                ts.forEachChild(node, visit);
            }
            visit(source);
        }
    }
    scan(path.join(__dirname, '../src'));
    assert.deepEqual([...missing], []);
    for (const command of manifest.contributes.commands) { assert.ok(registered.has(command.command), command.command); }
    for (const locale of ['../package.nls.json', '../package.nls.ko.json']) {
        for (const match of JSON.stringify(require(locale)).matchAll(/command:([a-zA-Z0-9.\-]+)/g)) {
            assert.ok(registered.has(match[1]), match[1]);
        }
    }
});
