.PHONY: dev build start lint seed push generate studio install

dev:
	npm run dev

build:
	npm run build

start:
	npm run start

lint:
	npm run lint

install:
	npm install

# Database
seed:
	npm run db:seed

push:
	npm run db:push

generate:
	npm run db:generate

studio:
	npm run db:studio

# Tests
test:
	npm test

test-watch:
	npm run test:watch
