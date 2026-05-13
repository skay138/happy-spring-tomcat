# Happy Spring Tomcat for VS Code

한국어 | [English](README.md)

VS Code에서 Tomcat 프로젝트 디버깅 환경을 자동으로 구성해주는 익스텐션입니다.

## 주요 기능 ✨

| 기능 | 설명 |
|---|---|
| ⚡ **한 번에 Setup** | `Apply Debug Setup` 명령 하나로 스크립트·설정 파일 전체 생성 |
| 🧠 **docBase 자동 감지** | `WEB-INF/lib` 기반으로 빌드 결과물 경로 자동 탐지 |
| 🔨 **빌드 연동** | Tomcat 시작 전 Maven/Gradle 빌드 자동 실행 옵션 |
| 🎨 **로그 색상화** | 레벨별(INFO/WARN/ERROR/SQL 등) 색상 하이라이팅 |
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
| `colorizeLogs` | `true` | 터미널 로그 색상 활성화 여부 |
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

### JNDI
- `jndiResources`: JNDI DataSource 배열 (settings.json에서 직접 편집).
- `META-INF/context.xml`의 `<Resource>` 태그는 **자동으로 병합**됩니다.

---
**Happy Debugging!** 🚀
