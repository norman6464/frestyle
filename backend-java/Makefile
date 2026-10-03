INTEGRATION_DSN := postgres://frestyle:frestyle@localhost:5433/frestyle_integration?sslmode=disable

.PHONY: test
test:
	./gradlew test

.PHONY: test-integration
test-integration:
	docker compose -f ../backend/docker-compose.integration.yml up -d --wait
	@TEST_DATABASE_URL='$(INTEGRATION_DSN)' ./gradlew integrationTest ; \
	  status=$$? ; \
	  docker compose -f ../backend/docker-compose.integration.yml down -v ; \
	  exit $$status

.PHONY: run
run:
	./gradlew bootRun
