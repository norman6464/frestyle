package dev.frestyle.backend;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpStatus;
import org.springframework.test.web.servlet.assertj.MockMvcTester;

@SpringBootTest(properties = "DATABASE_URL=postgres://frestyle:frestyle@127.0.0.1:1/frestyle?sslmode=disable")
@AutoConfigureMockMvc
class BackendApplicationTest {

    @Autowired
    private MockMvcTester mvc;

    @Test
    void 起動_DBに届かなくても立ち上がりhealthは503を返す() {
        assertThat(mvc.get().uri("/api/v2/health"))
                .hasStatus(HttpStatus.SERVICE_UNAVAILABLE)
                .bodyJson()
                .isStrictlyEqualTo("{\"status\":\"DOWN\",\"db\":\"DOWN\"}");
    }
}
