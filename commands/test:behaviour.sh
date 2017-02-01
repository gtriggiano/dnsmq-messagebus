#! /bin/bash

set -e

source "${BASH_SOURCE%/*}/common.sh"

echo -n "Cleanning... "
cleanService development &>/dev/null
cleanService bus &>/dev/null
echo "Done."

startService bus

LIVE=false
DNS_CMD="better-npm-run test:dnsnode:behaviour"
EXTERNAL_CMD="better-npm-run test:externalnode:behaviour"

if [[ "$1" == "live" ]]; then
  LIVE=true
  DNS_CMD="$DNS_CMD:live"
  EXTERNAL_CMD="$EXTERNAL_CMD:live"
fi

if [[! $LIVE ]]; then
  runAsService bus $DNS_CMD
  echo
fi
runAsService development $EXTERNAL_CMD
echo
cleanService bus