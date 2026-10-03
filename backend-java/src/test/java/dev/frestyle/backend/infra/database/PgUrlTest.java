package dev.frestyle.backend.infra.database;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class PgUrlTest {

    @Test
    void 接続URL_JDBCの形に変換する() {
        PgUrl got = PgUrl.fromUrl("postgres://frestyle:secret@localhost:5433/frestyle_integration?sslmode=disable");

        assertThat(got.jdbcUrl()).isEqualTo("jdbc:postgresql://localhost:5433/frestyle_integration?sslmode=disable");
        assertThat(got.user()).isEqualTo("frestyle");
        assertThat(got.password()).isEqualTo("secret");
    }

    @Test
    void 接続URL_postgresqlスキームとポート省略を受け付ける() {
        PgUrl got = PgUrl.fromUrl("postgresql://frestyle:secret@db.example.com/frestyle");

        assertThat(got.jdbcUrl()).isEqualTo("jdbc:postgresql://db.example.com/frestyle");
    }

    @Test
    void 接続URL_パーセントエンコードされた認証情報を戻す() {
        PgUrl got = PgUrl.fromUrl("postgres://user%40tenant:p%3Aa%2Bs%2Fs@localhost/frestyle");

        assertThat(got.user()).isEqualTo("user@tenant");
        assertThat(got.password()).isEqualTo("p:a+s/s");
    }

    @Test
    void 接続URL_スキームが違えば拒否する() {
        assertThatThrownBy(() -> PgUrl.fromUrl("mysql://frestyle:secret@localhost/frestyle"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void 接続URL_database名が無ければ拒否する() {
        assertThatThrownBy(() -> PgUrl.fromUrl("postgres://frestyle:secret@localhost"))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
