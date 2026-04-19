FROM node:20-bookworm-slim AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY server/package*.json ./server/
RUN npm --prefix server ci --omit=dev

COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV API_HOST=0.0.0.0
ENV PORT=4000

COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/README.md ./README.md

EXPOSE 4000
CMD ["node", "server/index.js"]
