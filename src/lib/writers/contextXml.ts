import * as fs from 'fs';
import * as path from 'path';
import { ConfigWriterOptions } from '../types';
import { parseXml } from '../xml';
import { Element, XMLSerializer } from '@xmldom/xmldom';

export function validateContextOptions(opts: ConfigWriterOptions): void {
    contextFileNameFor(opts.contextPath);
    buildContextXmlContent(opts);
}

export function writeContextXml(opts: ConfigWriterOptions): void {
    const { tomcatBaseDir, contextPath } = opts;
    const catalinaHostDir = path.join(tomcatBaseDir, 'conf', 'Catalina', 'localhost');

    // Validate/render before replacing a working context descriptor.
    const content = buildContextXmlContent(opts);
    fs.mkdirSync(catalinaHostDir, { recursive: true });

    const contextFileName = contextFileNameFor(contextPath);
    const markerPath = path.join(tomcatBaseDir, 'conf', '.happy-spring-tomcat-context');
    const destination = path.join(catalinaHostDir, contextFileName);
    const temporary = destination + '.tmp';
    fs.writeFileSync(temporary, content, 'utf8');
    fs.renameSync(temporary, destination);
    if (fs.existsSync(markerPath)) {
        const previous = fs.readFileSync(markerPath, 'utf8').trim();
        if (previous && previous !== contextFileName && path.basename(previous) === previous && previous.toLowerCase().endsWith('.xml')) {
            fs.rmSync(path.join(catalinaHostDir, previous), { force: true });
        }
    }

    fs.writeFileSync(markerPath, contextFileName, 'utf8');
}

