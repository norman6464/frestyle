package com.frestyle.backend.dto;

import com.frestyle.backend.domain.HealthStatus;

public record HealthResponse(HealthStatus status, HealthStatus db) {

    public static HealthResponse from(HealthStatus dbStatus) {
        return new HealthResponse(dbStatus, dbStatus);
    }
}
