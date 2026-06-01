FROM ghcr.io/astral-sh/uv:0.11-python3.14-alpine3.23 AS base

COPY . /app

WORKDIR /app
RUN uv sync --frozen --no-dev --no-install-project

# github will mount the `GITHUB_WORKSPACE` directory to /github/workspace
# https://docs.github.com/en/actions/creating-actions/dockerfile-support-for-github-actions#workdir

ENTRYPOINT ["/app/.venv/bin/python", "/app/main.py"]
