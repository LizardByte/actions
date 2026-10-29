"""Prepare the Homebrew test formula with a fetchable source revision."""

import json
import os
from pathlib import Path
import subprocess
import sys


def get_source_reference(repo_root: Path) -> tuple[str, str]:
    """Return the fetchable repository and revision for the PR or ordinary checkout."""
    repository = os.getenv('GITHUB_REPOSITORY', 'LizardByte/actions')
    if os.getenv('GITHUB_EVENT_NAME') in {'pull_request', 'pull_request_target'}:
        # Homebrew clones branch and tag refs, which exclude GitHub's temporary merge commit.
        with open(os.environ['GITHUB_EVENT_PATH'], encoding='utf-8') as event_file:
            head = json.load(event_file)['pull_request']['head']
        repository = head['repo']['full_name']
        revision = head['sha']
    else:
        revision = subprocess.run(
            ['git', 'rev-parse', 'HEAD'],
            cwd=repo_root,
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()

    return repository, revision


def render_formula(repo_root: Path, formula_path: Path) -> Path:
    """Pin the generated formula to the PR head or the ordinary checkout."""
    repository, revision = get_source_reference(repo_root)
    template_path = repo_root / 'tests' / 'release_homebrew' / 'Formula' / 'hello_world.rb'
    formula = template_path.read_text(encoding='utf-8')
    formula = formula.replace('@GIT_REPOSITORY@', repository).replace('@GIT_REVISION@', revision)
    formula_path.parent.mkdir(parents=True, exist_ok=True)
    formula_path.write_text(f'{formula}# Created from {repository}@{revision}\n', encoding='utf-8')
    return formula_path


if __name__ == '__main__':
    render_formula(Path.cwd(), Path(sys.argv[1]))
