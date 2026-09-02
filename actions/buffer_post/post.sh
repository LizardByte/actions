#!/usr/bin/env bash

set -euo pipefail

# shellcheck disable=SC2016  # GraphQL variables must remain literal.
query='mutation CreatePost($input: CreatePostInput!) {
  createPost(input: $input) {
    __typename
    ... on PostActionSuccess {
      post {
        externalLink
      }
    }
    ... on MutationError {
      message
    }
  }
}'
payload=$(jq --null-input \
  --arg query "${query}" \
  --arg text "${INPUT_MESSAGE}" \
  --arg channel_id "${INPUT_CHANNEL_ID}" \
  '{
    query: $query,
    variables: {
      input: {
        text: $text,
        channelId: $channel_id,
        schedulingType: "automatic",
        mode: "shareNow"
      }
    }
  }')

case "${INPUT_DRY_RUN}" in
  true)
    echo "Dry run enabled; skipping Buffer API request."
    echo "post_url=" >> "${GITHUB_OUTPUT}"
    exit 0
    ;;
  false)
    ;;
  *)
    echo "::error::dry_run must be either 'true' or 'false'." >&2
    exit 1
    ;;
esac

response=$(curl \
  --proto "=https" \
  --tlsv1.2 \
  --fail-with-body \
  --silent \
  --show-error \
  --request POST \
  --header "Authorization: Bearer ${INPUT_API_KEY}" \
  --header "Content-Type: application/json" \
  --data "${payload}" \
  https://api.buffer.com)

graphql_errors=$(jq --raw-output '[.errors[]?.message] | join("; ")' <<< "${response}")
if [[ -n "${graphql_errors}" ]]; then
  echo "::error::Buffer API request failed: ${graphql_errors}" >&2
  exit 1
fi

response_type=$(jq --raw-output '.data.createPost.__typename // empty' <<< "${response}")
if [[ "${response_type}" != "PostActionSuccess" ]]; then
  message=$(jq --raw-output \
    '.data.createPost.message // "Buffer did not return a failure message."' \
    <<< "${response}")
  echo "::error::Buffer failed to create the post: ${message}" >&2
  exit 1
fi

post_url=$(jq --raw-output '.data.createPost.post.externalLink // empty' <<< "${response}")
echo "post_url=${post_url}" >> "${GITHUB_OUTPUT}"
