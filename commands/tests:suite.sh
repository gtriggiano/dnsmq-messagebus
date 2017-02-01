#! /bin/bash

set -e

source "${BASH_SOURCE%/*}/common.sh"

echo "STARTING dnsmq-messagebus TEST SUITE"
echo
echo "Execution order:"
echo " - UNIT TESTS"
echo " - DNS NODE BEHAVIOUR TESTS"
echo " - EXTERNAL NODE BEHAVIOUR TESTS"
echo
echo -n "Transpiling package and tests... "
source "${BASH_SOURCE%/*}/transpile.sh" &> /dev/null
echo "Done."
cleanContainers
echo
echo
echo "UNIT TESTS"
echo
runAsService development better-npm-run test:unit
echo
separator
startService bus
separator
echo
echo "DNS NODE BEHAVIOUR TESTS"
runAsService bus better-npm-run test:dnsnode:behaviour
echo
separator
echo
echo "EXTERNAL NODE BEHAVIOUR NODE TESTS"
echo
runAsService bus better-npm-run test:externalnode:behaviour
echo
separator
echo
echo "END dnsmq-messagebus TEST SUITE"
