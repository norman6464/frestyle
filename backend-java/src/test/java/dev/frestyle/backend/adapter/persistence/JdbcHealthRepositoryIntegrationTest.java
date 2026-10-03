package dev.frestyle.backend.adapter.persistence;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.zaxxer.hikari.HikariDataSource;
import dev.frestyle.backend.infra.database.DataSourceConfig;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.simple.JdbcClient;

@Tag("integration")
class JdbcHealthRepositoryIntegrationTest {

    @Test
    void Integration_DB疎通_到達できれば例外を投げない() {
        String url = System.getenv("TEST_DATABASE_URL");
        if (url == null || url.isEmpty()) {
            throw new IllegalStateException("TEST_DATABASE_URL が未設定です。make test-integration で実行してください");
        }
        try (HikariDataSource ds = new DataSourceConfig().dataSource(url)) {
            JdbcHealthRepository repo = new JdbcHealthRepository(JdbcClient.create(ds));

            assertThatCode(repo::pingDb).doesNotThrowAnyException();
        }
    }

    @Test
    void Integration_DB疎通_到達できなければ例外を投げる() {
        String closedPort = "postgres://frestyle:frestyle@127.0.0.1:1/frestyle_integration?sslmode=disable";
        try (HikariDataSource ds = new DataSourceConfig().dataSource(closedPort)) {
            JdbcHealthRepository repo = new JdbcHealthRepository(JdbcClient.create(ds));

            assertThatThrownBy(repo::pingDb).isInstanceOf(DataAccessException.class);
        }
    }
}
