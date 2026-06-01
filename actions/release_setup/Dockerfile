FROM ghcr.io/astral-sh/uv:0.11-python3.14-alpine3.23 AS base

ENV PYTHONDONTWRITEBYTECODE=1

COPY . /app

WORKDIR /app
RUN <<EOF
uv sync --frozen --no-dev --no-install-project
addgroup -S action
adduser -S action -G action
EOF

USER action

# github will mount the `GITHUB_WORKSPACE` directory to /github/workspace
# https://docs.github.com/en/actions/creating-actions/dockerfile-support-for-github-actions#workdir

ENTRYPOINT ["/app/.venv/bin/python", "/app/main.py"]
