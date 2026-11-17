# learn-backend

node + express api with postgres. supports text posts and image, video, pdf/txt/zip uploads.

## files

- server.js            the api
- schema.sql           creates the table on startup
- .env.example         settings template
- docker-compose.yml   local postgres
- ecosystem.config.cjs pm2 config for the server later

## api

- GET    /api/health       server and db status
- GET    /api/posts        list posts
- GET    /api/posts/:id    get one post
- POST   /api/posts        create post (multipart form: title, body, file)
- DELETE /api/posts/:id    delete post and its file
- GET    /uploads/<file>   the uploaded file

## run locally

work through these one at a time.

1. start postgres (docker):

       docker compose up -d

   or with homebrew:

       brew install postgresql@16
       brew services start postgresql@16
       psql postgres -c "CREATE USER learn WITH PASSWORD 'learnpass';"
       psql postgres -c "CREATE DATABASE learn_deploy OWNER learn;"

2. settings:

       cp .env.example .env

3. install and start:

       npm install
       npm run dev

4. test it:

       curl localhost:3001/api/health

   you should see {"status":"ok","db":"connected",...}
