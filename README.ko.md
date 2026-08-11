# Happy Spring Tomcat for VS Code

한국어 | [English](README.md)

VS Code에서 Tomcat 프로젝트 디버깅 환경을 자동으로 구성해주는 익스텐션입니다.

## 주요 기능 ✨

| 기능 | 설명 |
|---|---|
| ⚡ **한 번에 Setup** | `Apply Debug Setup` 명령 하나로 스크립트·설정 파일 전체 생성 |
| 🧠 **docBase 자동 감지** | `WEB-INF/lib` 기반으로 빌드 결과물 경로 자동 탐지 |
| 🔨 **빌드 연동** | Tomcat 시작 전 Maven/Gradle 빌드 자동 실행 옵션 |
| 🎨 **로그 색상화** | 로그 레벨 우선 색상화, 읽기 쉬운 스택 트레이스, 긴 라인 성능 보호 |
| 🔥 **핫 리로드** | 정적 파일, 클래스 실시간 반영을 위한 PreResources 설정 |

## 사용 방법 🚀

1. VS Code에서 프로젝트 폴더를 엽니다.
2. `Ctrl+Shift+P` → **`Happy Spring Tomcat: Apply Debug Setup`** 실행.
3. 최초 실행 시 **Tomcat Home 디렉토리**를 선택합니다.
4. `F5` → **`Happy Spring Tomcat - Debug`** 로 서버 시작 + 디버거 연결.

## 설정 항목 ⚙️

### 서버
| 설정 | 기본값 | 설명 |
|---|---|---|
| `tomcatHome` | `""` | Tomcat 설치 경로 (비어있으면 Setup 시 선택 창 오픈) |
| `httpPort` | `8080` | HTTP 포트 |
| `debugPort` | `8000` | JPDA 디버그 포트 |
| `preLaunchBuild` | `"none"` | 시작 전 빌드: `none` / `maven` / `gradle` |
| `javaOpts` | UTF-8 인코딩 | JVM 아규먼트 |
| `colorizeLogs` | `true` | 레벨 기반 터미널 색상화 활성화. 매우 긴 라인은 처리량 보호를 위해 매칭을 건너뜁니다. |
| `autoOpenBrowser` | `true` | 기동 후 브라우저 자동 오픈 |
| `showStatusBar` | `true` | 상태바 단축 메뉴 표시 |

### Context / 배포
| 설정 | 기본값 | 설명 |
|---|---|---|
| `contextPath` | `""` | 컨텍스트 경로 (예: `/`, `/my-app`) |
| `docBase` | `target/exploded` | 웹앱 루트 디렉토리 (자동 감지 지원) |

### 핫 리로드
| 설정 | 기본값 | 설명 |
|---|---|---|
| `sourceBase` | `src/main/webapp` | JSP/정적 파일 소스 경로 |
| `classesBase` | `target/classes` | 컴파일 출력 경로 |
| `preventDuplicateClasses` | `true` | docBase와 `classesBase`가 모두 `WEB-INF/classes`를 제공할 때 Spring이 `classpath*:` 설정을 두 번 읽는 문제를 방지합니다. Tomcat 실행 중에는 시작 스크립트가 docBase의 디렉터리를 같은 볼륨의 `<빌드 산출 폴더>/.happy-spring-tomcat/classes-backup`으로 임시 이동(rename)합니다. Catalina가 종료되거나 Stop task가 실행되면 복구하며, macOS/Linux에서는 `EXIT`/`INT`/`TERM` 신호에도 복구합니다. 안전한 `target`/`build`/`out` 위치가 없으면 경고 후 보호를 건너뜁니다. |

### JNDI
- `jndiResources`: JNDI DataSource 배열 (settings.json에서 직접 편집).
- `META-INF/context.xml`의 `<Context>` 내부 항목은 **자동으로 포함**됩니다. `<Context>` 태그 자체의 속성은 복사하지 않습니다.

## 문제 해결

### Reload Window 이후

VS Code에서 **Reload Window**를 실행한 뒤에는 기존 Tomcat task를 종료하고 **Start Happy Tomcat**을 다시 실행하세요.

---
**Happy Debugging!** 🚀
