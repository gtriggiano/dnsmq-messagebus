#! /bin/bash

set -e

source "${BASH_SOURCE%/*}/common.sh"

echo
echo -n "Transpiling package... "
runAsService development better-npm-run transpile:package &>/dev/null
echo "Done."
echo -n "Transpiling tests... "
runAsService development better-npm-run transpile:tests &>/dev/null
echo "Done."
