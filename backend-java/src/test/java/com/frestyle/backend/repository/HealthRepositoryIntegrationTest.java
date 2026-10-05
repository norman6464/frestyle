package com.frestyle.backend.repository;

import static org.assertj.core.api.Assertions.assertThatCode;

import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.jdbc.test.autoconfigure.AutoConfigureTestDatabase;
import org.springframework.boot.jdbc.test.autoconfigure.JdbcTest;
import org.springframework.context.annotation.Import;

@Tag("integration")
@JdbcTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Import(HealthRepository.class)
class HealthRepositoryIntegrationTest {

    @Autowired
    private HealthRepository healthRepository;

    @Test
    void DBに届けば_例外を投げない() {
        assertThatCode(healthRepository::pingDb).doesNotThrowAnyException();
    }
}
