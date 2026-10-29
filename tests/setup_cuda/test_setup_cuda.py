"""Exercise the Linux CUDA installer with isolated native and legacy runtimes."""

# standard imports
from pathlib import Path
import os
import shutil
import subprocess

# lib imports
import pytest


SCRIPT = (Path(__file__).resolve().parents[2] / 'actions/setup_cuda/setup_cuda.sh').read_text(encoding='utf-8')
BASH = (shutil.which('bash', path=f"{os.environ.get('ProgramFiles', '')}/Git/bin")
        if os.name == 'nt' else shutil.which('bash'))
pytestmark = pytest.mark.skipif(BASH is None, reason='Bash is required to test the CUDA setup script')

MOCKS = r'''
uname() {
    if [[ "$1" == "-s" ]]; then echo Linux; else echo "$TEST_ARCH"; fi
}
ldconfig() {
    if [[ "$TEST_NATIVE" == "yes" ]]; then
        printf '\tlibxml2.so.2 (libc6,%s) => /usr/lib/libxml2.so.2\n' "$TEST_LOADER_ARCH"
    else
        # An installed 32-bit library must not mask the missing native ABI.
        printf '\tlibxml2.so.2 (libc6) => /usr/lib/i386-linux-gnu/libxml2.so.2\n'
    fi
}
mktemp() {
    mkdir -p "$TEST_ROOT/installer work"
    printf '%s\n' "$TEST_ROOT/installer work"
}
apt-get() {
    printf '%s\n' "$APT_CONFIG" "$@" >> "$TEST_ROOT/apt-commands"
    cp "$APT_CONFIG" "$TEST_ROOT/apt.conf"
    cp "${APT_CONFIG%/*}/sources.list" "$TEST_ROOT/sources.list"
    local argument
    for argument in "$@"; do
        if [[ "$argument" == "$TEST_FAIL" ]]; then return 42; fi
        if [[ "$argument" == "download" ]]; then
            touch libxml2.deb libicu74.deb
        fi
    done
}
dpkg-deb() {
    [[ "$TEST_FAIL" != "extract" ]] || return 42
    mkdir -p "$3/usr/lib/$TEST_MULTIARCH"
    if [[ "$2" == */libxml2.deb && "$TEST_FAIL" != "missing-library" ]]; then
        touch "$3/usr/lib/$TEST_MULTIARCH/libxml2.so.2"
    else
        touch "$3/usr/lib/$TEST_MULTIARCH/libicuuc.so.74"
    fi
}
sudo() {
    printf '%s\n' "$@" > "$TEST_ROOT/sudo-arguments"
    "$@"
}
curl() {
    cat > "$3" <<'INSTALLER'
#!/bin/bash
set -euo pipefail
printf '%s\n' "$@" > "$TEST_ROOT/installer-arguments"
printf '%s\n' "${LD_LIBRARY_PATH:-}" > "$TEST_ROOT/installer-library-path"
if [[ "$TEST_NATIVE" != "yes" ]]; then
    runtime="$TEST_ROOT/installer work/installer-runtime/root/usr/lib/$TEST_MULTIARCH"
    [[ "${LD_LIBRARY_PATH:-}" == "$runtime"* ]] || exit 43
    [[ -f "$runtime/libxml2.so.2" && -f "$runtime/libicuuc.so.74" ]] || exit 44
fi
[[ "$TEST_FAIL" != "installer" ]] || exit 42
for argument in "$@"; do
    if [[ "$argument" == --toolkitpath=* ]]; then
        install_path="${argument#*=}"
    fi
done
mkdir -p "$install_path/bin"
printf '#!/bin/bash\necho "Cuda compilation tools, release 13.1, V13.1.80"\n' > "$install_path/bin/nvcc"
chmod +x "$install_path/bin/nvcc"
INSTALLER
}
'''


def run_setup(tmp_path, monkeypatch, arch='x86_64', native=False, failure='', inherited_library_path=''):
    multiarch, loader_arch = ('x86_64-linux-gnu', 'x86-64') if arch == 'x86_64' else (
        'aarch64-linux-gnu', 'AArch64')
    settings = {
        'TEST_ROOT': tmp_path.as_posix(),
        'TEST_ARCH': arch,
        'TEST_MULTIARCH': multiarch,
        'TEST_LOADER_ARCH': loader_arch,
        'TEST_NATIVE': 'yes' if native else 'no',
        'TEST_FAIL': failure or 'none',
        'GITHUB_PATH': (tmp_path / 'github-path').as_posix(),
        'GITHUB_ENV': (tmp_path / 'github-env').as_posix(),
        'GITHUB_OUTPUT': (tmp_path / 'github-output').as_posix(),
    }
    for key, value in settings.items():
        monkeypatch.setenv(key, value)
    monkeypatch.delenv('LD_LIBRARY_PATH', raising=False)
    if inherited_library_path:
        monkeypatch.setenv('LD_LIBRARY_PATH', inherited_library_path)
    return subprocess.run(
        [BASH, '--noprofile', '--norc', '-s', '--', '--cuda-version=13.1.0',
         '--driver-version=590.44.01', f'--install-path={(tmp_path / "cuda toolkit").as_posix()}'],
        input=MOCKS + SCRIPT,
        capture_output=True,
        text=True,
        encoding='utf-8',
        timeout=15,
        check=False,
    )


