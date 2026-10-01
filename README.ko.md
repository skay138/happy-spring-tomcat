# Happy Spring Tomcat for VS Code

한국어 | [English](README.md)

레거시 Spring 웹 애플리케이션을 로컬 Tomcat에서 디버깅하는 확장입니다. 프로젝트 런타임, 시작·종료 task, Java 디버거 연결 설정을 생성합니다.

## 시작하기

1. VS Code에서 프로젝트 폴더를 엽니다. 창 하나당 프로젝트 하나를 사용합니다.
2. 프로젝트의 웹앱 빌드를 한 번 실행하여 의존 JAR, 클래스, 리소스가 있는 압축이 풀린 웹앱 디렉터리를 준비합니다.
3. **Happy Spring Tomcat: 디버깅 설정 적용**을 실행합니다. 안내에 따라 Tomcat 설치 폴더와 빌드된 웹앱 폴더를 선택합니다.
4. **Pre Launch Build**를 선택합니다. 시작 전 출력을 준비하려면 maven/gradle, IDE가 이미 준비하면 none, 기존 VS Code task를 쓰려면 custom입니다. 설정을 변경하면 Setup을 다시 적용하세요.
5. **F5**를 누르고 **Happy Spring Tomcat - Debug**를 선택합니다.

Java 언어 지원과 디버거를 활성화하세요. Tomcat 시작 스크립트가 사용하는 Java 환경은 프로젝트와 Tomcat 버전에 맞춰 구성해야 합니다. 런타임 설정을 변경하면 Setup을 다시 실행하세요.

### 1.1.1에서 업데이트할 때

기존 settings에서 `docBase`, `sourceBase`, `classesBase`, `preventDuplicateClasses`를 제거하세요. 아래의 새 경로를 설정하고 Tomcat을 중지한 상태에서 Setup을 실행합니다. 이전 설정 이름은 더 이상 읽지 않습니다.

이전 버전의 `classes-backup`은 원래 폴더가 없을 때만 복원합니다. 이미 새 빌드가 있으면 덮어쓰지 않습니다.

## 디버깅 중 변경 반영

| 변경 내용 | 반영 방법 |
| --- | --- |
| JSP, CSS, JavaScript, 이미지 | 웹 소스 폴더에서 직접 읽습니다. 브라우저를 새로고침하면 변경된 JSP는 Tomcat이 다시 컴파일합니다. |
| Java 메서드 구현 | Java 확장이 컴파일한 뒤 디버깅 중 Hot Code Replace로 반영합니다. |
| 클래스 구조 또는 Hot Code Replace가 거부한 변경 | 컴파일 후 Tomcat을 재시작합니다. |
| Spring XML, properties, 필터 설정 | 클래스 출력 폴더에 리소스를 반영한 뒤 Tomcat을 재시작합니다. |
| 의존 JAR | 웹앱을 다시 빌드한 뒤 Tomcat을 재시작합니다. |

