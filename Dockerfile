FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY public ./public

ARG BUILD_ID=dev
ENV BUILD_ID=$BUILD_ID

USER 1000
EXPOSE 3000
CMD ["node", "src/server.js"]
