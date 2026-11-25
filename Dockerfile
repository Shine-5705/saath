FROM node:20-alpine
WORKDIR /app
COPY server.js package.json ./
COPY public ./public
ENV PORT=8797
EXPOSE 8797
HEALTHCHECK CMD wget -qO- http://localhost:8797/healthz || exit 1
CMD ["node", "server.js"]
