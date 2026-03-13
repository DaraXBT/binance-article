export {
  GENERATE_ACCESS_COOKIE_NAME,
  clearGenerateAccess,
  consumeGenerateAccessGrant,
  createGenerateAccessCode,
  getConfiguredGenerateAccessCode,
  getConfiguredGenerateAccessCodeHash,
  getCurrentGenerateAccessState,
  getGenerateAccessCodePrefix,
  getRequestGenerateAccessState,
  grantGenerateAccess,
  hasGrantedGenerateAccess,
  hashGenerateAccessCode,
  isGenerateAccessEnabled,
  isValidGenerateAccessCode,
} from '@/server/auth/generate-access';
export type {
  ConsumeGenerateAccessGrantResult,
  GenerateAccessGrantFailureReason,
  GenerateAccessInvalidReason,
  GenerateAccessState,
} from '@/server/auth/generate-access';
