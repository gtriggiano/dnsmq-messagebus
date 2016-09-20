#! /bin/bash

NPMDIR=${PWD##*/}
DOCPROJECT=${NPMDIR//-}

echo '--------------------------------'
echo '================================'
echo ' dnsmq-messagebus package tests'
echo '================================'
echo '--------------------------------'

echo
echo
echo -n 'Stopping and removing old containers... '
npm run clean &>/dev/null
echo 'Done.'
echo
echo '==================================================='
echo
echo -n 'Testing library... '
docker-compose up testlibrary &>/dev/null
echo 'Done'
echo
docker logs "${DOCPROJECT}_testlibrary_1"
echo
echo '==================================================='
echo
echo -n 'Stopping and removing old containers... '
npm run clean &>/dev/null
echo 'Done.'
echo
echo '==================================================='
echo
echo -n 'Starting a cluster of 3 DNSNode(s)... '
docker-compose scale cluster=3 &>/dev/null
echo 'Done'
echo
echo -n 'Waiting 2 seconds for cluster internal setup... '
sleep 2
echo 'OK'
echo
echo '==================================================='
echo
echo '---------------------------------'
echo ' Logs of a 3 nodes cluster setup'
echo '---------------------------------'
echo
echo 'DNSNode 1 logs'
echo '--------------'
echo
docker logs "${DOCPROJECT}_cluster_1"
echo
echo '========'
echo
echo 'DNSNode 2 logs'
echo '--------------'
echo
docker logs "${DOCPROJECT}_cluster_2"
echo
echo '========'
echo
echo 'DNSNode 3 logs'
echo '--------------'
echo
docker logs "${DOCPROJECT}_cluster_3"
echo
echo '==================================================='
echo
echo -n 'Testing ExternalNode connection... '
docker-compose up testexternalnode &>/dev/null
echo 'Done'
echo
docker logs "${DOCPROJECT}_testexternalnode_1"
echo
echo '==================================================='
echo
echo -n 'Cleaning... '
npm run clean &>/dev/null
echo 'Done'
