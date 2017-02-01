#! /bin/bash

set -e

source "${BASH_SOURCE%/*}/common.sh"

cleanService development

CMD="better-npm-run test:unit"

if [[ "$1" == "live" ]]; then
  CMD="$CMD:live"
fi

runAsService development $CMD

cleanService development
