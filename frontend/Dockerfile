FROM nginx:alpine

# Copy frontend files
COPY index.html /usr/share/nginx/html/index.html

# Copy nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80