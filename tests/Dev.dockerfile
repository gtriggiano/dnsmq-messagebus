FROM node:boron-slim

WORKDIR /app

ADD package.json /app/package.json
RUN npm install