Java 변경을 자동 반영하려면 `java.debug.settings.hotCodeReplace`를 `auto`로 설정하고 `java.autobuild.enabled`를 활성화하세요. 이 확장은 사용자의 Java 설정을 변경하지 않습니다. [Java 디버거 공식 문서](https://code.visualstudio.com/docs/java/java-debugging#_hot-code-replace)를 참고하세요.

폴더 연결만으로 Java가 컴파일되거나 초기화된 Spring 컨텍스트가 갱신되지는 않습니다. 일반적인 소스 수정마다 `mvn install`을 실행할 필요는 없습니다. 최초 빌드 후 의존성이나 생성되는 웹 파일이 바뀌지 않았다면 Java 컴파일과 리소스 처리로 준비할 수 있습니다.

## 웹 애플리케이션 경로

아래 설정에는 `happySpringTomcat.` 접두사가 붙습니다. 상대 경로는 프로젝트 폴더 기준이며 `${workspaceFolder}`도 사용할 수 있습니다.

| Settings 표시 이름 | 설정 키 | 기본값 | 용도 |
| --- | --- | --- | --- |
| Built Web App Directory | `builtWebAppDirectory` | `""` (자동 탐색) | `WEB-INF/lib`가 있는 빌드된 웹앱입니다. 예: `${workspaceFolder}/target/exploded`. 의존 JAR와 빌드된 `META-INF/context.xml`을 제공합니다. 빈 값이거나 지정한 폴더가 없으면 Setup에서 탐색합니다. |
| Web Source Directory | `webSourceDirectory` | `${workspaceFolder}/src/main/webapp` | JSP·정적 파일·`WEB-INF/web.xml`이 있는 웹 루트입니다. Java 소스 폴더와 구분됩니다. |
| Classes Directory | `classesDirectory` | `${workspaceFolder}/target/classes` | 컴파일된 클래스와 빌드 처리된 XML·properties가 있는 출력 폴더입니다. |
| Resources Directory | `resourcesDirectory` | `""` | 처리된 리소스가 별도 출력 폴더에 있을 때 지정합니다. Gradle 예: `${workspaceFolder}/build/resources/main`. Classes Directory에 함께 출력되면 비워둡니다. |
| Context Path | `contextPath` | `""` | 웹앱 URL 경로입니다. 빈 값이나 `/`는 루트, `/my-app`은 해당 경로로 실행합니다. |

일반적인 Maven 프로젝트는 빌드된 웹앱만 선택하고 소스·클래스 경로는 기본값을 사용하면 됩니다. 빌드 구조가 다르면 각 경로를 조정하세요.

Setup은 `target`, `build`, `out`, `bin` 아래에서 `WEB-INF/lib`가 있는 폴더를 탐색합니다. 폴더 이름은 `exploded`, `ROOT`, 앱 이름 등 어느 것이어도 됩니다. 숨김 폴더, 클래스 출력, 의존성 폴더, 디렉터리 링크는 건너뜁니다. 다른 구조는 직접 폴더를 선택하세요.

압축된 `.war` 파일을 만들 필요는 없습니다. 일반 JAR는 웹앱의 의존 라이브러리로 사용합니다. 자체 서버를 실행하는 Spring Boot 실행형 JAR는 이 확장의 외부 Tomcat 실행 대상에 해당하지 않습니다.

Tomcat은 웹 소스 폴더를 문서 루트로 사용하고, 컴파일 출력을 `/WEB-INF/classes`에 한 번 연결하며, 의존 JAR는 빌드된 웹앱에서 읽습니다. 시작·종료할 때 빌드 폴더를 이동하지 않습니다. 이 구성에서는 빌드된 웹앱의 WEB-INF/classes를 함께 연결하지 않으므로 컴파일 출력을 두 번 읽지 않습니다.

WAR overlay나 빌드로 생성되는 웹 파일이 필요하면 `webSourceDirectory`·`classesDirectory`·`resourcesDirectory`를 모두 빈 값으로 설정하여 빌드된 웹앱 전체를 사용하세요. 이 경우 빌드 도구가 웹앱을 갱신해야 합니다. 클래스 경로 중복이나 기존 `<Resources>`와의 충돌은 Setup에서 알려줍니다.

## 시작 전 빌드

**Pre Launch Build**(`preLaunchBuild`)를 선택한 뒤 Setup을 실행합니다.

| 값 | 준비 작업 |
| --- | --- |
| `none` (기본값) | 빌드하지 않습니다. IDE나 사용자가 클래스·리소스를 준비합니다. |
| `maven` | 클래스 출력 연결 시 `compile -DskipTests`, 빌드된 웹앱 전체 사용 시 `package -DskipTests`를 실행합니다. 리소스 처리는 Maven 빌드 단계에 포함됩니다. |
| `gradle` | 클래스 출력 연결 시 리소스 처리를 포함하는 `classes`를 실행합니다. 웹앱 전체 사용 시 WAR를 만들고 선택한 폴더에 압축을 풀어 동기화합니다. |
| `custom` | **Custom Build Task**(`customBuildTask`)에 지정한 기존 VS Code task를 실행합니다. |

F5는 **Tomcat 중지 → 선택한 빌드 → Tomcat 시작** 순서로 실행합니다. 빌드가 실패하면 종속된 시작 작업은 진행하지 않습니다. Maven/Gradle Wrapper를 우선 사용합니다. 확장 전용 task는 Setup에서 다시 생성하며, 기존 `Maven Build` 같은 사용자 task는 수정하지 않습니다. 기존 task를 사용하려면 custom을 선택하세요. 실행 전 변경 파일을 저장하세요.

선택한 빌드는 프로젝트의 빌드 설정을 따릅니다. Directory 설정은 Tomcat이 출력을 읽을 위치이며 Maven·Gradle의 출력 위치를 변경하지 않습니다. 빌드 도구와 IDE의 실제 출력 경로에 맞춰 지정하세요. 출력 조회나 검증용 task는 추가 실행하지 않습니다.

일반적인 Gradle 프로젝트는 Classes Directory를 `${workspaceFolder}/build/classes/java/main`, Resources Directory를 `${workspaceFolder}/build/resources/main`으로 설정합니다. 빌드 모드에 관계없이 이 경로를 사용합니다. 프로젝트에 맞는 JDK·Gradle 버전을 사용하세요(통합 테스트: Gradle 8.12.1).

Maven `compile`은 리소스 처리와 Java 컴파일을 포함합니다. `clean`이나 전체 재컴파일을 항상 실행하는 것은 아니지만 Maven 기동 비용은 있습니다. IDE가 두 출력을 이미 준비하면 none을 선택하세요. Maven 리소스 처리만 필요하면 custom에서 `mvn process-resources`를 실행하는 task를 지정하면 됩니다.

빌드된 웹앱 전체를 사용할 때는 Web Source Directory·Classes Directory·Resources Directory를 모두 비웁니다. Maven은 선택한 압축 해제 웹앱을 실제로 생성해야 합니다. Gradle은 war 플러그인이 필요하며, `build/exploded`처럼 build 디렉터리 안의 별도 폴더를 선택해야 합니다. 이 폴더는 WAR와 동기화하므로 불필요해진 파일도 제거됩니다. 클래스·리소스·소스 폴더와 겹치거나 WAR 파일 자체를 포함하는 경로는 허용하지 않습니다. 웹앱 전체를 준비하는 Gradle 보조 작업은 Gradle 6.6 이상이 필요하며 해당 실행에서 configuration cache를 끕니다. 일반 classes 작업은 프로젝트의 캐시 설정을 그대로 사용합니다.

Custom Build Task에는 **셸 명령이 아닌 VS Code task 이름**을 입력합니다. 예를 들어 `.vscode/tasks.json`에 아래 작업을 정의하고, custom을 선택한 뒤 Custom Build Task에 `로컬 Maven 빌드`를 지정합니다.

```json
{
  "label": "로컬 Maven 빌드",
  "type": "shell",
  "command": "mvn",
  "args": ["compile", "-Plocal"]
}
```

사용자 task는 종료되어야 하며 설정한 디렉터리에 필요한 출력을 준비해야 합니다. 순환 의존성과 백그라운드 작업은 Setup에서 거부합니다.

의존성 변경이나 `clean` 후에는 웹앱을 다시 빌드하여 `WEB-INF/lib`를 준비하세요. compile/classes만으로 의존 JAR가 갱신되지는 않습니다. Hot Code Replace는 Java 디버거가 담당하며 IDE도 실행 클래스 경로를 갱신해야 합니다. Spring XML·properties 변경은 Tomcat 재시작이 필요합니다.

## 나머지 설정

| 키 | 기본값 | 용도 |
| --- | --- | --- |
| `tomcatHome` | `""` | Tomcat 설치 경로입니다. Setup에서 선택할 수 있습니다. |
| `httpPort` | `8080` | 로컬 HTTP 포트입니다. |
| `debugPort` | `8000` | Java 디버거 연결 포트입니다. HTTP 포트와 달라야 합니다. |
| `javaOpts` | UTF-8 옵션 | JAVA_OPTS로 전달할 JVM 인자입니다. |
| `colorizeLogs` | `true` | 터미널 로그를 레벨에 따라 색상으로 표시합니다. |
| `autoOpenBrowser` | `true` | HTTP 포트에 연결되면 URL을 엽니다. Spring 초기화 성공 여부까지 확인하지는 않습니다. |
| `showStatusBar` | `true` | 상태 표시줄에 Tomcat 메뉴를 표시합니다. |
| `jndiResources` | `[]` | JNDI Resource 정의입니다. |

프로젝트 런타임에는 로컬 HTTP 커넥터 하나를 사용합니다. 설치 폴더의 AJP·HTTPS 커넥터는 활성화하지 않습니다. 다른 task, 디버그 구성, 사용자가 추가한 Java 디버거 옵션, 런타임 로깅 설정은 유지합니다.

### JNDI

프로젝트의 context.xml을 수정하지 않고 로컬 디버깅용 DataSource를 추가하거나 DB 접속 정보를 바꿀 때 사용합니다. 기존 파일에 필요한 설정이 모두 있으면 기본값 `[]`로 두면 됩니다.

아래 Oracle/DBCP2 예시를 `settings.json`에 넣고 리소스 이름·URL·계정을 프로젝트에 맞게 바꾸세요.

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

앱에서 조회하는 이름도 일치해야 합니다(위 예시: `java:comp/env/jdbc/myDB`). JDBC 드라이버 JAR는 Tomcat에서 읽을 수 있는 위치에 준비하세요(예: Tomcat 설치 폴더의 `lib`). 수정 후 **디버깅 설정 적용**을 실행하고 Tomcat을 재시작합니다. [Tomcat JNDI DataSource 공식 문서](https://tomcat.apache.org/tomcat-8.5-doc/jndi-datasource-examples-howto.html)도 참고하세요.

빌드된 웹앱의 `META-INF/context.xml` 내부 요소를 포함하며, 없으면 웹 소스 폴더의 파일을 사용합니다. 바깥 `<Context>` 태그의 속성은 복사하지 않습니다.

`jndiResources`에 같은 이름이 있으면 Resource 정의 전체를 대체하므로 필요한 속성을 모두 적어야 합니다. settings 안의 중복 이름은 오류로 안내합니다. Tomcat DBCP2 풀은 `maxTotal`·`maxWaitMillis`를 사용하며 별도 factory의 속성도 허용합니다.

## 관리와 문제 해결

상태 표시줄 메뉴나 명령 팔레트에서 재시작, 캐시 삭제, 로그 보기, 프로젝트 런타임 제거를 실행할 수 있습니다.

- **로그 보기**에서 파일을 선택할 수 있습니다. 필터 시작 실패 시 해당 날짜의 `localhost.YYYY-MM-DD.log`에서 상세 예외를 확인하세요.
- **캐시 삭제**는 Tomcat이 중지된 상태에서 실행합니다.
- **프로젝트 런타임 제거**는 Tomcat을 중지한 뒤 확장이 만든 런타임과 구성을 제거합니다. 프로젝트, 빌드 산출물, settings, Tomcat 설치 폴더는 유지합니다.
- **Reload Window** 후에는 기존 Tomcat task를 종료한 뒤 다시 시작하세요.

## 개발

`npm test`로 컴파일과 테스트를 실행합니다. `HST_TEST_TOMCAT_HOME`·`HST_TEST_MAVEN`·`HST_TEST_GRADLE`을 지정하면 로컬 Tomcat·Maven·Gradle 통합 테스트도 실행합니다. 테스트는 임시 프로젝트와 런타임을 사용합니다.

`npm run package`로 VSIX를 생성합니다.
