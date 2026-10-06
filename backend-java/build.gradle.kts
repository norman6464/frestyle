plugins {
	java
	id("org.springframework.boot") version "4.1.1"
	id("io.spring.dependency-management") version "1.1.7"
}

group = "com.frestyle"
version = "0.0.1-SNAPSHOT"

java {
	toolchain {
		languageVersion = JavaLanguageVersion.of(21)
	}
}

repositories {
	mavenCentral()
}

dependencies {
	// 版は Spring Boot のプラグインがまとめて決めるので、ここには書かない

	// /health など運用向けのエンドポイントを提供する
	implementation("org.springframework.boot:spring-boot-starter-actuator")
	// DB への接続と接続プール（HikariCP）を提供する
	implementation("org.springframework.boot:spring-boot-starter-jdbc")
	// HTTP サーバー（Tomcat）と Spring MVC を提供する
	implementation("org.springframework.boot:spring-boot-starter-webmvc")
	// PostgreSQL の JDBC ドライバ
	// コードから直接は参照しないので、実行時だけ読み込む
	runtimeOnly("org.postgresql:postgresql")
	// JUnit、AssertJ、Mockito、Spring のテスト支援をまとめて入れる
	testImplementation("org.springframework.boot:spring-boot-starter-test")
	// Gradle がテストを起動するために必要
	testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.withType<Test> {
	useJUnitPlatform()
}
