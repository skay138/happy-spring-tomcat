const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { writeContextXml } = require('../out/lib/writers/contextXml');
const { writeScripts } = require('../out/lib/writers/scripts');
const { writeTasksJson } = require('../out/lib/writers/vscodeConfig');
const { restoreLegacyClassesBackup } = require('../out/lib/legacyClassesBackup');

function put(file, contents = '') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
}

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hst deployment '));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const opts = {
        projectRoot: root, vscodeDir: path.join(root, '.vscode'),
        tomcatBaseDir: path.join(root, 'runtime'), tomcatHome: path.join(root, 'tomcat'),
        resolvedBuiltWebAppDirectory: path.join(root, 'target', 'ROOT'),
        resolvedWebSourceDirectory: path.join(root, 'src', 'main', 'webapp'),
        resolvedClassesDirectory: path.join(root, 'target', 'classes'),
        contextPath: '', httpPort: 8080, debugPort: 8000, javaOpts: '',
        colorizeLogs: false, autoOpenBrowser: false, jndiResources: []
    };
    fs.mkdirSync(opts.vscodeDir, { recursive: true });
    fs.mkdirSync(path.join(opts.resolvedBuiltWebAppDirectory, 'WEB-INF', 'lib'), { recursive: true });
    put(path.join(opts.resolvedWebSourceDirectory, 'WEB-INF', 'web.xml'), '<web-app xmlns="http://xmlns.jcp.org/xml/ns/javaee" version="3.1"/>');
    put(path.join(opts.resolvedWebSourceDirectory, 'index.txt'), 'source web root');
    for (const dir of [opts.resolvedClassesDirectory, path.join(opts.resolvedBuiltWebAppDirectory, 'WEB-INF', 'classes')]) {
        put(path.join(dir, 'lucy-xss-servlet-filter-rule.xml'), '<config/>');
        put(path.join(dir, 'egovframework/spring/com/context-security.xml'), '<beans/>');
    }
    const xmlFile = path.join(opts.tomcatBaseDir, 'conf/Catalina/localhost/ROOT.xml');
    return { opts, root, xmlFile, xml: () => fs.readFileSync(xmlFile, 'utf8') };
}

test('virtual webapp exposes only one classes directory without modifying build output', t => {
    const f = fixture(t);
    put(path.join(f.opts.resolvedBuiltWebAppDirectory, 'META-INF/context.xml'), '<Context><Environment name="example" value="ok" type="java.lang.String"/></Context>');
    writeContextXml(f.opts);
    assert.ok(f.xml().includes(`docBase="${f.opts.resolvedWebSourceDirectory}"`));
    assert.equal((f.xml().match(/webAppMount="\/WEB-INF\/classes"/g) || []).length, 1);
    assert.ok(f.xml().includes(`base="${path.join(f.opts.resolvedBuiltWebAppDirectory, 'WEB-INF', 'lib')}"`));
    assert.ok(f.xml().includes('<Environment name="example"'));
    writeScripts(f.opts);
    for (const name of ['start-tomcat.bat', 'stop-tomcat.bat', 'start-tomcat.sh', 'stop-tomcat.sh']) {
        const script = fs.readFileSync(path.join(f.opts.vscodeDir, 'happy-spring-tomcat', name), 'utf8');
        assert.doesNotMatch(script, /classes-backup|Duplicate Protection|WEB-INF/);
    }
    assert.ok(fs.existsSync(path.join(f.opts.resolvedBuiltWebAppDirectory, 'WEB-INF/classes/lucy-xss-servlet-filter-rule.xml')));
});

test('incompatible settings leave the existing context untouched', t => {
    const f = fixture(t);
    writeContextXml(f.opts);
    const before = f.xml();
    put(path.join(f.opts.resolvedWebSourceDirectory, 'WEB-INF/classes/duplicate.xml'), '<beans/>');
    assert.throws(() => writeContextXml(f.opts), /already contains WEB-INF\/classes/);
    assert.equal(f.xml(), before);
    assert.throws(() => writeContextXml({ ...f.opts, resolvedWebSourceDirectory: '' }), /requires webSourceDirectory/);
    assert.equal(f.xml(), before);
});

