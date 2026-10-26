import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth/auth.service';
import { FileType } from '../common/enums/file-type.enum';
import { Network } from '../common/enums/network.enum';
import { EnsService } from '../ens/ens.service';
import { UploadAuthorization } from '../ens/ens-v2-authorization';
import { AvatarObservabilityService } from '../observability/avatar-observability.service';
import { PendingUploadQueueService } from '../queue';
import { StorageService } from '../storage/storage.service';
import { AvatarController } from './avatar.controller';
import { AvatarService } from './avatar.service';
import { AvatarVerificationService } from './avatar-verification.service';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture(fileType: FileType) {
  const subname = 'child.example.eth';
  const network = Network.SEPOLIA;
  const recordPending = jest.fn();
  const observability = {
    setPendingQueueSize: jest.fn(),
    recordUploadSize: jest.fn(),
    recordMedia: jest.fn(),
    logEvent: jest.fn(),
    recordPending,
    recordPendingCycle: jest.fn(),
  } as unknown as AvatarObservabilityService;
  let generation = 0;
  let stored: { generation: string; buffer: Buffer } | undefined;
  const deleteGeneration = (
    _name: string,
    _network: Network,
    _type: FileType,
    expected?: string,
  ) => {
    if (!stored || (expected !== undefined && stored.generation !== expected)) {
      return Promise.resolve(false);
    }
    stored = undefined;
    return Promise.resolve(true);
  };
  const storage = {
    save: jest.fn((_name: string, _network: Network, buffer: Buffer) => {
      stored = { generation: String(++generation), buffer };
      return Promise.resolve(stored.generation);
    }),
    getFileBuffer: jest.fn(() =>
      Promise.resolve(
        stored ? { buffer: stored.buffer, contentType: 'image/png' } : null,
      ),
    ),
    getPublicUrl: jest.fn(() => 'https://example.invalid/image'),
    delete: jest.fn(deleteGeneration),
  };
  const authorization = jest
    .fn<Promise<UploadAuthorization>, []>()
    .mockResolvedValue('pending');
  const ens = {
    getUploadAuthorization: authorization,
  } as unknown as EnsService;
  const verifySiweAndConsume = jest.fn();
  const auth = { verifySiweAndConsume } as unknown as AuthService;
  const queue = new PendingUploadQueueService(observability);
  const storageService = storage as unknown as StorageService;
  const avatars = new AvatarService(
    storageService,
    new ConfigService(),
    observability,
  );
  const controller = new AvatarController(
    storageService,
    ens,
    avatars,
    auth,
    queue,
    observability,
  );
  const verifier = new AvatarVerificationService(
    queue,
    ens,
    storageService,
    observability,
  );
  const upload = (address: string, decision: UploadAuthorization) => {
    verifySiweAndConsume.mockResolvedValue({
      address,
      signedDomain: 'localhost',
    });
    authorization.mockResolvedValue(decision);
    const req = {
      body: {
        siweMessage: 'signed message',
        siweSignature: 'signature',
        address,
        [fileType]: {
          filename: 'image.png',
          mimetype: 'image/png',
          data: Buffer.from(address),
          size: address.length,
        },
      },
    };
    return fileType === FileType.AVATAR
      ? controller.upload(network, subname, req)
      : controller.uploadHeader(network, subname, req);
  };
  const entry = () => queue.get(subname, network, fileType);
  const stage = async () => {
    await upload('unrelated-signer', 'pending');
    const pending = (await entry())!;
    pending.uploadedAt = new Date(Date.now() - 600_000);
    return pending;
  };
  return {
    subname,
    network,
    queue,
    storage,
    verifier,
    authorization,
    observability,
    recordPending,
    upload,
    entry,
    stage,
    deleteGeneration,
    stored: () => stored,
  };
}

