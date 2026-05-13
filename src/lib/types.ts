export interface ConfigWriterOptions {
    tomcatHome: string;
    tomcatBaseDir: string;
    projectRoot: string;
    vscodeDir: string;
    httpPort: number;
    debugPort: number;
    contextPath: string;
    resolvedDocBase: string;
    resolvedSourceBase: string;
    resolvedClassesBase: string;
    jndiResources: any[];
    javaOpts: string;
    colorizeLogs: boolean;
    autoOpenBrowser: boolean;
}
