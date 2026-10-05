package com.frestyle.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.BDDMockito.willThrow;
import static org.mockito.Mockito.mock;

import com.frestyle.backend.domain.HealthStatus;
import com.frestyle.backend.repository.HealthRepository;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;

class HealthServiceTest {

    private final HealthRepository healthRepository = mock(HealthRepository.class);
    private final HealthService healthService = new HealthService(healthRepository);

    @Test
    void DBに届けば_UPを返す() {
        assertThat(healthService.check()).isEqualTo(HealthStatus.UP);
    }

    @Test
    void DBに届かなければ_DOWNを返す() {
        willThrow(new DataAccessResourceFailureException("ping failed")).given(healthRepository).pingDb();

        assertThat(healthService.check()).isEqualTo(HealthStatus.DOWN);
    }

    @Test
    void DB以外の例外は_握りつぶさない() {
        willThrow(new IllegalStateException("bug")).given(healthRepository).pingDb();

        assertThatThrownBy(healthService::check).isInstanceOf(IllegalStateException.class);
    }
}
