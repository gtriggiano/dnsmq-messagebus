#! /bin/bash

set -e

source "${BASH_SOURCE%/*}/common.sh"

echo -n "Cleaning... "
cleanService development &>/dev/null
cleanService bus &>/dev/null
echo "Done."

startService bus
echo -n "Waiting bus setup... "
sleep 3
echo "Done."
echo

CMD="better-npm-run test:behaviour"

if [[ "$1" != "live" ]]; then
  echo "TEST DNS NODE BEHAVIOUR"
  echo
  runAsService bus $CMD
  echo
  separator
  echo
  echo "TEST EXTERNAL NODE BEHAVIOUR"
  echo
  runAsService development $CMD
  echo
else
  echo "TEST DNS NODE BEHAVIOUR LIVE"
  CMD="$CMD:live"
  runAsService bus $CMD
fi

cleanService development
stopService bus
