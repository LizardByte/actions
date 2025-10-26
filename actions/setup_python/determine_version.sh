#!/bin/bash
# Reusable script to determine Python version(s) from inputs
# This script can be sourced by both action.yml and post-ci.sh

# Function to read version from file
read_version_from_file() {
  local file="$1"

  if [[ ! -f "${file}" ]]; then
    echo "Error: File '${file}' not found" >&2
    return 1
  fi

  # Get the basename of the file for matching
  local filename
  filename=$(basename "${file}")

  case "${filename}" in
    *python-version)
      # .python-version format: one version per line or space-separated
      tr '\n' ' ' < "${file}"
      ;;
    pyproject.toml)
      # pyproject.toml format: requires-python = ">=3.8" or python_version = "3.8"
      # We'll extract the version from requires-python or python_version
      if grep -q "requires-python" "${file}"; then
        # Extract version like ">=3.8", "^3.8", "~=3.8.0", "==3.8.1"
        version=$(grep "requires-python" "${file}" | \
          sed -E 's/.*requires-python.*=.*["><=^~]*([0-9]+\.[0-9]+(\.[0-9]+)?).*/\1/')
        echo "${version}"
      elif grep -q "python_version" "${file}"; then
        version=$(grep "python_version" "${file}" | \
          sed -E 's/.*python_version.*=.*"([0-9]+\.[0-9]+(\.[0-9]+)?)".*/\1/')
        echo "${version}"
      else
        echo "Error: Could not find requires-python or python_version in pyproject.toml" >&2
        return 1
      fi
      ;;
    .tool-versions)
      # .tool-versions format: python 3.8.10
      grep "^python " "${file}" | awk '{print $2}'
      ;;
    Pipfile)
      # Pipfile format: python_version = "3.8"
      grep "python_version" "${file}" | \
        sed -E 's/.*python_version.*=.*"([0-9]+\.[0-9]+(\.[0-9]+)?)".*/\1/'
      ;;
    *)
      echo "Error: Unsupported file type '${file}'" >&2
      return 1
      ;;
  esac
}

# Function to determine Python versions and default version
# Sets two variables: PYTHON_VERSIONS and DEFAULT_PYTHON_VERSION
determine_python_version() {
  local python_version="$1"
  local python_version_file="$2"
  local versions=""

  # Determine which input to use
  if [[ -n "${python_version}" ]]; then
    # Use python-version input
    # Support both newline and space separated versions
    versions="${python_version}"
  elif [[ -n "${python_version_file}" ]]; then
    # Read from file
    if ! versions=$(read_version_from_file "${python_version_file}"); then
      return 1
    fi
  else
    echo "Error: Either python-version or python-version-file must be specified" >&2
    return 1
  fi

  # Normalize versions: convert newlines to spaces, collapse multiple spaces
  versions=$(echo "${versions}" | tr '\n' ' ' | tr -s ' ' | xargs)

  # Convert to array and get the last version as default
  IFS=' ' read -ra version_array <<< "${versions}"
  # Use bash 3.x compatible way to get last element
  local array_length=${#version_array[@]}
  local default_version="${version_array[$((array_length - 1))]}"

  # Export the results
  export PYTHON_VERSIONS="${versions}"
  export DEFAULT_PYTHON_VERSION="${default_version}"

  # Echo the variables to bypass sonar warnings about unused variables
  echo "PYTHON_VERSIONS=${PYTHON_VERSIONS}"
  echo "DEFAULT_PYTHON_VERSION=${DEFAULT_PYTHON_VERSION}"

  return 0
}
