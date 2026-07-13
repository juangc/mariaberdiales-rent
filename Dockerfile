FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/index.html /app/portal.html ./
COPY --from=build --chown=node:node /app/assets ./assets
COPY --from=build --chown=node:node /app/server ./server
RUN mkdir -p /app/data /app/private-storage && chown -R node:node /app/data /app/private-storage
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server/app.mjs"]
