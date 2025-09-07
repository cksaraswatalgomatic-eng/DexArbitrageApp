# Stage 1: Build Frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm install
COPY frontend/ .
RUN npm run build

# Stage 2: Build Backend
FROM node:20-alpine AS backend-builder
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm install
COPY backend/ .
RUN npx prisma generate
RUN npm run build

# Stage 3: Production Image
FROM node:20-alpine
RUN apk add libssl1.1
WORKDIR /app

# Copy environment and dependencies
COPY --from=backend-builder /app/backend/package.json /app/backend/package-lock.json /app/backend/
RUN cd backend && npm install --production

# Copy built backend and prisma schema
COPY --from=backend-builder /app/backend/dist ./backend/dist
COPY --from=backend-builder /app/backend/prisma ./backend/prisma
COPY --from=backend-builder /app/backend/node_modules/.prisma ./backend/node_modules/.prisma
COPY --from=backend-builder /app/backend/node_modules/@prisma/client ./backend/node_modules/@prisma/client

# Copy built frontend
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Expose port and run
EXPOSE ${PORT}
CMD ["node", "backend/dist/index.js"]
