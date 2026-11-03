import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeleteObjectCommand, GetObjectCommand, GetObjectCommandOutput, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHash, randomUUID } from 'crypto';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { decryptAes256Gcm, encryptAes256Gcm } from '../attendance/crypto.util';

type AwsCommandClient = {
  send<Input extends object, Output extends object>(command: Input): Promise<Output>;
};

export interface StoredPhoto {
  key: string;
  hash: string;
}

export interface EncryptedPhoto {
  data: string;
  hash: string;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly provider: 'local' | 's3';
  private readonly bucket: string;
  private readonly localDir: string;
  private readonly s3?: S3Client;
  private readonly s3Commands?: AwsCommandClient;
  private readonly encryptionKey: Buffer;

  constructor(private readonly config: ConfigService) {
    const provider = config.get('PHOTO_STORAGE_PROVIDER') ?? 'local';
    if (provider !== 'local' && provider !== 's3') {
      throw new Error('PHOTO_STORAGE_PROVIDER debe ser local o s3');
    }
    this.provider = provider;
    this.bucket = config.get('AWS_S3_BUCKET') ?? '';
    const configuredLocalDir = config.get('PHOTO_LOCAL_DIR');
    const vercelTempDir = process.env.VERCEL ? '/tmp/asistencia-fotos' : './data/photos';
    this.localDir = resolve(configuredLocalDir ?? vercelTempDir);
    this.encryptionKey = this.readEncryptionKey();

    if (this.provider === 's3') {
      if (!this.bucket) throw new Error('AWS_S3_BUCKET es obligatorio con PHOTO_STORAGE_PROVIDER=s3');
      const client = new S3Client({
        region: config.get('AWS_REGION') ?? 'us-east-1',
        endpoint: config.get('S3_ENDPOINT') || undefined,
        forcePathStyle: config.get('S3_FORCE_PATH_STYLE') === 'true',
      });
      this.s3 = client;
      this.s3Commands = client as unknown as AwsCommandClient;
    }
  }

  async putPhoto(photo: Buffer, userId: string): Promise<StoredPhoto> {
    if (!photo?.length) throw new BadRequestException('La foto está vacía');
    const hash = createHash('sha256').update(photo).digest('hex');
    const key = `fotos/${userId}/${Date.now()}-${randomUUID()}.enc`;
    const encrypted = encryptAes256Gcm(photo, this.encryptionKey);
    const encryptedBytes = Buffer.from(JSON.stringify(encrypted), 'utf8');

    if (this.provider === 's3') {
      await this.s3Commands!.send<PutObjectCommand, object>(new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: encryptedBytes,
        ContentType: 'application/octet-stream',
        ServerSideEncryption: this.config.get('AWS_S3_SSE') || undefined,
      }));
    } else {
      const target = join(this.localDir, key);
      await mkdir(join(this.localDir, `fotos/${userId}`), { recursive: true });
      await writeFile(target, encryptedBytes);
    }

    return { key, hash };
  }

  encryptForDatabase(photo: Buffer): EncryptedPhoto {
    if (!photo?.length) throw new BadRequestException('La foto está vacía');
    const hash = createHash('sha256').update(photo).digest('hex');
    const encrypted = encryptAes256Gcm(photo, this.encryptionKey);
    return { data: Buffer.from(JSON.stringify(encrypted), 'utf8').toString('base64'), hash };
  }

  decryptFromDatabase(data: string): Buffer {
    return decryptAes256Gcm(
      JSON.parse(Buffer.from(data, 'base64').toString('utf8')),
      this.encryptionKey,
    );
  }

  async deletePhoto(key: string): Promise<void> {
    if (this.provider === 's3') {
      await this.s3Commands!.send<DeleteObjectCommand, object>(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return;
    }

    try {
      await unlink(join(this.localDir, key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  async getPhoto(key: string): Promise<Buffer> {
    let encryptedBytes: Buffer;
    if (this.provider === 's3') {
      const result = await this.s3Commands!.send<GetObjectCommand, GetObjectCommandOutput>(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!result.Body) throw new Error('La foto de referencia no tiene contenido');
      encryptedBytes = Buffer.from(await result.Body.transformToByteArray());
    } else {
      encryptedBytes = await readFile(join(this.localDir, key));
    }

    try {
      return decryptAes256Gcm(JSON.parse(encryptedBytes.toString('utf8')), this.encryptionKey);
    } catch (error) {
      throw new Error(`No se pudo descifrar la foto de referencia: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async signedUrl(key: string): Promise<string> {
    if (this.provider === 's3') {
      return getSignedUrl(this.s3!, new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }), { expiresIn: 300 });
    }
    return `/local-photo/${encodeURIComponent(key)}`;
  }

  private readEncryptionKey(): Buffer {
    const raw = this.config.get('PHOTO_ENCRYPTION_KEY');
    if (!raw) {
      if (this.provider === 's3') throw new Error('PHOTO_ENCRYPTION_KEY es obligatorio');
      this.logger.warn('PHOTO_ENCRYPTION_KEY no configurada; usando clave de desarrollo no persistente');
      return createHash('sha256').update('asistencia-dev-only').digest();
    }
    const key = Buffer.from(raw, 'base64');
    if (key.length !== 32) throw new Error('PHOTO_ENCRYPTION_KEY debe ser Base64 de 32 bytes');
    return key;
  }
}
