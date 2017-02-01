FROM node:argon-slim

WORKDIR /dnsmq-messagebus

# dumb-init to intercept SIGTERM
ADD dumb-init /usr/bin/dumb-init
RUN chmod +x /usr/bin/dumb-init

ADD package.json package.json
RUN npm install

# Add node_modules/.bin to PATH
ENV PATH "/dnsmq-messagebus/node_modules/.bin:${PATH}"

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
