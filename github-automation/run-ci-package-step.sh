#!/usr/bin/env bash
# Run the CI package/install steps for a project locally, in Git Bash.
#
# Why this exists: the first version of these steps mixed bash paths with Node
# file reads, and on Windows the two disagree about what `/tmp/x` means (bash
# writes to the MSYS temp directory, Node resolves the same string to
# `D:\tmp\x`). That only ever failed in CI, on the Windows runner. Running the
# same shell here catches it before the push instead of after.
#
# Usage: bash run-ci-package-step.sh <project-dir>

set -euo pipefail

project="${1:?usage: run-ci-package-step.sh <project-dir>}"
cd "$project"

name=$(node -p "require('./package.json').name")
version=$(node -p "require('./package.json').version")
sandbox=$(mktemp -d)
echo "sandbox: $sandbox"

npm pack --pack-destination "$sandbox" > /dev/null
npm install --global --prefix "$sandbox/prefix" --cache "$sandbox/cache" \
  --no-audit --no-fund --loglevel error "$sandbox/$name-$version.tgz"

bin="$sandbox/prefix/bin/$name"
[ -x "$bin" ] || bin="$sandbox/prefix/$name.cmd"
[ -e "$bin" ] || bin="$sandbox/prefix/$name"
echo "installed command: $bin"
"$bin" --version

if [ -f scripts/verify-install.js ]; then
  node scripts/verify-install.js "$bin"
else
  "$bin" --help > /dev/null
  printf 'id,name\n1,alice\n2,bob\n' > "$sandbox/data.csv"
  "$bin" peek "$sandbox/data.csv" --json --quiet | node -e "
    let text = '';
    process.stdin.on('data', (c) => (text += c)).on('end', () => {
      const p = JSON.parse(text);
      if (p.rows !== 2) { console.error('installed peek wrong:', p.rows); process.exit(1); }
      console.log('installed peek works:', p.columns.length, 'columns');
    });
  "
  "$bin" query 'id > 1' "$sandbox/data.csv" --to csv --quiet | grep -q bob && echo 'installed query works'
fi

rm -rf "$sandbox"
echo "package step OK for $name"
