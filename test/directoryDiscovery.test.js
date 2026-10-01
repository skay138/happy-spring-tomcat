const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { findBuiltWebAppDirectories, getBuiltWebAppDirectoryIssue } = require('../out/lib/webAppFinder');
const { validateTomcatHome } = require('../out/lib/tomcatValidator');

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hst discovery '));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    return root;
}
function app(root, relative) {
    const directory = path.join(root, relative);
    fs.mkdirSync(path.join(directory, 'WEB-INF/lib'), { recursive: true });
    return directory;
}

test('discovery recognizes webapp structure regardless of folder name and excludes unrelated outputs', async t => {
    const root = fixture(t);
    const expected = ['target/ROOT', 'target/exploded', 'build/staging/my-app', 'out/application', 'bin/webapp'].map(name => app(root, name));
    for (const name of ['src/main/webapp', 'target/classes/false-app', 'target/test-classes/false-app',
        'target/node_modules/false-app', 'target/.hidden/false-app', 'target/ROOT/nested-app']) { app(root, name); }
    fs.mkdirSync(path.join(root, 'target/not-an-app/WEB-INF'), { recursive: true });
    fs.writeFileSync(path.join(root, 'target/not-an-app/WEB-INF/lib'), 'file, not directory');
    fs.writeFileSync(path.join(root, 'target/application.war'), 'archive');
    assert.deepEqual(await findBuiltWebAppDirectories(root), expected.sort());
    assert.equal(await getBuiltWebAppDirectoryIssue(path.join(root, 'target/not-an-app')), 'no-lib');
    assert.equal(await getBuiltWebAppDirectoryIssue(path.join(root, 'missing')), 'no-web-inf');
    assert.equal(await getBuiltWebAppDirectoryIssue(expected[0]), null);
    assert.equal(await getBuiltWebAppDirectoryIssue(''), 'no-web-inf');
});

test('directory links cannot create search cycles or pull in external applications', async t => {
    const root = fixture(t);
    const project = path.join(root, 'project');
    const found = app(project, 'target/exploded');
    const external = app(root, 'external/application');
    const type = process.platform === 'win32' ? 'junction' : 'dir';
    fs.symlinkSync(path.join(project, 'target'), path.join(project, 'target/cycle'), type);
    fs.symlinkSync(external, path.join(project, 'target/external-link'), type);
    fs.symlinkSync(path.dirname(external), path.join(project, 'build'), type);
    assert.deepEqual(await findBuiltWebAppDirectories(project), [found]);
});

test('unreadable search branches do not hide other candidates', async t => {
    const root = fixture(t);
    const readable = app(root, 'target/readable');
    const unreadable = app(root, 'target/unreadable');
    const read = fs.promises.readdir;
    t.mock.method(fs.promises, 'readdir', async (directory, ...args) => {
        if (directory === unreadable) { throw Object.assign(new Error('Access denied'), { code: 'EACCES' }); }
        return read(directory, ...args);
    });
    assert.deepEqual(await findBuiltWebAppDirectories(root), [readable]);
});

test('Tomcat selection requires real files for the platform launcher, libraries and configuration', t => {
    const root = fixture(t);
    const launcher = process.platform === 'win32' ? 'bin/catalina.bat' : 'bin/catalina.sh';
    const required = [launcher, 'bin/bootstrap.jar', 'bin/tomcat-juli.jar', 'conf/server.xml', 'lib/catalina.jar'];
    const put = relative => {
        const file = path.join(root, relative);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, 'fixture');
    };
    required.forEach(put);
    assert.equal(validateTomcatHome(root).valid, true);
    for (const relative of required) {
        fs.unlinkSync(path.join(root, relative));
        assert.equal(validateTomcatHome(root).valid, false, relative);
        put(relative);
    }
    fs.unlinkSync(path.join(root, launcher));
    fs.mkdirSync(path.join(root, launcher));
    assert.equal(validateTomcatHome(root).valid, false);
    assert.equal(validateTomcatHome('').valid, false);
});
