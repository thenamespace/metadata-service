declare module '@ambire/signature-validator' {
  export function verifyMessage(params: {
    signer: string;
    message: string;
    signature: string;
    provider: unknown; // viem public client
  }): Promise<boolean>;
}
