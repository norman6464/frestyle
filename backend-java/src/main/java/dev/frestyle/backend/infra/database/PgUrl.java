package dev.frestyle.backend.infra.database;

import java.net.URI;
import java.net.URISyntaxException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;

public record PgUrl(String jdbcUrl, String user, String password) {

    public static PgUrl fromUrl(String url) {
        URI uri;
        try {
            uri = new URI(url);
        } catch (URISyntaxException e) {
            throw new IllegalArgumentException("接続 URL の形式が不正です", e);
        }
        if (!"postgres".equals(uri.getScheme()) && !"postgresql".equals(uri.getScheme())) {
            throw new IllegalArgumentException("接続 URL は postgres:// か postgresql:// で始まる必要があります");
        }
        String database = uri.getRawPath() == null ? "" : uri.getRawPath().replaceFirst("^/", "");
        if (uri.getHost() == null || database.isEmpty()) {
            throw new IllegalArgumentException("接続 URL に host と database 名が必要です");
        }

        StringBuilder jdbcUrl = new StringBuilder("jdbc:postgresql://").append(uri.getHost());
        if (uri.getPort() != -1) {
            jdbcUrl.append(':').append(uri.getPort());
        }
        jdbcUrl.append('/').append(database);
        if (uri.getRawQuery() != null) {
            jdbcUrl.append('?').append(uri.getRawQuery());
        }

        String[] userInfo = (uri.getRawUserInfo() == null ? "" : uri.getRawUserInfo()).split(":", 2);

        return new PgUrl(jdbcUrl.toString(), decode(userInfo[0]), userInfo.length > 1 ? decode(userInfo[1]) : "");
    }

    // URLDecoder は + を空白に変えるため先に退避する
    private static String decode(String raw) {
        return URLDecoder.decode(raw.replace("+", "%2B"), StandardCharsets.UTF_8);
    }
}
