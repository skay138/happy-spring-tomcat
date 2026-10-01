# Changelog

All notable changes to "Happy Spring Tomcat" will be documented in this file.

## [1.2.0] - 2026-10-01

- Replaced duplicate-class directory moves with Tomcat resource mappings for web sources, compiler/resource outputs, and built dependency JARs. Lifecycle scripts no longer move compiler output. Setup restores an old backup when Tomcat is stopped and the original directory is absent.
- Keep explicit Pre Launch Build choices: none (default), maven, gradle, and custom. Custom Build Task names an existing VS Code task. Maven uses compile for mapped output and package for complete webapps; Gradle uses classes or WAR plus exploded deployment. Preserve user tasks and IDE settings without adding output-query or validation tasks.
- Add optional Resources Directory for separate processed resources, including Gradle layouts. Directory settings map existing output and do not alter build-tool output locations.
- Renamed path settings to Built Web App Directory, Web Source Directory, and Classes Directory. Removed the old docBase/sourceBase/classesBase keys; configure the new paths and run Setup after upgrading.
- Default Built Web App Directory to automatic detection; use target/exploded consistently as an example, without requiring that directory name.
- Search build outputs asynchronously, skip directory links and hidden/generated folders, and share validation between detection and manual selection. Require real directories for WEB-INF/lib and the platform's Tomcat launcher plus runtime files for Tomcat Home.
- Retired Prevent Duplicate Classes: the development layout excludes the built WEB-INF/classes when mapping compiler output. No deployment mode setting is required.
- Validate conflicting resource mappings, malformed XML/JSONC, and HTTP/debug ports before applying configuration. Preserve custom Java debug options and existing build tasks.
- JNDI settings replace same-named resources from META-INF/context.xml; duplicate names within settings are rejected. Updated pool attribute suggestions for DBCP2.
- Keep a single local HTTP connector without extra AJP/HTTPS connectors. Preserve runtime logging configuration and exclude other applications from the Tomcat installation.
- Wait for successful Stop task exit before restarting or removing a runtime. Stop before running a configured build. Cancel browser opening when debugging ends.
- Added a log picker including localhost logs for filter startup errors, plus regression tests with optional real Tomcat, Maven, and Gradle checks.
- **✨ Feature**: Added **Remove Project Runtime** to safely stop Tomcat and remove the current project's extension-managed runtime, logs, cache, generated scripts, tasks, and debug configuration. The Tomcat installation, build output, workspace settings, and unrelated VS Code configurations are preserved.
- **🐛 Fix**: Made log-level detection independent of timestamp layout so consecutive entries no longer inherit the previous entry's color when custom date/time formats are used.

## [1.1.1] - 2026-08-10

- **🐛 Fix**: Fixed duplicate Spring configuration loading when docBase already contains `WEB-INF/classes`. This prevents duplicate bean definitions and errors such as duplicate Spring Security filter chains. Added `happySpringTomcat.preventDuplicateClasses` (default: `true`) to control this behavior.
- **🐛 Fix**: Stabilized the Start / Restart / Stop lifecycle. The debugger now attaches as soon as JDWP starts listening, avoiding attach timeouts during slow application startup. Restart waits for previous debug and lifecycle tasks to finish before launching a replacement JVM.
- **🛡️ Process Safety**: Generated Stop scripts now terminate only the Tomcat process belonging to the current workspace runtime, identified by `catalina.base`. Processes merely sharing the configured port are left untouched.
- **🐛 Fix**: Preserved existing `tasks.json` and `launch.json` JSONC content. URLs are no longer mistaken for comments, and invalid JSONC is never silently replaced.
- **🛡️ Configuration Safety**: Improved generated Tomcat configuration handling. XML attributes and JNDI values are escaped, context paths are validated, and unrelated files under `conf/Catalina/localhost` are preserved.
- **🐛 Fix**: Improved docBase validation. Manual docBase selection now validates the folder structure and explains missing `WEB-INF` or `WEB-INF/lib` directories before saving.
- **🐛 Fix**: Fixed Windows `.bat` scripts when using Git Bash. Windows tasks now explicitly use `cmd.exe`, and generated batch scripts consistently use Windows path separators.
- **🐛 Fix**: Improved cross-platform log colorization with explicit-level precedence, clearer stack traces, and a long-line performance safeguard.
- **🐛 Fix**: Fixed setup cancellation and extension-initiated configuration updates. Cancelled setup no longer reports success, and configuration-change prompts are restored correctly.

## [1.1.0] - 2026-05-13

- **🌐 i18n**: Korean/English support for all notification messages (`vscode.l10n.t`) and Settings UI (`package.nls.json` / `package.nls.ko.json`).
- **📖 README**: Split into `README.md` (English) and `README.ko.md` (Korean) with language toggle links.
- **🏗️ Refactor**: `configWriter.ts` split into `lib/writers/` (serverXml, contextXml, scripts, vscodeConfig) and shared types extracted to `lib/types.ts`.

## [1.0.9] - 2026-05-13
- Fix: Unix 계열(Mac/Linux)에서 log colorize가 적용되지 않던 문제 수정

## [1.0.8] - 2026-04-06
- README.md Debug 설정 이름 불일치 수정

## [1.0.7] - 2026-04-06
- **⚡ 성능 최적화**: 일반 프로젝트(Python, Node.js 등)에서는 확장이 로드되지 않도록 개선.

## [1.0.6] - 2026-04-06
- **🔗 Java 디버거 자동 설치**: `vscjava.vscode-java-debug` 를 익스텐션 의존성으로 추가.

## [1.0.5] - 2026-04-06
- **🎯 Setup 성공 알림에 Start Tomcat 버튼 추가**.
- **🔄 Restart Tomcat**: 한 번에 재시작하는 `Restart Tomcat` 커맨드 추가.
- **🌍 크로스 플랫폼**: Mac/Linux용 `.sh` 스크립트 생성 및 `tasks.json` 플랫폼 분기 지원.
- **🔨 빌드 연동**: `preLaunchBuild` 설정으로 Tomcat 시작 전 Maven/Gradle 빌드 자동 실행.

## [1.0.4] - 2026-04-02
- **📁 Clean Search**: 로그/런타임 파일을 익스텐션 스토리지로 이동하여 전역 검색에서 제외.

## [1.0.3] - 2026-03-31
- **🧠 Smart docBase Detection**: `WEB-INF/lib` 기반 자동 감지 및 QuickPick 선택.
- **🚀 Status Bar Menu**: 상태바 로켓 아이콘으로 주요 명령 빠른 접근.
- **🌐 Auto-Open Browser**: 서버 시작 후 브라우저 자동 오픈.
- **⚙️ 새 커맨드**: `Open Settings`, `Clear Cache`, `View Latest Logs`.
- **🛡️ Tomcat Home 유효성 검사 및 포트 충돌 방지**.

## [1.0.1] - 2026-03-31
- **Happy Spring Tomcat** 으로 이름 변경, 마켓플레이스 최초 배포.
- 자동 스캐폴딩, 로그 색상화(PowerShell), JNDI, 핫 리로드, F5 디버깅 지원.
