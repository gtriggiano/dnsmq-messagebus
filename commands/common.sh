#!/bin/bash

COMPOSE_PROJECT=dnsmq-messagebus

function cleanContainers () {
  echo
  echo -n 'Stopping and removing all containers... '
  docker-compose -p $COMPOSE_PROJECT stop &>/dev/null
  docker-compose -p $COMPOSE_PROJECT rm -f &>/dev/null
  echo 'Done.'
  echo
}

function cleanService () {
  local SERVICE=$1
  if [[ -n "$SERVICE" ]]; then
    echo
    echo -n "Stopping and removing all '$SERVICE' containers... "
    docker-compose -p $COMPOSE_PROJECT stop $SERVICE &>/dev/null
    docker-compose -p $COMPOSE_PROJECT rm -f $SERVICE &>/dev/null
    echo 'Done.'
    echo
  fi
}

function startService () {
  local SERVICE=$1
  if [[ -n "$SERVICE" ]]; then
    echo
    echo -n "Starting service '$SERVICE'... "
    docker-compose -p $COMPOSE_PROJECT up -d $SERVICE &>/dev/null
    echo 'Done.'
    echo
  fi
}

function scaleService () {
  local SERVICE=$1
  local NUM=$2
  if [[ -n "$SERVICE" && -n "$NUM"  ]]; then
    echo
    echo -n "Scaling service '$SERVICE' to '$NUM' container(s)... "
    docker-compose -p $COMPOSE_PROJECT scale $SERVICE=$NUM &>/dev/null
    echo 'Done.'
    echo
  fi
}

function runAsService () {
  local SERVICE=$1
  shift
  local CMD=$@
  if [[ -n "$SERVICE" && -n "$CMD"  ]]; then
    docker-compose -p $COMPOSE_PROJECT run $SERVICE $CMD
  fi
}

function separator () {
  echo "================================================="
}
