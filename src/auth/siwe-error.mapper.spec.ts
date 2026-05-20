import { SiweErrorType } from '@signinwithethereum/siwe';
import { ErrorCodes } from '../common/enums/error-codes.enum';
import { mapSiweError } from './siwe-error.mapper';

describe('mapSiweError', () => {
  it.each([
    [SiweErrorType.DOMAIN_MISMATCH, ErrorCodes.DOMAIN_MISMATCH],
    [SiweErrorType.NONCE_MISMATCH, ErrorCodes.NONCE_MISMATCH],
    [SiweErrorType.EXPIRED_MESSAGE, ErrorCodes.SIGNATURE_EXPIRED],
    [SiweErrorType.NOT_YET_VALID_MESSAGE, ErrorCodes.MESSAGE_NOT_YET_VALID],
    [SiweErrorType.CHAIN_ID_MISMATCH, ErrorCodes.INVALID_CHAIN_ID],
    [SiweErrorType.INVALID_ADDRESS, ErrorCodes.INVALID_ADDRESS],
    [SiweErrorType.UNABLE_TO_PARSE, ErrorCodes.MALFORMED_MESSAGE],
  ])('maps %s -> %s', (input, expected) => {
    expect(mapSiweError({ type: input })).toBe(expected);
  });

  it('falls back to SIGNATURE_VERIFICATION_FAILED for INVALID_SIGNATURE', () => {
    expect(mapSiweError({ type: SiweErrorType.INVALID_SIGNATURE }))
      .toBe(ErrorCodes.SIGNATURE_VERIFICATION_FAILED);
  });

  it('falls back to SIGNATURE_VERIFICATION_FAILED for undefined err', () => {
    expect(mapSiweError(undefined)).toBe(ErrorCodes.SIGNATURE_VERIFICATION_FAILED);
  });

  it('falls back to SIGNATURE_VERIFICATION_FAILED for unknown type', () => {
    expect(mapSiweError({ type: 'TOTALLY_UNKNOWN' as SiweErrorType }))
      .toBe(ErrorCodes.SIGNATURE_VERIFICATION_FAILED);
  });
});
