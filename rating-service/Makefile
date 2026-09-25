.PHONY: install dev test lint docker-up sync-companies

install:
	python -m pip install -e ".[dev]"

dev:
	uvicorn app.main:app --host 0.0.0.0 --port 8787 --reload

sync-companies:
	python sync_companies.py

test:
	pytest

lint:
	ruff check app tests

docker-up:
	docker compose up -d --build
