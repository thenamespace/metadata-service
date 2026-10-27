import { HttpException, Injectable, Logger } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';
import { FileType } from '../common/enums/file-type.enum';
import { Network } from '../common/enums/network.enum';

type MediaOperation = 'upload' | 'delete';
type MediaOutcome =
  | 'created_active'
  | 'replaced_active'
  | 'created_pending'
  | 'deleted'
  | 'not_found'
  | 'error';

@Injectable()
export class AvatarObservabilityService {
  private readonly logger = new Logger(AvatarObservabilityService.name);
  private readonly registry = new Registry();

  private readonly httpRequests = new Counter({
    name: 'avatar_service_http_requests_total',
    help: 'Avatar service HTTP requests.',
    labelNames: ['method', 'route', 'status_code'] as const,
    registers: [this.registry],
  });
  private readonly httpDuration = new Histogram({
    name: 'avatar_service_http_request_duration_seconds',
    help: 'Avatar service HTTP request duration.',
    labelNames: ['method', 'route', 'status_code'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registry],
  });
  private readonly siweVerifications = new Counter({
    name: 'avatar_service_siwe_verification_total',
    help: 'SIWE verification attempts.',
    labelNames: ['action', 'network', 'result'] as const,
    registers: [this.registry],
  });
  private readonly siweDuration = new Histogram({
    name: 'avatar_service_siwe_verification_duration_seconds',
    help: 'SIWE verification duration.',
    labelNames: ['action', 'network'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registry],
  });
  private readonly mediaOperations = new Counter({
    name: 'avatar_service_media_operations_total',
    help: 'Terminal avatar and header operations.',
    labelNames: ['media_type', 'network', 'operation', 'outcome'] as const,
    registers: [this.registry],
  });
  private readonly ensLookups = new Counter({
    name: 'avatar_service_ens_lookup_total',
    help: 'Avatar ENS ownership lookups.',
    labelNames: ['network', 'cache_status', 'outcome'] as const,
    registers: [this.registry],
  });
  private readonly ensDuration = new Histogram({
    name: 'avatar_service_ens_lookup_duration_seconds',
    help: 'Avatar ENS ownership lookup duration.',
    labelNames: ['network', 'cache_status'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registry],
  });
  private readonly storageOperations = new Counter({
    name: 'avatar_service_storage_operations_total',
    help: 'Avatar GCS operations.',
    labelNames: ['operation', 'media_type', 'network', 'outcome'] as const,
    registers: [this.registry],
  });
  private readonly storageDuration = new Histogram({
    name: 'avatar_service_storage_operation_duration_seconds',
    help: 'Avatar GCS operation duration.',
    labelNames: ['operation', 'media_type', 'network'] as const,
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registry],
  });
  private readonly uploadSize = new Histogram({
    name: 'avatar_service_media_upload_size_bytes',
    help: 'Validated avatar and header upload sizes.',
    labelNames: ['media_type'] as const,
    buckets: [65536, 262144, 524288, 1048576, 2097152, 5242880],
    registers: [this.registry],
  });
  private readonly pendingUploads = new Gauge({
    name: 'avatar_service_pending_uploads',
    help: 'Current in-memory pending avatar/header uploads.',
    registers: [this.registry],
  });
  private readonly pendingVerifications = new Counter({
    name: 'avatar_service_pending_verifications_total',
    help: 'Pending avatar/header verification outcomes.',
    labelNames: ['media_type', 'network', 'outcome'] as const,
    registers: [this.registry],
  });
  private readonly pendingCycleDuration = new Histogram({
    name: 'avatar_service_pending_verification_cycle_duration_seconds',
    help: 'Pending verification cycle duration.',
    registers: [this.registry],
  });

  async metrics(): Promise<string> {
    return this.registry.metrics();
  }

  contentType(): string {
    return this.registry.contentType;
  }

  recordHttp(
    method: string,
    route: string,
    statusCode: number,
    durationSeconds: number,
  ): void {
    const labels = {
      method,
      route,
      status_code: String(statusCode),
    };
    this.httpRequests.inc(labels);
    this.httpDuration.observe(labels, durationSeconds);
  }

  recordSiwe(
    action: FileType,
    network: Network,
    result: string,
    durationSeconds: number,
  ): void {
    this.siweVerifications.inc({ action, network, result });
    this.siweDuration.observe({ action, network }, durationSeconds);
  }

  siweResult(error: unknown): string {
    if (!(error instanceof HttpException)) return 'unknown_error';
    const response = error.getResponse();
    const code =
      typeof response === 'object' && response !== null && 'code' in response
        ? String((response as { code: unknown }).code).toLowerCase()
        : '';
    const allowed = new Set([
      'address_mismatch',
      'nonce_not_found',
      'nonce_mismatch',
      'signature_expired',
      'message_not_yet_valid',
      'invalid_address',
      'invalid_chain_id',
      'malformed_message',
      'signature_verification_failed',
      'unauthorized',
    ]);
    return allowed.has(code) ? code : 'unknown_error';
  }

  recordMedia(
    mediaType: FileType,
    network: Network,
    operation: MediaOperation,
    outcome: MediaOutcome,
  ): void {
    this.mediaOperations.inc({
      media_type: mediaType,
      network,
      operation,
      outcome,
    });
  }

  recordUploadSize(mediaType: FileType, bytes: number): void {
    this.uploadSize.observe({ media_type: mediaType }, bytes);
  }

  recordEnsLookup(
    network: Network,
    cacheStatus: 'hit' | 'miss' | 'not_applicable',
    outcome:
      | 'found'
      | 'not_found'
      | 'invalid_name'
      | 'rpc_error'
      | 'allowed'
      | 'denied'
      | 'pending',
    durationSeconds: number,
  ): void {
    this.ensLookups.inc({
      network,
      cache_status: cacheStatus,
      outcome,
    });
    this.ensDuration.observe(
      { network, cache_status: cacheStatus },
      durationSeconds,
    );
  }

  recordStorage(
    operation: 'read' | 'save' | 'delete',
    mediaType: FileType,
    network: Network,
    outcome: 'success' | 'not_found' | 'error',
    durationSeconds: number,
  ): void {
    this.storageOperations.inc({
      operation,
      media_type: mediaType,
      network,
      outcome,
    });
    this.storageDuration.observe(
      { operation, media_type: mediaType, network },
      durationSeconds,
    );
  }

  setPendingQueueSize(size: number): void {
    this.pendingUploads.set(size);
  }

  recordPending(mediaType: FileType, network: Network, outcome: string): void {
    this.pendingVerifications.inc({
      media_type: mediaType,
      network,
      outcome,
    });
  }

  recordPendingCycle(durationSeconds: number): void {
    this.pendingCycleDuration.observe(durationSeconds);
  }

  logEvent(event: string, fields: Record<string, unknown>): void {
    this.logger.log({
      event,
      event_version: 1,
      ...fields,
    });
  }
}
