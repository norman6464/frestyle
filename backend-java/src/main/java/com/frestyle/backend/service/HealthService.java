package com.frestyle.backend.service;

import com.frestyle.backend.domain.HealthStatus;
import com.frestyle.backend.repository.HealthRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Service;

@Service
public class HealthService {

    private static final Logger log = LoggerFactory.getLogger(HealthService.class);

    private final HealthRepository healthRepository;

    public HealthService(HealthRepository healthRepository) {
        this.healthRepository = healthRepository;
    }

    public HealthStatus check() {
        try {
            healthRepository.pingDb();
        } catch (DataAccessException e) {
            log.warn("DB 疎通に失敗", e);
            return HealthStatus.DOWN;
        }

        return HealthStatus.UP;
    }
}
