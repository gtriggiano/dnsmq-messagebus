FROM node:argon-slim

WORKDIR /dnsmq-messagebus

ADD package.json package.json
RUN npm install

# Add node_modules/.bin to PATH
ENV PATH "/dnsmq-messagebus/node_modules/.bin:${PATH}"