@pytest.mark.parametrize('arch,deb_arch,archive', [
    ('x86_64', 'amd64', 'https://archive.ubuntu.com/ubuntu'),
    ('aarch64', 'arm64', 'https://ports.ubuntu.com/ubuntu-ports'),
])
@pytest.mark.parametrize('inherited_library_path', ['', '/existing libraries'])
def test_missing_native_abi_uses_temporary_signed_packages(
        tmp_path, monkeypatch, arch, deb_arch, archive, inherited_library_path):
    result = run_setup(tmp_path, monkeypatch, arch=arch, inherited_library_path=inherited_library_path)

    assert result.returncode == 0, result.stderr
    multiarch = 'x86_64-linux-gnu' if arch == 'x86_64' else 'aarch64-linux-gnu'
    runtime = (tmp_path / 'installer work/installer-runtime/root/usr/lib' / multiarch).as_posix()
    expected_library_path = runtime + (f':{inherited_library_path}' if inherited_library_path else '')
    assert (tmp_path / 'installer-library-path').read_text(encoding='utf-8').strip() == expected_library_path
    sudo_arguments = (tmp_path / 'sudo-arguments').read_text(encoding='utf-8').splitlines()
    assert sudo_arguments[:2] == ['env', f'LD_LIBRARY_PATH={expected_library_path}']
    sources = (tmp_path / 'sources.list').read_text(encoding='utf-8')
    assert f'arch={deb_arch} signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg' in sources
    assert f'{archive} noble main' in sources
    assert f'{archive} noble-updates main' in sources
    security_archive = 'https://security.ubuntu.com/ubuntu' if arch == 'x86_64' else archive
    assert f'{security_archive} noble-security main' in sources
    apt_commands = (tmp_path / 'apt-commands').read_text(encoding='utf-8').splitlines()
    assert f'libxml2:{deb_arch}' in apt_commands
    assert f'libicu74:{deb_arch}' in apt_commands
    assert '--error-on=any' in apt_commands
    assert f'Dir::State::lists={tmp_path.as_posix()}/installer work/installer-runtime/lists' in apt_commands
    assert f'Dir::Cache={tmp_path.as_posix()}/installer work/installer-runtime/cache' in apt_commands
    assert (tmp_path / 'apt.conf').read_text(encoding='utf-8') == 'Dir::Etc::parts "-";\nDir::Etc::main "-";\n'
    assert not (tmp_path / 'installer work').exists()
    for output_file in ['github-path', 'github-env', 'github-output']:
        contents = (tmp_path / output_file).read_text(encoding='utf-8')
        assert 'installer-runtime' not in contents
        assert 'libicu' not in contents
    assert f'cuda-path={(tmp_path / "cuda toolkit").as_posix()}' in (
        tmp_path / 'github-output').read_text(encoding='utf-8')


@pytest.mark.parametrize('arch', ['x86_64', 'aarch64'])
def test_existing_native_abi_skips_downloads(tmp_path, monkeypatch, arch):
    result = run_setup(tmp_path, monkeypatch, arch=arch, native=True)

    assert result.returncode == 0, result.stderr
    assert not (tmp_path / 'apt-commands').exists()
    assert not (tmp_path / 'installer work').exists()
    assert 'LD_LIBRARY_PATH=' not in (tmp_path / 'sudo-arguments').read_text(encoding='utf-8')
    assert (tmp_path / 'installer-arguments').read_text(encoding='utf-8').splitlines() == [
        '--silent', '--toolkit', f'--toolkitpath={(tmp_path / "cuda toolkit").as_posix()}', '--no-opengl-libs']


@pytest.mark.parametrize('failure', ['update', 'download', 'extract', 'missing-library', 'installer'])
def test_dependency_and_installer_failures_stop_setup_and_clean_up(tmp_path, monkeypatch, failure):
    result = run_setup(tmp_path, monkeypatch, failure=failure)

    assert result.returncode != 0
    expected = 'CUDA installation failed' if failure == 'installer' else 'Failed to prepare CUDA installer dependencies'
    assert expected in result.stderr
    assert not (tmp_path / 'installer work').exists()
    assert not (tmp_path / 'github-output').exists()
    assert (tmp_path / 'installer-arguments').exists() == (failure == 'installer')
