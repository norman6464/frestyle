COMPOSE := docker compose -f ../backend/docker-compose.integration.yml

.PHONY: test
test:
	./gradlew test

.PHONY: test-integration
test-integration:
	@$(COMPOSE) up -d --wait && \
	  SPRING_DATASOURCE_URL='jdbc:postgresql://localhost:5433/frestyle_integration' \
	  SPRING_DATASOURCE_USERNAME=frestyle \
	  SPRING_DATASOURCE_PASSWORD=frestyle \
	  ./gradlew integrationTest ; \
	  status=$$? ; \
	  $(COMPOSE) down -v ; \
	  exit $$status
