package dev.frestyle.backend.handler.dto;

import dev.frestyle.backend.domain.Health;

public record HealthResponse(String status, String db) {

    public static HealthResponse fromDomain(Health health) {
        return new HealthResponse(health.status().name(), health.dbStatus().name());
    }
}
