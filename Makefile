ifneq (,$(wildcard ./.env))
    include .env
    export
endif

.DEFAULT_GOAL := help
.PHONY: help
help:
	@echo "usage: make [target] ..."
	@echo ""
	@echo "targets:"
	@fgrep -h "##" $(MAKEFILE_LIST) | fgrep -v fgrep | sed -e 's/\\$$//' | sed -e 's/##//'

.PHONY: setup
setup: ## Setup required environment
	@echo "creating .env file"
	@cp .env.example .env
	@npm ci

.PHONY: run
run: ## Run services
	@docker compose -f docker-compose.yml up -d --build --remove-orphans

.PHONY: logs
logs: ## Stream logs
	@docker compose logs -f

.PHONY: stop
stop: ## Stop services
	@docker compose -f docker-compose.yml stop

.PHONY: migrate
migrate: ## Run migrations
	@npx prisma generate
	@DATABASE_URL=$(DATABASE_URL_EXTERNAL) npx prisma migrate dev --name init

.PHONY: format-db
format-db: ## Format database
	@npx prisma format
