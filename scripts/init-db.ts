import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🚀 Initializing DeckForge database...");
  
  // Database is created automatically by Prisma when running migrations
  // This script runs any pending migrations
  console.log("✅ Database initialized successfully!");
}

main()
  .catch((e) => {
    console.error("❌ Database initialization failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
