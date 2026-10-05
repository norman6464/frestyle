package com.frestyle.backend.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.BDDMockito.given;

import com.frestyle.backend.domain.HealthStatus;
import com.frestyle.backend.service.HealthService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.assertj.MockMvcTester;

@WebMvcTest(HealthController.class)
class HealthControllerTest {

    @Autowired
    private MockMvcTester mvc;

    @MockitoBean
    private HealthService healthService;

    @Test
    void UPなら_200を返す() {
        given(healthService.check()).willReturn(HealthStatus.UP);

        assertThat(mvc.get().uri("/health"))
                .hasStatus(HttpStatus.OK)
                .hasContentTypeCompatibleWith(MediaType.APPLICATION_JSON)
                .bodyJson()
                .isStrictlyEqualTo("{\"status\":\"UP\",\"db\":\"UP\"}");
    }

    @Test
    void DOWNなら_503を返す() {
        given(healthService.check()).willReturn(HealthStatus.DOWN);

        assertThat(mvc.get().uri("/health"))
                .hasStatus(HttpStatus.SERVICE_UNAVAILABLE)
                .hasContentTypeCompatibleWith(MediaType.APPLICATION_JSON)
                .bodyJson()
                .isStrictlyEqualTo("{\"status\":\"DOWN\",\"db\":\"DOWN\"}");
    }
}
