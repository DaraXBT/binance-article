import { PrismaClient } from "@prisma/client";

// Avoid instantiating PrismaClient in development multiple times
// See: https://www.prisma.io/docs/guides/other/troubleshooting-orm/help-articles/nextjs-prisma-client-instantiation

let prisma: PrismaClient;

if (process.env.NODE_ENV === "production") {
  prisma = new PrismaClient();
} else {
  if (!global.prisma) {
    global.prisma = new PrismaClient();
  }
  prisma = global.prisma;
}

declare global {
  var prisma: PrismaClient | undefined;
}

export default prisma;
