FROM node:argon-slim

WORKDIR /app

ADD package.json /app/package.json
RUN npm install
