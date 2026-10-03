package dev.frestyle.backend.adapter.persistence;

import dev.frestyle.backend.usecase.repository.HealthRepository;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
public class JdbcHealthRepository implements HealthRepository {

    private final JdbcClient jdbc;

    public JdbcHealthRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public void pingDb() {
        jdbc.sql("SELECT 1").query(Integer.class).single();
    }
}
