FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY src ./src
COPY migrations ./migrations
RUN mkdir -p uploads && chown -R node:node /app
USER node
EXPOSE 4000
CMD ["node","src/server.js"]
