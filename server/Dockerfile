# Use Node.js image
FROM node:18

# Set working directory
WORKDIR /app

# Copy package.json and install dependencies
COPY package.json package-lock.json ./
RUN npm install

# Copy all backend source files
COPY . .

EXPOSE 5000

# Start the backend
CMD ["npm", "start"]
