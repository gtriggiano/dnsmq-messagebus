#! /bin/bash

set -e

source "${BASH_SOURCE%/*}/common.sh"

echo -n "Cleaning... "
cleanService development &>/dev/null
cleanService bus &>/dev/null
echo "Done."

startService bus

DNS_CMD="better-npm-run test:dnsnode:behaviour"
EXTERNAL_CMD="better-npm-run test:externalnode:behaviour"

if [[ "$1" == "live" ]]; then
  DNS_CMD="$DNS_CMD:live"
  EXTERNAL_CMD="$EXTERNAL_CMD:live"
fi

if [[ "$1" != "live" ]]; then
  runAsService bus $DNS_CMD
  echo
else
  startService bus
  echo
  echo "Waiting bus setup"
  sleep 3
  echo
fi
runAsService development $EXTERNAL_CMD
echo
cleanService development
if [[ "$1" == "live" ]]; then
  stopService bus
fi
