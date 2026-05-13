# Happy Spring Tomcat for VS Code

[한국어](README.ko.md) | English

An extension that automatically configures a Tomcat debugging environment for Spring projects in VS Code.

## Features ✨

| Feature | Description |
|---|---|
| ⚡ **One-click Setup** | Generate all scripts and config files with a single `Apply Debug Setup` command |
| 🧠 **Auto docBase Detection** | Automatically detect build output path based on `WEB-INF/lib` |
| 🔨 **Build Integration** | Optionally run Maven/Gradle build before starting Tomcat |
| 🎨 **Log Colorization** | Highlight log output by level (INFO/WARN/ERROR/SQL, etc.) |
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
| `colorizeLogs` | `true` | Enable terminal log colorization |
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

### JNDI
- `jndiResources`: Array of JNDI DataSource definitions (edit directly in `settings.json`).
- `<Resource>` tags from `META-INF/context.xml` are **merged automatically**.

---
**Happy Debugging!** 🚀
