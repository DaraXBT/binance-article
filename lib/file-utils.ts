import * as fs from 'fs';
import * as path from 'path';

const ASSETS_DIR = path.join(process.cwd(), 'public', 'assets');

/**
 * Ensure assets directory exists
 */
export function ensureAssetsDir(): void {
  if (!fs.existsSync(ASSETS_DIR)) {
    fs.mkdirSync(ASSETS_DIR, { recursive: true });
  }
}

/**
 * Get safe file path for reading/writing assets
 * Prevents directory traversal attacks
 */
export function getSafeAssetPath(deckId: string, filename: string): string {
  // Validate inputs
  if (!deckId.match(/^[a-zA-Z0-9-]+$/)) {
    throw new Error('Invalid deck ID');
  }

  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    throw new Error('Invalid filename');
  }

  const deckDir = path.join(ASSETS_DIR, deckId);
  const filePath = path.join(deckDir, filename);

  // Ensure the file is within the assets directory
  if (!filePath.startsWith(ASSETS_DIR)) {
    throw new Error('Path traversal attempt detected');
  }

  return filePath;
}

/**
 * Get public URL for an asset
 */
export function getAssetUrl(deckId: string, filename: string): string {
  return `/assets/${deckId}/${filename}`;
}

/**
 * Create deck assets directory
 */
export function createDeckAssetDir(deckId: string): string {
  ensureAssetsDir();
  const deckDir = path.join(ASSETS_DIR, deckId);

  if (!fs.existsSync(deckDir)) {
    fs.mkdirSync(deckDir, { recursive: true });
  }

  return deckDir;
}

/**
 * Save file to assets
 */
export function saveAsset(
  deckId: string,
  filename: string,
  content: Buffer | string
): string {
  const filePath = getSafeAssetPath(deckId, filename);

  // Ensure directory exists
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (typeof content === 'string') {
    fs.writeFileSync(filePath, content, 'utf-8');
  } else {
    fs.writeFileSync(filePath, content);
  }

  return filePath;
}

/**
 * Read asset file
 */
export function readAsset(deckId: string, filename: string): Buffer {
  const filePath = getSafeAssetPath(deckId, filename);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Asset not found: ${filename}`);
  }

  return fs.readFileSync(filePath);
}

/**
 * Delete asset
 */
export function deleteAsset(deckId: string, filename: string): void {
  const filePath = getSafeAssetPath(deckId, filename);

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

/**
 * List all assets for a deck
 */
export function listDeckAssets(deckId: string): string[] {
  const deckDir = path.join(ASSETS_DIR, deckId);

  if (!fs.existsSync(deckDir)) {
    return [];
  }

  try {
    return fs.readdirSync(deckDir);
  } catch {
    return [];
  }
}

/**
 * Delete entire deck directory
 */
export function deleteDeckAssets(deckId: string): void {
  const deckDir = path.join(ASSETS_DIR, deckId);

  if (fs.existsSync(deckDir)) {
    fs.rmSync(deckDir, { recursive: true, force: true });
  }
}

/**
 * Get MIME type for file
 */
export function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();

  const mimeTypes: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.pdf': 'application/pdf',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.txt': 'text/plain',
  };

  return mimeTypes[ext] || 'application/octet-stream';
}
