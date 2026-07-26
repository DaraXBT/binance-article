import { restoreNextEnvDeclaration } from './next-env-restore';

/** Normalize the generated Next reference after the isolated Playwright server exits. */
export default async function globalTeardown(): Promise<void> {
  await restoreNextEnvDeclaration();
}
