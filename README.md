# Happy Spring Tomcat for VS Code

English | [한국어](README.ko.md)

Debug legacy Spring web applications on local Tomcat. The extension creates a project runtime, start/stop tasks, and a Java attach configuration.

## Quick start

1. Open the project folder in VS Code. Use one project per window.
2. Run the project's web application build once to prepare dependency JARs, classes, and resources in an unpacked web application directory.
3. Run **Happy Spring Tomcat: Apply Debug Setup**. Select the Tomcat installation and built web application directory when prompted.
4. Select **Pre Launch Build**: maven/gradle to prepare output before each start, none if the IDE already prepares it, or custom for your own VS Code task. Apply Setup after changing settings.
5. Press **F5** and select **Happy Spring Tomcat - Debug**.

Keep Java language support and the Java debugger enabled. Configure the Java environment used by Tomcat's startup script for your project and Tomcat version. Run Setup again after changing runtime settings.

### Upgrading from 1.1.1

Remove `docBase`, `sourceBase`, `classesBase`, and `preventDuplicateClasses` from your settings. Select the new paths below and run Setup with Tomcat stopped. Old setting names are no longer read.

Setup restores an old `classes-backup` only when the original directory is absent. It never overwrites an existing build.

## Changes during debugging

| Change | How it takes effect |
| --- | --- |
| JSP, CSS, JavaScript, images | Read directly from the web source folder. Refresh the browser; Tomcat recompiles changed JSPs. |
| Java method implementation | The Java extensions compile and apply Hot Code Replace during debugging. |
| Class structure or changes rejected by Hot Code Replace | Compile and restart Tomcat. |
| Spring XML, properties, filter configuration | Process resources into the classes folder, then restart Tomcat. |
| Dependency JARs | Rebuild the web application and restart Tomcat. |

