package dev.frestyle.backend.handler;

import dev.frestyle.backend.domain.Health;
import dev.frestyle.backend.domain.HealthStatus;
import dev.frestyle.backend.handler.dto.HealthResponse;
import dev.frestyle.backend.usecase.health.CheckHealthUseCase;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v2")
public class HealthHandler {

    private final CheckHealthUseCase uc;

    public HealthHandler(CheckHealthUseCase uc) {
        this.uc = uc;
    }

    @GetMapping("/health")
    public ResponseEntity<HealthResponse> get() {
        Health result = uc.execute();
        HttpStatus status = result.status() == HealthStatus.DOWN ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.OK;

        return ResponseEntity.status(status).body(HealthResponse.fromDomain(result));
    }
}
