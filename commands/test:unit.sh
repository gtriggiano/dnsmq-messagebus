#! /bin/bash

set -e

source "${BASH_SOURCE%/*}/common.sh"

cleanService unit-tests

CMD="better-npm-run test:unit"

if [[ "$1" == "live" ]]; then
  CMD="$CMD:live"
fi

runAsService unit-tests $CMD

cleanService unit-tests
