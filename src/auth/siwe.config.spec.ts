import { execFileSync } from 'node:child_process';
import {
  EIP6492_MAGIC_SUFFIX,
  isEIP6492Signature,
} from '@signinwithethereum/siwe';

interface AdapterProbeResult {
  result: boolean;
  readContractCalls: number;
  verifyMessageCalls: Array<{
    address: string;
    message: string;
    signature: string;
  }>;
}

describe('SIWE viem configuration', () => {
  it('routes an EIP-6492 signature through the configured viem public client', () => {
    const address = '0x000000000000000000000000000000000000c0de';
    const message = 'signed SIWE message';
    const signature = `0x1234${EIP6492_MAGIC_SUFFIX}`;
    const probe = execFileSync(
      process.execPath,
      [
        '-e',
        `
          const {
            createViemConfig,
            EIP6492_MAGIC_SUFFIX,
          } = require('@signinwithethereum/siwe');

          async function probeAdapter() {
            const verifyMessageCalls = [];
            let readContractCalls = 0;
            const publicClient = {
              chain: { id: 1 },
              verifyMessage: async (args) => {
                verifyMessageCalls.push(args);
                return true;
              },
              readContract: async () => {
                readContractCalls += 1;
                return '0x';
              },
            };
            const config = await createViemConfig({ publicClient });
            const result = await config.checkContractWalletSignature(
              '${address}',
              '${message}',
              '0x1234' + EIP6492_MAGIC_SUFFIX,
              1,
            );

            process.stdout.write(JSON.stringify({
              result,
              readContractCalls,
              verifyMessageCalls,
            }));
          }

          probeAdapter().catch((error) => {
            process.stderr.write(String(error));
            process.exitCode = 1;
          });
        `,
      ],
      { encoding: 'utf8' },
    );
    const result = JSON.parse(probe) as AdapterProbeResult;

    expect(isEIP6492Signature(signature)).toBe(true);
    expect(result).toEqual({
      result: true,
      readContractCalls: 0,
      verifyMessageCalls: [
        {
          address,
          message,
          signature,
        },
      ],
    });
  });
});
