package dev.frestyle.backend.usecase.health;

import dev.frestyle.backend.domain.Health;
import dev.frestyle.backend.domain.HealthStatus;
import dev.frestyle.backend.usecase.repository.HealthRepository;
import org.springframework.stereotype.Service;

@Service
public class CheckHealthUseCase {

    private final HealthRepository repo;

    public CheckHealthUseCase(HealthRepository repo) {
        this.repo = repo;
    }

    public Health execute() {
        try {
            repo.pingDb();
        } catch (RuntimeException e) {
            return new Health(HealthStatus.DOWN, HealthStatus.DOWN);
        }

        return new Health(HealthStatus.UP, HealthStatus.UP);
    }
}
