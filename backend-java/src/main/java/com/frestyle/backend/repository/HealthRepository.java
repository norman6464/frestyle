package com.frestyle.backend.repository;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
public class HealthRepository {

    private final JdbcClient jdbcClient;

    public HealthRepository(JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    public void pingDb() {
        jdbcClient.sql("SELECT 1").query(Integer.class).single();
    }
}
