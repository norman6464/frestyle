package dev.frestyle.backend.handler;

import static org.assertj.core.api.Assertions.assertThat;

import dev.frestyle.backend.usecase.health.CheckHealthUseCase;
import dev.frestyle.backend.usecase.repository.HealthRepository;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.assertj.MockMvcTester;

class HealthHandlerTest {

    @Test
    void ヘルスハンドラ_取得_正常() {
        MockMvcTester mvc = mvcWith(() -> {});

        assertThat(mvc.get().uri("/api/v2/health"))
                .hasStatus(HttpStatus.OK)
                .hasContentTypeCompatibleWith(MediaType.APPLICATION_JSON)
                .bodyJson()
                .isStrictlyEqualTo("{\"status\":\"UP\",\"db\":\"UP\"}");
    }

    @Test
    void ヘルスハンドラ_取得_異常() {
        MockMvcTester mvc = mvcWith(() -> {
            throw new IllegalStateException("db unreachable");
        });

        assertThat(mvc.get().uri("/api/v2/health"))
                .hasStatus(HttpStatus.SERVICE_UNAVAILABLE)
                .hasContentTypeCompatibleWith(MediaType.APPLICATION_JSON)
                .bodyJson()
                .isStrictlyEqualTo("{\"status\":\"DOWN\",\"db\":\"DOWN\"}");
    }

    @Test
    void ヘルスハンドラ_未定義のパスは404() {
        MockMvcTester mvc = mvcWith(() -> {});

        assertThat(mvc.get().uri("/api/v2/unknown")).hasStatus(HttpStatus.NOT_FOUND);
    }

    private static MockMvcTester mvcWith(HealthRepository repo) {
        return MockMvcTester.of(new HealthHandler(new CheckHealthUseCase(repo)));
    }
}
