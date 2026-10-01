export interface ConfigWriterOptions {
    tomcatHome: string;
    tomcatBaseDir: string;
    projectRoot: string;
    vscodeDir: string;
    httpPort: number;
    debugPort: number;
    contextPath: string;
    resolvedBuiltWebAppDirectory: string;
    resolvedWebSourceDirectory: string;
    resolvedClassesDirectory: string;
    resolvedResourcesDirectory?: string;
    jndiResources: any[];
    javaOpts: string;
    colorizeLogs: boolean;
}
