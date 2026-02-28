# Use bookworm (Debian) which is officially supported by Playwright
FROM node:20-bookworm

WORKDIR /app

# Copy package definition files
COPY package.json package-lock.json* ./

# Install project dependencies
RUN npm install

# Install Playwright browser and system dependencies
# We only install chromium to save image size, as it's typically used for web scrapers
RUN npx playwright install --with-deps chromium

# Copy the underlying source code
COPY . .

# Run the watchtower system
CMD ["npm", "start"]
