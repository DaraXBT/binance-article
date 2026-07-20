import fs from 'node:fs/promises';

import {
  extractValidatedXPostBundle,
  type ExtractedXBundle,
} from './bundle.js';
import { postToX, type XBrowserOptions } from './x-browser.js';

/**
 * Inputs accepted by the reviewed X post workflow.
 *
 * A bundle is deliberately a one-way hand-off: it can prepare a browser
 * draft, but it cannot opt in to clicking X's final Post button.
 */
export interface XPostBundlePrepareOptions {
  bundlePath: string;
  profileDir?: string;
  chromePath?: string;
}
export interface XPostBundlePrepareResult {
  composed: true;
  articleId: string;
  imageCount: number;
}

/**
 * The dependency seam keeps archive validation, browser automation, and
 * cleanup independently testable.  The production defaults below are the
 * only implementations used by the CLI.
 */
export interface XPostBundleDependencies {
  extract?: (bundlePath: string) => Promise<ExtractedBundleForComposition>;
  compose?: (options: XBrowserOptions) => void | Promise<void>;
  remove?: (bundleDir: string) => void | Promise<void>;
}

/**
 * Only these fields are needed after validation.  Keeping this narrow also
 * makes it clear that the publisher never trusts arbitrary paths from the
 * manifest; they come from extractValidatedXPostBundle's bounded extraction.
 */
export interface ExtractedBundleForComposition {
  bundleDir: string;
  text: string;
  imagePaths: string[];
  manifest: { articleId: string };
}

function defaultExtract(bundlePath: string): Promise<ExtractedXBundle> {
  return extractValidatedXPostBundle(bundlePath);
}

async function defaultRemove(bundleDir: string): Promise<void> {
  await fs.rm(bundleDir, { recursive: true, force: true });
}

/**
 * Validate and compose a reviewed X post bundle in Chrome.
 *
 * `postToX` is always called with `submit: false`.  The browser remains open
 * in preview mode so the user can inspect the draft and click Post manually.
 * Extracted temporary files are removed on both success and failure.
 */
export async function prepareXPostBundle(
  options: XPostBundlePrepareOptions,
  dependencies: XPostBundleDependencies = {},
): Promise<XPostBundlePrepareResult> {
  const extract = dependencies.extract ?? defaultExtract;
  const compose = dependencies.compose ?? postToX;
  const remove = dependencies.remove ?? defaultRemove;

  const extracted = await extract(options.bundlePath);
  try {
    const composeOptions: XBrowserOptions = {
      text: extracted.text,
      images: extracted.imagePaths,
      profileDir: options.profileDir,
      submit: false,
    };
    if (options.chromePath) composeOptions.chromePath = options.chromePath;

    await compose(composeOptions);

    return {
      composed: true,
      articleId: extracted.manifest.articleId,
      imageCount: extracted.imagePaths.length,
    };
  } finally {
    await remove(extracted.bundleDir);
  }
}
