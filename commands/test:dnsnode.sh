#! /bin/bash

set -e

source "${BASH_SOURCE%/*}/common.sh"

echo -n "Cleanning... "
cleanService development &>/dev/null
cleanService bus &>/dev/null
echo "Done."

startService bus

CMD="better-npm-run test:dnsnode"

if [[ "$1" == "live" ]]; then
  CMD="$CMD:live"
fi

runAsService development $CMD
echo
cleanService development
cleanService bus
