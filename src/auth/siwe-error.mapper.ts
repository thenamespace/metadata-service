import { SiweErrorType } from '@signinwithethereum/siwe';
import { ErrorCodes } from '../common/enums/error-codes.enum';

/**
 * Translate a v4 SiweError into one of our public ErrorCodes.
 * Anything we don't have a specific code for collapses to SIGNATURE_VERIFICATION_FAILED.
 */
export function mapSiweError(err?: { type?: SiweErrorType }): ErrorCodes {
  switch (err?.type) {
    case SiweErrorType.DOMAIN_MISMATCH:
      return ErrorCodes.DOMAIN_MISMATCH;
    case SiweErrorType.NONCE_MISMATCH:
      return ErrorCodes.NONCE_MISMATCH;
    case SiweErrorType.EXPIRED_MESSAGE:
      return ErrorCodes.SIGNATURE_EXPIRED;
    case SiweErrorType.NOT_YET_VALID_MESSAGE:
      return ErrorCodes.MESSAGE_NOT_YET_VALID;
    case SiweErrorType.CHAIN_ID_MISMATCH:
      return ErrorCodes.INVALID_CHAIN_ID;
    case SiweErrorType.INVALID_ADDRESS:
      return ErrorCodes.INVALID_ADDRESS;
    case SiweErrorType.UNABLE_TO_PARSE:
      return ErrorCodes.MALFORMED_MESSAGE;
    default:
      return ErrorCodes.SIGNATURE_VERIFICATION_FAILED;
  }
}
