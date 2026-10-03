package dev.frestyle.backend.usecase.health;

import static org.assertj.core.api.Assertions.assertThat;

import dev.frestyle.backend.domain.Health;
import dev.frestyle.backend.domain.HealthStatus;
import org.junit.jupiter.api.Test;

class CheckHealthUseCaseTest {

    @Test
    void ヘルスチェック_DB正常() {
        CheckHealthUseCase uc = new CheckHealthUseCase(() -> {});

        Health got = uc.execute();

        assertThat(got).isEqualTo(new Health(HealthStatus.UP, HealthStatus.UP));
    }

    @Test
    void ヘルスチェック_DB異常() {
        CheckHealthUseCase uc = new CheckHealthUseCase(() -> {
            throw new IllegalStateException("ping failed");
        });

        Health got = uc.execute();

        assertThat(got).isEqualTo(new Health(HealthStatus.DOWN, HealthStatus.DOWN));
    }
}