test('explicit exploded deployment retains docBase and has no classes overlay', t => {
    const f = fixture(t);
    writeContextXml({ ...f.opts, resolvedWebSourceDirectory: '', resolvedClassesDirectory: '' });
    assert.ok(f.xml().includes(`docBase="${f.opts.resolvedBuiltWebAppDirectory}"`));
    assert.doesNotMatch(f.xml(), /PreResources/);
});

test('same-directory classes mapping is omitted', t => {
    const f = fixture(t);
    writeContextXml({ ...f.opts, resolvedWebSourceDirectory: f.opts.resolvedBuiltWebAppDirectory, resolvedClassesDirectory: path.join(f.opts.resolvedBuiltWebAppDirectory, 'WEB-INF/classes') });
    assert.doesNotMatch(f.xml(), /webAppMount="\/WEB-INF\/classes"/);
});

test('conflicting embedded Resources are rejected without losing the descriptor', t => {
    const f = fixture(t);
    writeContextXml(f.opts);
    const before = f.xml();
    put(path.join(f.opts.resolvedBuiltWebAppDirectory, 'META-INF/context.xml'), '<Context><Resources cachingAllowed="true"/></Context>');
    assert.throws(() => writeContextXml(f.opts), /already defines Resources/);
    assert.equal(f.xml(), before);
});

const taskOptions = f => ({
    classesDirectory: f.opts.resolvedClassesDirectory,
    builtWebAppDirectory: f.opts.resolvedBuiltWebAppDirectory,
    preLaunchBuild: 'none'
});

test('none starts without preparation, validation or build tasks', t => {
    const f = fixture(t);
    writeTasksJson(f.opts.vscodeDir, taskOptions(f));
    const tasks = JSON.parse(fs.readFileSync(path.join(f.opts.vscodeDir, 'tasks.json'), 'utf8')).tasks;
    assert.deepEqual(tasks.find(task => task.isBackground).dependsOn, ['Stop Happy Tomcat']);
    assert.equal(tasks.some(task => /Maven|Gradle|Prepare|Validate/.test(task.label)), false);
});

test('custom tasks preserve arguments and run between stop and start', t => {
    const f = fixture(t);
    const file = path.join(f.opts.vscodeDir, 'tasks.json');
    const custom = { label: 'Local Maven Build', type: 'shell', command: 'mvn', args: ['compile', '-Plocal'] };
    put(file, '// Keep this comment\n' + JSON.stringify({ version: '2.0.0', tasks: [custom] }));
    writeTasksJson(f.opts.vscodeDir, { ...taskOptions(f), preLaunchBuild: 'custom', customBuildTask: custom.label });
    const { parse } = require('jsonc-parser');
    const tasks = parse(fs.readFileSync(file, 'utf8')).tasks;
    assert.deepEqual(tasks.find(task => task.label === custom.label), custom);
    assert.deepEqual(tasks.find(task => task.isBackground).dependsOn,
        ['Stop Happy Tomcat', custom.label]);
    assert.match(fs.readFileSync(file, 'utf8'), /Keep this comment/);
});

test('legacy migration restores missing deployment only and preserves rebuilt output', t => {
    const f = fixture(t);
    const original = path.join(f.opts.resolvedBuiltWebAppDirectory, 'WEB-INF/classes');
    const backup = path.join(f.root, 'target/.happy-spring-tomcat/classes-backup');
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    fs.renameSync(original, backup);
    restoreLegacyClassesBackup(f.root, '');
    assert.ok(fs.existsSync(backup));
    assert.equal(fs.existsSync(original), false);
    restoreLegacyClassesBackup(f.root, f.opts.resolvedBuiltWebAppDirectory);
    assert.ok(fs.existsSync(path.join(original, 'lucy-xss-servlet-filter-rule.xml')));
    assert.equal(fs.existsSync(backup), false);
    put(path.join(backup, 'old.xml'), 'keep backup');
    restoreLegacyClassesBackup(f.root, f.opts.resolvedBuiltWebAppDirectory);
    assert.equal(fs.readFileSync(path.join(backup, 'old.xml'), 'utf8'), 'keep backup');
});

