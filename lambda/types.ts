// this file is physically present in /lambda, as it is required for build the lambda zip
// the file is symlinked into /lib, as otherwise jsii is refusing to find it, even when the whole lambda directory is not ignored

export enum LogLevel {
  /* eslint-disable @typescript-eslint/naming-convention */
  ERROR,
  WARN,
  INFO,
  DEBUG,
  /* eslint-enable @typescript-eslint/naming-convention */
}

export enum PublicKeyFormat {
  /* eslint-disable @typescript-eslint/naming-convention */
  /**
   * OpenSSH format
   */
  OPENSSH = 'openssh',

  /**
   * SSH format
   */
  SSH = 'ssh',

  /**
   * PEM format
   */
  PEM = 'pem',

  /**
   * PKCS#1 format
   */
  PKCS1 = 'pkcs1',

  /**
   * PKCS#8 format
   */
  PKCS8 = 'pkcs8',

  /**
   * Raw OpenSSH wire format
   *
   * As CloudFormation cannot handle binary data, if the public key is exposed in the template, the value is base64 encoded
   */
  RFC4253 = 'rfc4253',

  /**
   * PuTTY ppk format
   */
  PUTTY = 'putty',

  /* eslint-enable @typescript-eslint/naming-convention */
}

export enum KeyType {
  /* eslint-disable @typescript-eslint/naming-convention */
  RSA = 'rsa',
  ED25519 = 'ed25519',
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
  KeyType: KeyType;
  PublicKeyFormat: PublicKeyFormat;
  RemoveKeySecretsAfterDays: number;
  StackName: string;
  Tags: Record<string, string>;
  LogLevel?: LogLevel;
  /* eslint-enable @typescript-eslint/naming-convention */
}
