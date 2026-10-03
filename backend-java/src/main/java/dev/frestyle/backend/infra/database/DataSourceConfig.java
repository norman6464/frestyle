package dev.frestyle.backend.infra.database;

import com.zaxxer.hikari.HikariDataSource;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class DataSourceConfig {

    // HikariDataSource は最初の利用時に接続するため DB 停止中でも起動でき health が 503 を返せる
    @Bean
    @ConfigurationProperties("spring.datasource.hikari")
    public HikariDataSource dataSource(@Value("${DATABASE_URL}") String databaseUrl) {
        PgUrl pgUrl = PgUrl.fromUrl(databaseUrl);

        HikariDataSource dataSource = new HikariDataSource();
        dataSource.setJdbcUrl(pgUrl.jdbcUrl());
        dataSource.setUsername(pgUrl.user());
        dataSource.setPassword(pgUrl.password());

        return dataSource;
    }
}
