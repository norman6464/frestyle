package com.frestyle.backend.controller;

import com.frestyle.backend.domain.HealthStatus;
import com.frestyle.backend.dto.HealthResponse;
import com.frestyle.backend.service.HealthService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class HealthController {

    private final HealthService healthService;

    public HealthController(HealthService healthService) {
        this.healthService = healthService;
    }

    @GetMapping("/health")
    public ResponseEntity<HealthResponse> check() {
        HealthResponse body = HealthResponse.from(healthService.check());
        HttpStatus httpStatus = body.status() == HealthStatus.DOWN ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.OK;

        return ResponseEntity.status(httpStatus).body(body);
    }
}
