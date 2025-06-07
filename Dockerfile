# Stage 1: Build the application
FROM node:18-alpine AS builder
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (or npm-shrinkwrap.json)
COPY package*.json ./

# Install dependencies including devDependencies to build the project
RUN npm ci

# Copy the rest of the application source code
COPY . .

# Run the build script (assuming 'npm run build' compiles TypeScript to 'dist')
RUN npm run build

# Stage 2: Production image
FROM node:18-alpine AS production
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev

# Copy built application from the builder stage
# This includes the 'dist' folder and any other necessary assets
COPY --from=builder /usr/src/app/dist ./dist
# If you have other assets like config files in root that are needed at runtime, copy them too:
# COPY --from=builder /usr/src/app/config ./config
# COPY --from=builder /usr/src/app/docs ./docs # If docs are served or needed

# Expose the port the app runs on (should match PORT in src/index.ts or .env)
# The default in src/index.ts is 3000 if APP_PORT is not set.
EXPOSE 3000

# Define environment variable for Node.js
ENV NODE_ENV production

# Command to run the application
# This should match your start:prod script in package.json if it's just 'node dist/index.js'
CMD ["node", "dist/index.js"]
