FROM node:20-alpine AS build
WORKDIR /app
COPY frontend/package*.json frontend/
RUN cd frontend && npm ci
COPY frontend frontend
COPY sdk/src sdk/src
COPY sdk/artifacts sdk/artifacts
RUN ln -s /app/frontend/node_modules /app/sdk/node_modules
RUN cd frontend && npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
