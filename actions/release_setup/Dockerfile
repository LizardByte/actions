FROM python:3.12-alpine3.18 AS base

RUN python -m pip install --no-cache-dir --upgrade pip setuptools wheel

COPY . /app

WORKDIR /app
RUN python -m pip install --no-cache-dir --upgrade -r requirements.txt

# github will mount the `GITHUB_WORKSPACE` directory to /github/workspace
# https://docs.github.com/en/actions/creating-actions/dockerfile-support-for-github-actions#workdir

ENTRYPOINT ["python", "/app/main.py"]
