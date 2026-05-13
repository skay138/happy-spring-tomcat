# Changelog

All notable changes to "Happy Spring Tomcat" will be documented in this file.

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
