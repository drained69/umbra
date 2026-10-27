FROM node:20-alpine AS build
WORKDIR /app
COPY frontend/package*.json frontend/
RUN cd frontend && npm ci
COPY frontend frontend
COPY sdk/src sdk/src
COPY sdk/artifacts sdk/artifacts
RUN ln -s /app/frontend/node_modules /app/sdk/node_modules
# Build-time settings (Railway passes service variables of the same name)
ARG VITE_RELAYER_URL=""
ARG VITE_REPO_URL=""
ENV VITE_RELAYER_URL=$VITE_RELAYER_URL VITE_REPO_URL=$VITE_REPO_URL
RUN cd frontend && npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
