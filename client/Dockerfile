# Stage 1: Build the frontend
FROM node:20 AS build

WORKDIR /app

# Copy only package files first to install dependencies
COPY package.json yarn.lock ./

# Install dependencies
RUN yarn install

# Copy the rest of the source code
COPY . .

# Run the build script from package.json
RUN yarn build

# Stage 2: Serve static files
FROM nginx:1.24-alpine

# Remove default nginx content
RUN rm -rf /usr/share/nginx/html/*

# Copy build from previous stage
COPY --from=build /app/build /usr/share/nginx/html

# Copy your nginx config (optional, if you want a separate conf)
# COPY ./nginx/conf.d/amongbots.conf /etc/nginx/conf.d/default.conf

EXPOSE 80 443

CMD ["nginx", "-g", "daemon off;"]
