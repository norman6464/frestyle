package dev.frestyle.backend.usecase.repository;

public interface HealthRepository {

    /**
     * @throws RuntimeException DB に到達できないとき
     */
    void pingDb();
}
