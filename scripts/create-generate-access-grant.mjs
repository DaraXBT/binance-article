import { PrismaClient } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';

function hashValue(value) {
  return createHash('sha256').update(value).digest('hex');
}

function createCode() {
  return `gac_${randomBytes(18).toString('hex')}`;
}

const prisma = new PrismaClient();

async function main() {
  const configuredCode = process.env.GENERATE_ACCESS_CODE?.trim();

  if (!configuredCode) {
    throw new Error('GENERATE_ACCESS_CODE is required before issuing generation access grants.');
  }

  const providedCode = process.argv[2]?.trim();
  const rawCode = providedCode || createCode();

  if (!rawCode) {
    throw new Error('The generated access code was empty.');
  }

  const created = await prisma.generationAccessGrant.create({
    data: {
      codeHash: hashValue(rawCode),
      codePrefix: rawCode.slice(0, 12),
      envCodeHash: hashValue(configuredCode),
    },
  });

  console.log('Generation access grant created.');
  console.log(`Code: ${rawCode}`);
  console.log(`Prefix: ${created.codePrefix}`);
  console.log(`Grant ID: ${created.id}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
