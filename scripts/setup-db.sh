#!/bin/bash

# Setup DeckForge Database

echo "DeckForge Database Setup"
echo "======================="
echo ""

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
    echo "Creating SQLite database..."
    mkdir -p ./data
    export DATABASE_URL="file:./data/deck.db"
    echo "DATABASE_URL=$DATABASE_URL" >> .env.local
else
    echo "Using existing DATABASE_URL: $DATABASE_URL"
fi

# Run Prisma migrations
echo ""
echo "Running Prisma migrations..."
npx prisma migrate deploy

# Seed database if needed (optional)
echo ""
echo "Database setup complete!"
echo ""
echo "Next steps:"
echo "1. Start the development server: npm run dev"
echo "2. Visit http://localhost:3000 to start creating decks"
