export enum PublicKeyFormat {
  /* eslint-disable @typescript-eslint/naming-convention */
  OPENSSH = 'OPENSSH',
  PEM = 'PEM',
  /* eslint-enable @typescript-eslint/naming-convention */
}

export interface ResourceProperties {
  /* eslint-disable @typescript-eslint/naming-convention */
  Name: string;
  StorePublicKey?: 'true' | 'false'; // props passed via lambda always are of type string
  ExposePublicKey?: 'true' | 'false';
  PublicKey: string;
  SecretPrefix: string;
  Description: string;
  KmsPrivate: string;
  KmsPublic: string;
  PublicKeyFormat: PublicKeyFormat;
  RemoveKeySecretsAfterDays: number;
  StackName: string;
  Tags: Record<string, string>;
  /* eslint-enable @typescript-eslint/naming-convention */
}
