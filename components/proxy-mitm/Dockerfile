FROM python:3.10.6 AS base

ENV PYTHONFAULTHANDLER=1 \
    PYTHONHASHSEED=random \
    PYTHONUNBUFFERED=1

FROM base AS builder

ENV PIP_DEFAULT_TIMEOUT=100 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    POETRY_VERSION=1.2.0

RUN pip install "poetry==$POETRY_VERSION"
RUN python -m venv /venv

WORKDIR /app

# poetry -> venv for consistent venv name
COPY proxy-mitm/pyproject.toml proxy-mitm/poetry.lock ./
RUN poetry install
RUN poetry export -f requirements.txt | /venv/bin/pip install -r /dev/stdin

COPY proxy-mitm/src/ /app/
COPY utils /app/utils/
# COPY proxy-mitm/certs/ /app/certs
COPY service-worker/ /app/service-worker/

COPY proxy-mitm/entrypoint.sh ./
RUN chmod +x entrypoint.sh

# RUN ["./entrypoint.sh"]
ENTRYPOINT ["/app/entrypoint.sh"]