# _template

A reusable action to ...

Extended description here.

## 🛠️ Prep Work

Add any pre-requisites to run the action here.

## 🚀 Basic Usage

See [action.yml](action.yml)

```yaml
steps:
  - name: _template
    uses: LizardByte/actions/actions/_template@master
    with:
      name: "World"
```

## 📥 Inputs

| Name | Description    | Default    | Required |
|------|----------------|------------|----------|
| name | Name to greet. | `World`    | `false`  |

## 📤 Outputs

| Name     | Description                   |
|----------|-------------------------------|
| greeting | The greeting that was echoed. |

## Section specific to action

> [!NOTE]
> Be sure to use GitHub admonition syntax for notes, warnings, etc.

## 🖥 Example Workflows

### Basic

```yaml
steps:
  - name: Greet
    uses: LizardByte/actions/actions/_template@master
```

### Advanced

```yaml
steps:
  - name: Greet
    uses: LizardByte/actions/actions/_template@master
    with:
      name: LizardByte
```

## 📝 Notes

Add additional notes here.

## 🔗 See Also

This action can be used in conjunction with [another_action](../_template).