function contextFileNameFor(contextPath: string): string {
    if (contextPath === '/' || contextPath === '') { return 'ROOT.xml'; }
    if (/[\\#?:*"<>|\x00-\x1f]/.test(contextPath)) {
        throw new Error(`Invalid Tomcat context path: ${contextPath}`);
    }
    const segments = contextPath.replace(/^\//, '').split('/');
    if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
        throw new Error(`Invalid Tomcat context path: ${contextPath}`);
    }
    return segments.join('#') + '.xml';
}

function sameDirectory(a: string, b: string): boolean {
    const canonical = (value: string) => fs.existsSync(value) ? fs.realpathSync(value) : path.resolve(value);
    return process.platform === 'win32'
        ? canonical(a).toLowerCase() === canonical(b).toLowerCase()
        : canonical(a) === canonical(b);
}

function buildContextXmlContent(opts: ConfigWriterOptions): string {
    const { resolvedBuiltWebAppDirectory, resolvedWebSourceDirectory, resolvedClassesDirectory, jndiResources } = opts;
    const extraResources = opts.resolvedResourcesDirectory || '';
    if (extraResources && !resolvedClassesDirectory) {
        throw new Error('Resources Directory requires Classes Directory. Leave both empty to use the built webapp.');
    }
    let runtimeDocBase = resolvedBuiltWebAppDirectory;
    let sourceOverlay = resolvedWebSourceDirectory && !sameDirectory(resolvedWebSourceDirectory, resolvedBuiltWebAppDirectory) ? resolvedWebSourceDirectory : '';
    let classesOverlay = '';
    let libOverlay = '';
    if (resolvedClassesDirectory) {
        if (!resolvedWebSourceDirectory || !fs.existsSync(path.join(resolvedWebSourceDirectory, 'WEB-INF'))) {
            throw new Error('A separate classesDirectory requires webSourceDirectory with a WEB-INF directory. To use only the built webapp, leave both paths empty.');
        }
        const sourceClasses = path.join(resolvedWebSourceDirectory, 'WEB-INF', 'classes');
        if (fs.existsSync(sourceClasses) && !sameDirectory(sourceClasses, resolvedClassesDirectory)) {
            throw new Error('webSourceDirectory already contains WEB-INF/classes. Use a source web root without compiled classes, or leave webSourceDirectory and classesDirectory empty to use only the built webapp.');
        }
        runtimeDocBase = resolvedWebSourceDirectory;
        sourceOverlay = '';
        classesOverlay = sameDirectory(sourceClasses, resolvedClassesDirectory) ? '' : resolvedClassesDirectory;
        const builtLib = path.join(resolvedBuiltWebAppDirectory, 'WEB-INF', 'lib');
        if (!sameDirectory(builtLib, path.join(runtimeDocBase, 'WEB-INF', 'lib'))) {
            if (!fs.existsSync(builtLib)) {
                throw new Error(`Dependency directory is missing: ${builtLib}. Run your project's web application build before configuring Tomcat.`);
            }
            libOverlay = builtLib;
        }
    }
    if (sourceOverlay && fs.existsSync(path.join(sourceOverlay, 'WEB-INF', 'classes'))) {
        throw new Error('webSourceDirectory must not add a second WEB-INF/classes. Point it at web sources, or leave it empty.');
    }
    const jndiResourcesXml = buildJndiResourcesXml(jndiResources);
    const resourceOverlay = extraResources && !sameDirectory(extraResources, resolvedClassesDirectory) ? extraResources : '';
    const preResourcesXml = buildPreResourcesXml(sourceOverlay, classesOverlay, libOverlay, resourceOverlay);
    const metaInfContextBody = readMetaInfContextBody(
        resolvedBuiltWebAppDirectory, resolvedWebSourceDirectory, jndiResources, !!preResourcesXml
    );

    return `<?xml version="1.0" encoding="UTF-8"?>
<!--
  Auto-generated by happy-spring-tomcat extension.
  NOTE: conf/Catalina/localhost/*.xml takes precedence over META-INF/context.xml.
  Contents of META-INF/context.xml are embedded below automatically.
-->
<Context docBase="${escapeXmlAttribute(runtimeDocBase)}"
         reloadable="false">${preResourcesXml}${metaInfContextBody}${jndiResourcesXml}
</Context>
`;
}

function buildPreResourcesXml(sourceOverlay: string, resolvedClassesDirectory: string, libBase: string, resourcesDirectory: string): string {
    if (!sourceOverlay && !resolvedClassesDirectory && !libBase && !resourcesDirectory) { return ''; }

    const preResList: string[] = [];
    if (sourceOverlay) {
        preResList.push(
            `        <PreResources className="org.apache.catalina.webresources.DirResourceSet" base="${escapeXmlAttribute(sourceOverlay)}" webAppMount="/" />`
        );
    }
    if (resolvedClassesDirectory) {
        preResList.push(
            `        <PreResources className="org.apache.catalina.webresources.DirResourceSet"\n                      base="${escapeXmlAttribute(resolvedClassesDirectory)}"\n                      webAppMount="/WEB-INF/classes" />`
        );
    }
    if (resourcesDirectory) {
        preResList.push(`        <PreResources className="org.apache.catalina.webresources.DirResourceSet" base="${escapeXmlAttribute(resourcesDirectory)}" webAppMount="/WEB-INF/classes" />`);
    }
    if (libBase) {
        preResList.push(
            `        <PreResources className="org.apache.catalina.webresources.DirResourceSet"\n                      base="${escapeXmlAttribute(libBase)}"\n                      webAppMount="/WEB-INF/lib" />`
        );
    }
    return `\n    <!-- Source Folder Mapping for Hot Reload -->\n    <Resources cachingAllowed="false">\n${preResList.join('\n')}\n    </Resources>\n`;
}

function readMetaInfContextBody(resolvedBuiltWebAppDirectory: string, resolvedWebSourceDirectory: string, overrides: any[], ownsResources: boolean): string {
    const candidates = [
        path.join(resolvedBuiltWebAppDirectory, 'META-INF', 'context.xml'),
        ...(resolvedWebSourceDirectory ? [path.join(resolvedWebSourceDirectory, 'META-INF', 'context.xml')] : []),
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            const raw = fs.readFileSync(candidate, 'utf8');
            const document = parseXml(raw, 'Context');
            const root = document.documentElement!;
            const overrideNames = new Set(overrides.map(resource => resource.name));
            const serializer = new XMLSerializer();
            const body: string[] = [];
            for (const node of Array.from(root.childNodes)) {
                if (node.nodeType === 1) {
                    const element = node as Element;
                    if (ownsResources && element.tagName === 'Resources') {
                        throw new Error('META-INF/context.xml already defines Resources. Leave webSourceDirectory and classesDirectory empty to use its custom mappings.');
                    }
                    // Settings override a named JNDI resource, never create two definitions.
                    if (element.tagName === 'Resource' && overrideNames.has(element.getAttribute('name'))) { continue; }
                }
                body.push(serializer.serializeToString(node));
            }
            return body.join('');
        }
    }
    return '';
}

function buildJndiResourcesXml(jndiResources: any[]): string {
    if (!jndiResources || jndiResources.length === 0) { return ''; }

    const names = new Set<string>();
    const resourceElements = jndiResources.map((res: any) => {
        if (!res || typeof res.name !== 'string' || !res.name.trim()) { throw new Error('Each JNDI resource requires a non-empty name.'); }
        if (names.has(res.name)) { throw new Error(`Duplicate JNDI resource name in settings: ${res.name}`); }
        names.add(res.name);
        const attrs = Object.entries(res)
            .map(([key, value]) => {
                if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(key)) {
                    throw new Error(`Invalid JNDI Resource attribute name: ${key}`);
                }
                if (!['string', 'number', 'boolean'].includes(typeof value)) { throw new Error(`Invalid JNDI Resource value for ${key}`); }
                return `${key}="${escapeXmlAttribute(String(value))}"`;
            })
            .join('\n               ');
        return `    <!-- JNDI DataSource (from settings) -->\n    <Resource ${attrs} />`;
    });
    return '\n' + resourceElements.join('\n') + '\n';
}

function escapeXmlAttribute(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
