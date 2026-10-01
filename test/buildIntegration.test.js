const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { writeContextXml } = require('../out/lib/writers/contextXml');
const { writeTasksJson } = require('../out/lib/writers/vscodeConfig');

function put(file, value = '') { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); }
function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hst build '));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const o = { projectRoot: root, vscodeDir: path.join(root, '.vscode'), tomcatBaseDir: path.join(root, 'runtime'),
        resolvedBuiltWebAppDirectory: path.join(root, 'build/exploded'), resolvedWebSourceDirectory: path.join(root, 'src/main/webapp'),
        resolvedClassesDirectory: path.join(root, 'build/custom-java'), contextPath: '', jndiResources: [] };
    fs.mkdirSync(o.vscodeDir);
    fs.mkdirSync(o.resolvedClassesDirectory, { recursive: true });
    fs.mkdirSync(path.join(o.resolvedBuiltWebAppDirectory, 'WEB-INF/lib'), { recursive: true });
    put(path.join(o.resolvedWebSourceDirectory, 'WEB-INF/web.xml'), '<web-app xmlns="http://xmlns.jcp.org/xml/ns/javaee" version="3.1"/>');
    put(path.join(o.resolvedWebSourceDirectory, 'index.txt'), 'source');
    writeContextXml(o);
    return { root, o, contextFile: path.join(o.tomcatBaseDir, 'conf/Catalina/localhost/ROOT.xml') };
}
function run(command, args, options = {}) {
    const r = spawnSync(command, args, { encoding: 'utf8', timeout: 120000, windowsHide: true, ...options });
    assert.equal(r.status, 0, `${r.error || ''}\n${r.stdout}\n${r.stderr}`);
    return r.stdout;
}
function build(f, mode, tool, full = false) {
    writeTasksJson(f.o.vscodeDir, { classesDirectory: full ? '' : f.o.resolvedClassesDirectory,
        builtWebAppDirectory: f.o.resolvedBuiltWebAppDirectory, preLaunchBuild: mode });
    const { tasks } = JSON.parse(fs.readFileSync(path.join(f.o.vscodeDir, 'tasks.json'), 'utf8'));
    const task = tasks.find(task => task.label === 'Happy Spring Tomcat: ' + (mode === 'maven' ? 'Maven' : 'Gradle') + ' Build');
    const argsFile = path.join(f.root, 'arguments.json');
    put(argsFile, JSON.stringify([...(process.env.HST_TEST_ONLINE ? [] : ['--offline']), ...(mode === 'gradle' ? ['--no-daemon'] : []), ...task.args]));
    return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        '$buildArgs = Get-Content -LiteralPath $env:HST_ARGS -Raw | ConvertFrom-Json; & $env:HST_TOOL @buildArgs; exit $LASTEXITCODE'],
    { cwd: f.root, env: { ...process.env, HST_TOOL: tool, HST_ARGS: argsFile } });
}

test('real Maven prepares filtered resources and compiles or packages customized output', {
    skip: !process.env.HST_TEST_MAVEN || process.platform !== 'win32', timeout: 180000
}, t => {
    const f = fixture(t);
    put(path.join(f.root, 'pom.xml'), '<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion>' +
      '<groupId>test</groupId><artifactId>output-check</artifactId><version>1</version>' +
      '<properties><maven.compiler.source>8</maven.compiler.source><maven.compiler.target>8</maven.compiler.target><value>maven-filtered</value></properties>' +
      '<build><outputDirectory>build/custom-java</outputDirectory>' +
      '<resources><resource><directory>src/main/resources</directory><filtering>true</filtering></resource></resources>' +
      '<plugins><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-compiler-plugin</artifactId><version>3.13.0</version></plugin>' +
      '<plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-resources-plugin</artifactId><version>3.3.1</version></plugin></plugins></build></project>');
    put(path.join(f.root, 'src/main/java/Probe.java'), 'public class Probe {}');
    put(path.join(f.root, 'src/main/resources/config.xml'), '<config>${value}</config>');
    build(f, 'maven', process.env.HST_TEST_MAVEN);
    assert.ok(fs.existsSync(path.join(f.o.resolvedClassesDirectory, 'Probe.class')));
    assert.equal(fs.readFileSync(path.join(f.o.resolvedClassesDirectory, 'config.xml'), 'utf8'), '<config>maven-filtered</config>');
    assert.equal(fs.existsSync(path.join(f.root, 'target/output-check-1.jar')), false);
    const pomFile = path.join(f.root, 'pom.xml');
    let pom = fs.readFileSync(pomFile, 'utf8').replace('<version>1</version>', '<version>1</version><packaging>war</packaging>');
    pom = pom.replace('</plugins>', '<plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-war-plugin</artifactId><version>3.3.2</version><configuration><webappDirectory>${project.basedir}/build/exploded</webappDirectory></configuration></plugin></plugins>');
    put(pomFile, pom);
    writeContextXml({ ...f.o, resolvedClassesDirectory: '', resolvedWebSourceDirectory: '' });
    build(f, 'maven', process.env.HST_TEST_MAVEN, true);
    assert.ok(fs.existsSync(path.join(f.o.resolvedBuiltWebAppDirectory, 'WEB-INF/classes/Probe.class')));
});

