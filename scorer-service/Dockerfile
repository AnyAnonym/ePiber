FROM node:20-slim

WORKDIR /app

COPY package.json .
RUN npm install --production

COPY server.js .
COPY config.js .
COPY dataStore.js .
COPY dataPoller.js .
COPY courtPoller.js .
COPY dataProvider.js .

EXPOSE 8080

CMD ["node", "server.js"]