For automatic Java replacement, set `java.debug.settings.hotCodeReplace` to `auto` and keep `java.autobuild.enabled` enabled. This extension leaves those settings under your control. See the [Java debugger documentation](https://code.visualstudio.com/docs/java/java-debugging#_hot-code-replace).

A directory mapping does not compile Java or refresh an initialized Spring context. Ordinary source changes do not require `mvn install`; after the initial build, Java compilation and resource processing are enough when dependencies and generated web content are unchanged.

## Web application paths

Settings use the `happySpringTomcat.` prefix. Relative paths resolve from the project folder; `${workspaceFolder}` is supported.

| Settings label | Key | Default | Purpose |
| --- | --- | --- | --- |
| Built Web App Directory | `builtWebAppDirectory` | `""` (auto-detect) | Built application containing `WEB-INF/lib`, e.g. `${workspaceFolder}/target/exploded`. Supplies dependency JARs and built `META-INF/context.xml`. Setup detects candidates when empty or when the folder is missing. |
| Web Source Directory | `webSourceDirectory` | `${workspaceFolder}/src/main/webapp` | JSP, static files, and `WEB-INF/web.xml`. This is the web root, not Java sources. |
| Classes Directory | `classesDirectory` | `${workspaceFolder}/target/classes` | Compiled classes and processed XML/properties. |
| Resources Directory | `resourcesDirectory` | `""` | Optional separate processed resource output, e.g. `${workspaceFolder}/build/resources/main` for Gradle. Leave empty when resources share Classes Directory. |
| Context Path | `contextPath` | `""` | URL path. Empty or `/` serves the root; `/my-app` serves that path. |

For a conventional Maven project, select the built application and keep the source/class defaults. Custom build layouts can use different paths.

Setup searches inside `target`, `build`, `out`, and `bin` for directories containing `WEB-INF/lib`. The directory can be named `exploded`, `ROOT`, or the application's name. Hidden folders, compiler outputs, dependency folders, and directory links are skipped. Select a directory manually for other layouts.

A compressed `.war` file is not required. Library JARs belong in the web application's dependencies; executable Spring Boot JARs that start their own server are outside this extension's external Tomcat workflow.

Tomcat uses the web source folder as its document root, mounts compiler output once at `/WEB-INF/classes`, and reads JARs from the built application. Start/Stop does not move build directories. The mapped layout excludes the built application’s WEB-INF/classes, so it does not load a second copy of compiler output.

For WAR overlays or generated web files, leave `webSourceDirectory`, `classesDirectory`, and `resourcesDirectory` empty to use the built application in full. Your build tool must then keep it up to date. Setup reports conflicting class mappings or custom `<Resources>` definitions.

## Build before starting

Choose **Pre Launch Build** (`preLaunchBuild`), then run Setup:

| Value | Preparation |
| --- | --- |
| `none` (default) | No build. The IDE or user prepares classes/resources. |
| `maven` | `compile -DskipTests` for mapped output; `package -DskipTests` for a complete built webapp. Maven processes resources as part of the lifecycle. |
| `gradle` | `classes` for mapped output, including resource processing. For a complete built webapp, build the WAR and sync its contents into the selected folder. |
| `custom` | Run the existing VS Code task named in **Custom Build Task** (`customBuildTask`). |

F5 runs **stop Tomcat → selected build → start Tomcat**. A failed build stops dependent startup. Maven/Gradle wrappers are preferred. Extension-owned tasks are regenerated; existing user tasks such as `Maven Build` are left unchanged. Select custom to use one of them. Save changes before starting.

The selected build runs against the project configuration. Directory settings tell Tomcat where to read output; they do not change Maven/Gradle output locations. Match them to your build and IDE configuration. No extra output-query or validation task runs.

For standard Gradle output, set Classes Directory to `${workspaceFolder}/build/classes/java/main` and Resources Directory to `${workspaceFolder}/build/resources/main`. These paths apply in every build mode. Use the project JDK/Gradle version appropriate for your application (integration-tested with Gradle 8.12.1).

Maven `compile` includes resource processing and Java compilation. It does not run `clean` or necessarily recompile everything, but Maven startup has a cost. If the IDE already prepares both outputs, choose none. If only Maven resource processing is needed, use custom with a task that runs `mvn process-resources`.

For complete built applications, leave Web Source Directory, Classes Directory, and Resources Directory empty. Maven must produce the selected unpacked webapp. Gradle requires the war plugin and a separate destination under its build directory, such as `build/exploded`; that destination is synchronized to the WAR, including removal of obsolete files. It cannot overlap class/resource/source directories or contain the WAR archive. This full-webapp Gradle helper requires Gradle 6.6+ and disables configuration caching for its invocation. The ordinary classes task uses the project’s normal cache settings.

Custom Build Task is a **VS Code task label**, not a shell command. For example, define this task in `.vscode/tasks.json`, choose custom, and set Custom Build Task to `Local Maven Build`:

```json
{
  "label": "Local Maven Build",
  "type": "shell",
  "command": "mvn",
  "args": ["compile", "-Plocal"]
}
```

Custom tasks must finish and prepare the selected output directories. Cyclic dependencies and background tasks are rejected during Setup.

After dependency changes or `clean`, rebuild the webapp's `WEB-INF/lib`. Compile/classes alone do not refresh those dependency JARs. Hot Code Replace remains the Java debugger's responsibility; ensure the IDE updates the runtime class output. Spring XML/properties require a Tomcat restart.

## Other settings

| Key | Default | Purpose |
| --- | --- | --- |
| `tomcatHome` | `""` | Tomcat installation, selected during Setup. |
| `httpPort` | `8080` | Local HTTP port. |
| `debugPort` | `8000` | Java attach port; must differ from HTTP. |
| `javaOpts` | UTF-8 options | JVM arguments through JAVA_OPTS. |
| `colorizeLogs` | `true` | Color terminal logs by level. |
| `autoOpenBrowser` | `true` | Open the URL when HTTP accepts connections. This does not verify Spring startup. |
| `showStatusBar` | `true` | Show the Tomcat menu in the status bar. |
| `jndiResources` | `[]` | JNDI Resource definitions. |

The managed runtime uses one local HTTP connector; installation AJP/HTTPS connectors are not enabled. Setup preserves unrelated tasks, launch configurations, custom Java debugger options, and runtime logging edits.

### JNDI

Use `jndiResources` when local debugging needs an additional DataSource or different DB connection settings without editing the project's context.xml. Leave the default `[]` when that file already provides everything needed.

Add this Oracle/DBCP2 example to `settings.json`, replacing the resource name, URL, and credentials for your application:

```json
{
  "happySpringTomcat.jndiResources": [
    {
      "name": "jdbc/myDB",
      "auth": "Container",
      "type": "javax.sql.DataSource",
      "factory": "org.apache.tomcat.dbcp.dbcp2.BasicDataSourceFactory",
      "driverClassName": "oracle.jdbc.OracleDriver",
      "url": "jdbc:oracle:thin:@localhost:1521:ORCL",
      "username": "YOUR_DB_USER",
      "password": "YOUR_DB_PASSWORD",
      "maxTotal": 20,
      "maxIdle": 5,
      "maxWaitMillis": 10000
    }
  ]
}
```

The application must look up the matching name (`java:comp/env/jdbc/myDB` here). Make the JDBC driver JAR available to Tomcat, for example in Tomcat Home's `lib` directory. Run **Apply Debug Setup** and restart Tomcat after editing. See the [Tomcat JNDI DataSource guide](https://tomcat.apache.org/tomcat-8.5-doc/jndi-datasource-examples-howto.html).

Setup includes child elements from the built application's `META-INF/context.xml`, falling back to the web source copy. Attributes on the outer `<Context>` are not copied.

A same-named entry in `jndiResources` replaces the entire Resource definition, so supply all required attributes. Duplicate names within settings are rejected. Tomcat's DBCP2 pool uses `maxTotal` and `maxWaitMillis`; custom factory attributes are accepted.

## Maintenance

Use the status bar menu or Command Palette to restart Tomcat, clear cache, view logs, or remove the project runtime.

- **View Logs** lets you select a file. For filter startup failures, inspect the matching `localhost.YYYY-MM-DD.log` for the actual exception.
- **Clear Cache** requires Tomcat to be stopped.
- **Remove Project Runtime** stops Tomcat and removes generated runtime files and configuration. It preserves the project, build output, settings, and Tomcat installation.
- After **Reload Window**, stop an existing Tomcat task before starting it again.

## Development

Run `npm test` to compile and test. Set `HST_TEST_TOMCAT_HOME`, `HST_TEST_MAVEN`, and `HST_TEST_GRADLE` to enable integration tests using local Tomcat, Maven, and Gradle. Tests use temporary projects and runtimes.

Run `npm run package` to build a VSIX.
