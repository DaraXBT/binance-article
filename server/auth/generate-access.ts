async function hashValue(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) {
    return false;
  }

  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return mismatch === 0;
}

export function getConfiguredGenerateAccessCode() {
  return process.env.GENERATE_ACCESS_CODE?.trim() ?? '';
}

export function isGenerateAccessEnabled() {
  return getConfiguredGenerateAccessCode().length > 0;
}

export async function isValidGenerateAccessCode(input: string) {
  const configured = getConfiguredGenerateAccessCode();

  if (!configured) {
    return false;
  }

  return constantTimeEqual(await hashValue(input.trim()), await hashValue(configured));
}
