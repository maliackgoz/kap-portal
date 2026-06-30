.PHONY: install dev test lint docker-up

install:
	python -m pip install -e ".[dev]"

dev:
	uvicorn app.main:app --host 0.0.0.0 --port 8787 --reload

test:
	pytest

lint:
	ruff check app tests

docker-up:
	docker compose up -d --build
