# Small single-container deploy: builds the client and runs the game server.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev
ENV PORT=8787 DATA_DIR=/data
VOLUME /data
EXPOSE 8787
CMD ["npx", "tsx", "server/index.ts"]
