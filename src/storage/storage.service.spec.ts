import { FileType } from '../common/enums/file-type.enum';
import { Network } from '../common/enums/network.enum';
import { StorageService } from './storage.service';

describe('StorageService header paths', () => {
  const file = {
    save: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    exists: jest.fn().mockResolvedValue([true]),
    download: jest.fn().mockResolvedValue([Buffer.from('header')]),
    getMetadata: jest.fn().mockResolvedValue([{ contentType: 'image/png' }]),
  };
  const fileForPath = jest.fn(() => file);
  const storage = {
    bucket: jest.fn(() => ({ file: fileForPath })),
  };
  const service = Object.create(StorageService.prototype) as StorageService;

  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(service, 'bucketName', {
      configurable: true,
      value: 'avtr.cc',
    });
    Object.defineProperty(service, 'storage', {
      configurable: true,
      value: storage,
    });
  });

  it('returns compact public header URLs on both networks', () => {
    expect(
      service.getPublicUrl(
        'happy.ninjabase.eth',
        Network.MAINNET,
        FileType.HEADER,
      ),
    ).toBe('https://avtr.cc/happy.ninjabase.eth/h');
    expect(
      service.getPublicUrl(
        'happy.ninjabase.eth',
        Network.SEPOLIA,
        FileType.HEADER,
        '123',
      ),
    ).toBe('https://avtr.cc/sepolia/happy.ninjabase.eth/h?timestamp=123');
  });

  it('uses the compact header path for save, read, and delete', async () => {
    await service.save(
      'happy.ninjabase.eth',
      Network.MAINNET,
      Buffer.from('header'),
      FileType.HEADER,
      'image/png',
    );
    await service.getFileBuffer(
      'happy.ninjabase.eth',
      Network.MAINNET,
      FileType.HEADER,
    );
    await service.delete(
      'happy.ninjabase.eth',
      Network.MAINNET,
      FileType.HEADER,
    );

    expect(fileForPath).toHaveBeenCalledTimes(3);
    expect(fileForPath).toHaveBeenNthCalledWith(1, 'happy.ninjabase.eth/h');
    expect(fileForPath).toHaveBeenNthCalledWith(2, 'happy.ninjabase.eth/h');
    expect(fileForPath).toHaveBeenNthCalledWith(3, 'happy.ninjabase.eth/h');
  });
});
