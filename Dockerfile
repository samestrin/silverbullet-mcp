FROM node:24.22.1
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
EXPOSE 4000
# SB_FOLDER is not needed if using API access
CMD ["npm", "start"]