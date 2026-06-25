FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY static ./static
ENV NODE_ENV=production
EXPOSE 2038 3337
VOLUME ["/data"]
# health = dashboard answers with valid state (busybox wget ships with alpine)
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3337/api/state >/dev/null 2>&1 || exit 1
CMD ["node", "src/main.js"]
