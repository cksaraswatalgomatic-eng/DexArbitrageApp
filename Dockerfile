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
RUN npx prisma generate
COPY backend/ .
RUN npm run build

# Stage 3: Production Image
FROM node:20-alpine
WORKDIR /app

# Copy environment and dependencies
COPY --from=backend-builder /app/backend/package.json /app/backend/package-lock.json /app/backend/
RUN cd backend && npm install --production

# Copy built backend and prisma schema
COPY --from=backend-builder /app/backend/dist ./backend/dist
COPY --from=backend-builder /app/backend/prisma ./backend/prisma

# Copy built frontend
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Expose port and run
EXPOSE ${PORT}
CMD ["node", "backend/dist/index.js"]
