# buffer_post

A reusable action to publish an immediate social media post through Buffer.

## 🛠️ Prep Work

1. Connect the destination social channel to Buffer.
2. Create a Buffer API key with `postsWrite` access.
3. Follow Buffer's [Get organizations](https://developers.buffer.com/examples/get-organizations.html) example to find the
   organization ID.
4. Use that organization ID with Buffer's [Get channels](https://developers.buffer.com/examples/get-channels.html)
   example, then copy the ID of the destination channel.

Store the API key as a GitHub Actions secret. A channel ID is not sensitive and can be stored as a repository or
organization variable.

## 🚀 Basic Usage

See [action.yml](action.yml)

```yaml
steps:
  - name: Post through Buffer
    id: buffer
    uses: LizardByte/actions/actions/buffer_post@master
    with:
      api_key: ${{ secrets.BUFFER_API_KEY }}
      channel_id: ${{ vars.BUFFER_CHANNEL_ID }}
      message: "Hello from GitHub Actions!"
```

## 📥 Inputs

| Name       | Description                                      | Default | Required |
|------------|--------------------------------------------------|---------|----------|
| api_key    | Buffer API key with `postsWrite` access.         |         | `true`   |
| channel_id | Buffer channel ID that should receive the post.  |         | `true`   |
| dry_run    | Build the request without sending it to Buffer.  | `false` | `false`  |
| message    | Text content of the post.                        |         | `true`   |

## 📤 Outputs

| Name     | Description                                                   |
|----------|---------------------------------------------------------------|
| post_url | Published post URL returned by Buffer, when one is available. |

Buffer may accept a post before the destination network URL is available. In that case, `post_url` is empty.

## 🧪 Dry Run

Set `dry_run` to `true` to build the GraphQL request without sending it to Buffer:

```yaml
steps:
  - name: Validate Buffer post
    uses: LizardByte/actions/actions/buffer_post@master
    with:
      api_key: unused-in-dry-run
      channel_id: unused-in-dry-run
      dry_run: true
      message: "This will not be published."
```

## 📝 Notes

- Posts are sent immediately using Buffer's `shareNow` mode.
- The action intentionally does not retry create requests because a retry could publish a duplicate post.
- The runner must provide Bash, `curl`, and `jq`. These are available on GitHub-hosted Ubuntu runners.

## 🔗 See Also

- [Buffer API documentation](https://developers.buffer.com/)