test('real Gradle handles separate resources, unchanged compilation and full WAR synchronization', {
    skip: !process.env.HST_TEST_GRADLE || process.platform !== 'win32', timeout: 240000
}, t => {
    const f = fixture(t);
    f.o.resolvedResourcesDirectory = path.join(f.root, 'build/custom-resources');
    writeContextXml(f.o);
    put(path.join(f.root, 'settings.gradle'), "rootProject.name = 'output-check'");
    put(path.join(f.root, 'gradle.properties'), 'org.gradle.configuration-cache=true');
    put(path.join(f.root, 'build.gradle'), "plugins { id 'war' }\n" +
      "sourceSets.main.java.destinationDirectory.set(file('build/custom-java'))\n" +
      "sourceSets.main.output.resourcesDir = file('build/custom-resources')\n" +
      "processResources { expand(value: 'gradle-filtered') }\n" +
      "dependencies { implementation files('libs/dependency.jar') }");
    put(path.join(f.root, 'src/main/java/Probe.java'), 'public class Probe {}');
    for (const relative of ['lucy-xss-servlet-filter-rule.xml', 'egovframework/spring/com/context-security.xml']) {
        put(path.join(f.root, 'src/main/resources', relative), '<config>${value}</config>');
    }
    put(path.join(f.root, 'DependencyMarker.java'), 'public class DependencyMarker {}');
    run('javac', ['-d', f.root, path.join(f.root, 'DependencyMarker.java')]);
    fs.mkdirSync(path.join(f.root, 'libs'));
    run('jar', ['cf', path.join(f.root, 'libs/dependency.jar'), '-C', f.root, 'DependencyMarker.class']);
    fs.copyFileSync(path.join(f.root, 'libs/dependency.jar'), path.join(f.o.resolvedBuiltWebAppDirectory, 'WEB-INF/lib/dependency.jar'));
    build(f, 'gradle', process.env.HST_TEST_GRADLE);
    const resource = path.join(f.root, 'build/custom-resources/lucy-xss-servlet-filter-rule.xml');
    assert.equal(fs.readFileSync(resource, 'utf8'), '<config>gradle-filtered</config>');
    const before = fs.statSync(path.join(f.o.resolvedClassesDirectory, 'Probe.class')).mtimeMs;
    const output = build(f, 'gradle', process.env.HST_TEST_GRADLE);
    assert.match(output, /compileJava UP-TO-DATE/);
    assert.equal(fs.statSync(path.join(f.o.resolvedClassesDirectory, 'Probe.class')).mtimeMs, before);
    put(path.join(f.root, 'src/main/resources/lucy-xss-servlet-filter-rule.xml'), '<updated>${value}</updated>');
    build(f, 'gradle', process.env.HST_TEST_GRADLE);
    assert.equal(fs.readFileSync(resource, 'utf8'), '<updated>gradle-filtered</updated>');
    if (process.env.HST_TEST_TOMCAT_HOME) {
        const home = process.env.HST_TEST_TOMCAT_HOME;
        const cp = [path.join(home, 'lib/*'), path.join(home, 'bin/tomcat-juli.jar'), f.root].join(path.delimiter);
        run('javac', ['-cp', cp, '-d', f.root, path.join(__dirname, 'fixtures/ResourceMappingProbe.java')]);
        assert.match(run('java', ['-cp', cp, 'ResourceMappingProbe', f.o.tomcatBaseDir, f.o.resolvedWebSourceDirectory,
            f.contextFile, '/build/custom-resources/']), /RESOURCE_MAPPING_OK/);
    }
    writeContextXml({ ...f.o, resolvedClassesDirectory: '', resolvedWebSourceDirectory: '', resolvedResourcesDirectory: '' });
    put(path.join(f.o.resolvedBuiltWebAppDirectory, 'obsolete.txt'), 'remove on sync');
    build(f, 'gradle', process.env.HST_TEST_GRADLE, true);
    assert.ok(fs.existsSync(path.join(f.o.resolvedBuiltWebAppDirectory, 'WEB-INF/classes/Probe.class')));
    assert.equal(fs.readFileSync(path.join(f.o.resolvedBuiltWebAppDirectory, 'WEB-INF/classes/lucy-xss-servlet-filter-rule.xml'), 'utf8'), '<updated>gradle-filtered</updated>');
    assert.equal(fs.existsSync(path.join(f.o.resolvedBuiltWebAppDirectory, 'obsolete.txt')), false);
    const invalid = { ...f, o: { ...f.o, resolvedBuiltWebAppDirectory: f.o.resolvedClassesDirectory } };
    assert.throws(() => build(invalid, 'gradle', process.env.HST_TEST_GRADLE, true), /Built Web App Directory must be a separate folder/);
    assert.ok(fs.existsSync(path.join(f.o.resolvedClassesDirectory, 'Probe.class')));
});