test('Maven generates only compile or package without changing user tasks', t => {
    const f = fixture(t);
    put(path.join(f.root, 'pom.xml'), '<project/>');
    put(path.join(f.root, process.platform === 'win32' ? 'mvnw.cmd' : 'mvnw'));
    const file = path.join(f.opts.vscodeDir, 'tasks.json');
    const userTask = { label: 'Maven Build', command: 'mvn', args: ['package', '-Plocal'] };
    put(file, JSON.stringify({ tasks: [userTask] }));
    for (const full of [false, true]) {
        writeTasksJson(f.opts.vscodeDir, { ...taskOptions(f), preLaunchBuild: 'maven', classesDirectory: full ? '' : f.opts.resolvedClassesDirectory });
        const { tasks } = JSON.parse(fs.readFileSync(file, 'utf8'));
        assert.deepEqual(tasks.find(task => task.label === userTask.label), userTask);
        const build = tasks.find(task => task.label === 'Happy Spring Tomcat: Maven Build');
        assert.match(build.command, /mvnw/);
        assert.deepEqual(build.args, [full ? 'package' : 'compile', '-DskipTests']);
        assert.deepEqual(tasks.find(task => task.isBackground).dependsOn,
            ['Stop Happy Tomcat', build.label]);
    }
});

test('Gradle uses standard classes and reserves WAR preparation for full deployment', t => {
    for (const wrapper of [false, true]) {
        const f = fixture(t);
        put(path.join(f.root, 'build.gradle.kts'));
        if (wrapper) { put(path.join(f.root, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew')); }
        writeTasksJson(f.opts.vscodeDir, { ...taskOptions(f), preLaunchBuild: 'gradle' });
        const { tasks } = JSON.parse(fs.readFileSync(path.join(f.opts.vscodeDir, 'tasks.json'), 'utf8'));
        const build = tasks.find(task => task.label === 'Happy Spring Tomcat: Gradle Build');
        assert.equal(build.command, wrapper ? (process.platform === 'win32' ? '.\\gradlew.bat' : './gradlew') : 'gradle');
        assert.deepEqual(build.args, ['classes']);
        assert.deepEqual(tasks.find(task => task.isBackground).dependsOn, ['Stop Happy Tomcat', build.label]);
        writeTasksJson(f.opts.vscodeDir, { ...taskOptions(f), preLaunchBuild: 'gradle', classesDirectory: '' });
        const fullTasks = JSON.parse(fs.readFileSync(path.join(f.opts.vscodeDir, 'tasks.json'), 'utf8')).tasks;
        const full = fullTasks.find(task => task.label === build.label);
        assert.ok(full.args.includes('happyTomcatPrepare'));
        assert.ok(full.args.includes('--no-configuration-cache'));
        assert.ok(fs.existsSync(full.args[full.args.indexOf('--init-script') + 1]));
    }
});

test('invalid build choices, missing build files, background tasks and cycles fail before rewriting tasks', t => {
    const f = fixture(t);
    const file = path.join(f.opts.vscodeDir, 'tasks.json');
    put(file, '{"tasks":[]}');
    const before = fs.readFileSync(file, 'utf8');
    for (const preLaunchBuild of ['auto', 'maven', 'gradle', 'custom']) {
        assert.throws(() => writeTasksJson(f.opts.vscodeDir, { ...taskOptions(f), preLaunchBuild }));
        assert.equal(fs.readFileSync(file, 'utf8'), before);
    }
    for (const task of [
        { label: 'My build', dependsOn: 'Start Happy Tomcat' },
        { label: 'My build', dependsOn: 'My build' },
        { label: 'My build', isBackground: true }
    ]) {
        const contents = JSON.stringify({ tasks: [task] });
        put(file, contents);
        assert.throws(() => writeTasksJson(f.opts.vscodeDir,
            { ...taskOptions(f), preLaunchBuild: 'custom', customBuildTask: task.label }));
        assert.equal(fs.readFileSync(file, 'utf8'), contents);
    }
});

test('settings.json stays unchanged when regenerating scripts, context and tasks', t => {
    const f = fixture(t);
    const settings = '// Project-specific settings\n{"happySpringTomcat.preLaunchBuild":"none","java.configuration.runtimes":[]}';
    const file = path.join(f.opts.vscodeDir, 'settings.json');
    put(file, settings);
    writeContextXml(f.opts);
    writeScripts(f.opts);
    writeTasksJson(f.opts.vscodeDir, taskOptions(f));
    assert.equal(fs.readFileSync(file, 'utf8'), settings);
});

test('custom Maven resource processing and compilation follow filtering rules without packaging', {
    skip: !process.env.HST_TEST_MAVEN || process.platform !== 'win32'
}, t => {
    const f = fixture(t);
    const pom = path.join(f.root, 'pom.xml');
    put(pom, `<project xmlns="http://maven.apache.org/POM/4.0.0">
      <modelVersion>4.0.0</modelVersion><groupId>test</groupId><artifactId>resources</artifactId><version>1</version>
      <properties><probe.value>processed-by-maven</probe.value><project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
      <maven.compiler.source>8</maven.compiler.source><maven.compiler.target>8</maven.compiler.target></properties>
      <build><resources><resource><directory>src/main/resources</directory><filtering>true</filtering></resource></resources>
      <plugins><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-resources-plugin</artifactId><version>3.3.1</version></plugin>
      <plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-compiler-plugin</artifactId><version>3.13.0</version></plugin></plugins></build>
    </project>`);
    const relative = 'lucy-xss-servlet-filter-rule.xml';
    put(path.join(f.root, 'src/main/resources', relative), '<config>${probe.value}</config>');
    fs.unlinkSync(path.join(f.opts.resolvedClassesDirectory, relative));
    put(path.join(f.root, 'src/main/java/Uncompiled.java'), 'public class Uncompiled {}');
    run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '& $env:HST_TEST_MAVEN -o -f $env:HST_TEST_POM process-resources; exit $LASTEXITCODE'], {
        env: { ...process.env, HST_TEST_POM: pom }
    });
    assert.equal(fs.readFileSync(path.join(f.opts.resolvedClassesDirectory, relative), 'utf8'), '<config>processed-by-maven</config>');
    assert.equal(fs.existsSync(path.join(f.opts.resolvedClassesDirectory, 'Uncompiled.class')), false);
    assert.equal(fs.existsSync(path.join(f.root, 'target/resources-1.jar')), false);
    fs.unlinkSync(path.join(f.opts.resolvedClassesDirectory, relative));
    run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '& $env:HST_TEST_MAVEN -o -f $env:HST_TEST_POM $env:HST_TEST_PHASE; exit $LASTEXITCODE'], {
        env: { ...process.env, HST_TEST_POM: pom, HST_TEST_PHASE: 'compile' }
    });
    assert.equal(fs.readFileSync(path.join(f.opts.resolvedClassesDirectory, relative), 'utf8'), '<config>processed-by-maven</config>');
    assert.equal(fs.existsSync(path.join(f.opts.resolvedClassesDirectory, 'Uncompiled.class')), true);
    assert.equal(fs.existsSync(path.join(f.root, 'target/resources-1.jar')), false);
});

