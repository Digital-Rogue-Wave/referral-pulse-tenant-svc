#!/usr/bin/env bash

# Source environment file to load variables
source .env

# Copy environment file
cp .env.example .env

# Build Docker containers
docker-compose build

# Start PostgreSQL and Adminer using Docker Compose
docker-compose up -d

# Wait for PostgreSQL to be ready
./wait-for-it.sh $DATABASE_HOST:$DATABASE_PORT

# Check if migrations have already been applied
# if docker-compose exec -T postgres psql -U $DATABASE_USERNAME -d $DATABASE_NAME -c '\dt'; then
#   echo "Database already exists and migrations have been applied."
# else
  # Run migration generate command
  npm run migration:generate -- src/database/migrations/migration

  # Run migration command
  npm run migration:run

  # Run seed command
  npm run seed:run
# fi

# Run start development server command
npm run start:dev
