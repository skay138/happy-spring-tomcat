# Happy Spring Tomcat for VS Code

[한국어](README.ko.md) | English

An extension that automatically configures a Tomcat debugging environment for Spring projects in VS Code.

## Features ✨

| Feature | Description |
|---|---|
| ⚡ **One-click Setup** | Generate all scripts and config files with a single `Apply Debug Setup` command |
| 🧠 **Auto docBase Detection** | Automatically detect build output path based on `WEB-INF/lib` |
| 🔨 **Build Integration** | Optionally run Maven/Gradle build before starting Tomcat |
| 🎨 **Log Colorization** | Level-aware highlighting with readable stack traces and a long-line performance safeguard |
| 🔥 **Hot Reload** | Configure PreResources for live reload of static files and classes |

## Usage 🚀

1. Open your project folder in VS Code.
2. Press `Ctrl+Shift+P` → run **`Happy Spring Tomcat: Apply Debug Setup`**.
3. On first run, select your **Tomcat Home directory**.
4. Press `F5` → choose **`Happy Spring Tomcat - Debug`** to start the server and attach the debugger.

## Settings ⚙️

### Server
| Setting | Default | Description |
|---|---|---|
| `tomcatHome` | `""` | Tomcat installation path (prompts on Setup if empty) |
| `httpPort` | `8080` | HTTP port |
| `debugPort` | `8000` | JPDA debug port |
| `preLaunchBuild` | `"none"` | Pre-launch build: `none` / `maven` / `gradle` |
| `javaOpts` | UTF-8 encoding | JVM arguments |
| `colorizeLogs` | `true` | Enable level-aware terminal colors; very long lines bypass matching to protect throughput |
| `autoOpenBrowser` | `true` | Auto-open browser after startup |
| `showStatusBar` | `true` | Show status bar shortcut menu |

### Context / Deployment
| Setting | Default | Description |
|---|---|---|
| `contextPath` | `""` | Context path (e.g. `/`, `/my-app`) |
| `docBase` | `target/exploded` | Webapp root directory (auto-detection supported) |

### Hot Reload
| Setting | Default | Description |
|---|---|---|
| `sourceBase` | `src/main/webapp` | JSP/static file source path |
| `classesBase` | `target/classes` | Compiled output path |
| `preventDuplicateClasses` | `true` | Prevents Spring from loading `classpath*:` configs twice when both docBase and `classesBase` provide `WEB-INF/classes`. While Tomcat runs, the start script temporarily moves docBase's directory to `<build output>/.happy-spring-tomcat/classes-backup` using a same-volume rename. It is restored when Catalina exits or the Stop task runs; macOS/Linux also restores on `EXIT`/`INT`/`TERM`. If no safe `target`/`build`/`out` location is available, protection is skipped with a warning. |

### JNDI
- `jndiResources`: Array of JNDI DataSource definitions (edit directly in `settings.json`).
- Child elements inside `META-INF/context.xml`'s `<Context>` are **included automatically**. Attributes on the `<Context>` element itself are not copied.

## Troubleshooting

### After Reload Window

After **Reload Window**, terminate the existing Tomcat task and run **Start Happy Tomcat** again.

---
**Happy Debugging!** 🚀
