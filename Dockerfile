# One image for api and worker (the worker overrides the command). Runs TypeScript via tsx for simplicity;
# a production build would compile to JS first.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY apps/mcp/package.json ./apps/mcp/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY evals/package.json ./evals/package.json
RUN npm ci --omit=dev
ENV NODE_ENV=production PORT=3000
USER node
EXPOSE 3000
CMD ["npm", "start", "-w", "@ic/api"]