describe.each([FileType.AVATAR, FileType.HEADER])(
  '%s pending upload cleanup',
  (fileType) => {
    beforeEach(() => {
      jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => jest.restoreAllMocks());

    it('clears a superseded pending entry after an authorized replacement', async () => {
      const f = fixture(fileType);
      await f.stage();
      const result = await f.upload('owner', 'allowed');
      expect(result).not.toHaveProperty('generation');
      expect(await f.entry()).toBeNull();
      await f.verifier.processVerifications();
      expect(f.stored()?.buffer.toString()).toBe('owner');
      expect(f.storage.delete).not.toHaveBeenCalled();
    });

    it.each(['denied', 'pending', 'allowed'] as const)(
      'protects a replacement while a %s verification is in flight',
      async (decision) => {
        const f = fixture(fileType);
        const original = await f.stage();
        const lookup = deferred<UploadAuthorization>();
        const started = deferred<void>();
        f.authorization.mockImplementationOnce(() => {
          started.resolve();
          return lookup.promise;
        });
        const verification = f.verifier.processVerifications();
        await started.promise;
        await f.upload('owner', 'allowed');
        lookup.resolve(decision);
        await verification;
        expect(f.stored()?.buffer.toString()).toBe('owner');
        expect(await f.entry()).toBeNull();
        if (decision !== 'allowed') {
          expect(f.storage.delete).toHaveBeenCalledWith(
            f.subname,
            f.network,
            fileType,
            original.generation,
          );
        }
        expect(f.recordPending).toHaveBeenCalledWith(
          fileType,
          f.network,
          'superseded',
        );
      },
    );

    it('protects both the newer file and queue entry when replacement happens during deletion', async () => {
      const f = fixture(fileType);
      const original = await f.stage();
      f.authorization.mockResolvedValue('denied');
      const started = deferred<void>();
      const resume = deferred<void>();
      f.storage.delete.mockImplementationOnce(async (...args) => {
        started.resolve();
        await resume.promise;
        return f.deleteGeneration(...args);
      });
      const verification = f.verifier.processVerifications();
      await started.promise;
      const generation = await f.storage.save(
        f.subname,
        f.network,
        Buffer.from('newer-pending'),
      );
      await f.queue.add({ ...original, generation, uploadedAt: new Date() });
      resume.resolve();
      await verification;
      expect(f.stored()?.buffer.toString()).toBe('newer-pending');
      expect((await f.entry())?.generation).toBe(generation);
    });

    it('keeps pending verification when an authorized replacement fails to save', async () => {
      const f = fixture(fileType);
      const original = await f.stage();
      f.storage.save.mockRejectedValueOnce(new Error('Storage unavailable'));
      await expect(f.upload('owner', 'allowed')).rejects.toThrow(
        'Storage unavailable',
      );
      expect(await f.entry()).toBe(original);
    });

    it.each(['denied', 'pending'] as const)(
      'still deletes the original pending generation when %s',
      async (decision) => {
        const f = fixture(fileType);
        const original = await f.stage();
        f.authorization.mockResolvedValue(decision);
        await f.verifier.processVerifications();
        expect(f.storage.delete).toHaveBeenCalledWith(
          f.subname,
          f.network,
          fileType,
          original.generation,
        );
        expect(f.stored()).toBeUndefined();
        expect(await f.entry()).toBeNull();
      },
    );

    it('confirms an authorized pending entry without deleting its file', async () => {
      const f = fixture(fileType);
      await f.stage();
      f.authorization.mockResolvedValue('allowed');
      await f.verifier.processVerifications();
      expect(f.stored()).toBeDefined();
      expect(await f.entry()).toBeNull();
      expect(f.storage.delete).not.toHaveBeenCalled();
    });

    it.each(['rpc', 'storage'])(
      'retains pending uploads for retry after a %s failure',
      async (failure) => {
        const f = fixture(fileType);
        const original = await f.stage();
        if (failure === 'rpc')
          f.authorization.mockRejectedValue(new Error('RPC unavailable'));
        else
          f.storage.delete.mockRejectedValue(new Error('Storage unavailable'));
        await f.verifier.processVerifications();
        expect(await f.entry()).toBe(original);
        expect(f.stored()).toBeDefined();
        expect(f.recordPending).toHaveBeenCalledWith(
          fileType,
          f.network,
          'error',
        );
      },
    );
  },
);