function run(command, args, options = {}) {
    const result = spawnSync(command, args, { encoding: 'utf8', timeout: 60000, ...options });
    assert.equal(result.status, 0, `${command}: ${result.error || ''}\n${result.stdout}\n${result.stderr}`);
    return result.stdout;
}

test('Tomcat loads each XML once, resolves dependency JARs, and restarts with build output intact', {
    skip: !process.env.HST_TEST_TOMCAT_HOME
}, t => {
    const f = fixture(t);
    const home = process.env.HST_TEST_TOMCAT_HOME;
    const cp = [path.join(home, 'lib', '*'), path.join(home, 'bin', 'tomcat-juli.jar'), f.root].join(path.delimiter);
    put(path.join(f.root, 'DependencyMarker.java'), 'public class DependencyMarker {}');
    const jarClasses = path.join(f.root, 'jar-classes');
    fs.mkdirSync(jarClasses);
    run('javac', ['-d', jarClasses, path.join(f.root, 'DependencyMarker.java')]);
    run('jar', ['cf', path.join(f.opts.resolvedBuiltWebAppDirectory, 'WEB-INF/lib/dependency.jar'), '-C', jarClasses, '.']);
    run('javac', ['-cp', cp, '-d', f.root, path.join(__dirname, 'fixtures', 'ResourceMappingProbe.java')]);
    writeContextXml(f.opts);
    for (let attempt = 0; attempt < 2; attempt++) {
        const output = run('java', ['-cp', cp, 'ResourceMappingProbe', f.opts.tomcatBaseDir, f.opts.resolvedWebSourceDirectory, f.xmlFile]);
        assert.match(output, /RESOURCE_MAPPING_OK/);
        assert.ok(fs.existsSync(path.join(f.opts.resolvedBuiltWebAppDirectory, 'WEB-INF/classes/lucy-xss-servlet-filter-rule.xml')));
    }
});
