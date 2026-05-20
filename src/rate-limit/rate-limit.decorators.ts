import { applyDecorators } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

export const AuthRateLimit = () =>
  applyDecorators(Throttle({ default: { ttl: 60, limit: 10 } }));
export const UploadRateLimit = () =>
  applyDecorators(Throttle({ default: { ttl: 60, limit: 5 } }));
export const DeleteRateLimit = () =>
  applyDecorators(Throttle({ default: { ttl: 60, limit: 10 } }));
export const ReadRateLimit = () =>
  applyDecorators(Throttle({ default: { ttl: 60, limit: 100 } }));
