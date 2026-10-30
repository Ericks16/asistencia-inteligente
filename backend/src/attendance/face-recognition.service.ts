import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  RekognitionClient,
  DetectFacesCommand,
  CompareFacesCommand,
  GetFaceLivenessSessionResultsCommand,
} from '@aws-sdk/client-rekognition';

export interface DetectedFace {
  index: number;
  boundingBox: { left: number; top: number; width: number; height: number };
  matchScore?: number;
}

export interface LivenessResult {
  isLive: boolean;
  confidence: number;
}

export interface MatchResult {
  matchScore: number;
  matched: boolean;
}

export interface IFaceRecognition {
  detectFaces(imageBytes: Buffer): Promise<DetectedFace[]>;
  compareFace(imageBytes: Buffer, targetImageRef: string): Promise<MatchResult>;
  verifyLiveness(sessionId: string): Promise<LivenessResult>;
}

/**
 * Implementación con AWS Rekognition. En entornos sin AWS se puede conmutar a
 * una implementación local FaceNet + pgvector (misma interfaz).
 */
@Injectable()
export class RekognitionFaceService implements IFaceRecognition {
  private readonly client: RekognitionClient;
  private readonly threshold: number;

  constructor(cfg: ConfigService) {
    this.client = new RekognitionClient({ region: cfg.get('AWS_REGION') ?? 'us-east-1' });
    this.threshold = Number(cfg.get('FACE_MATCH_THRESHOLD') ?? 0.95);
  }

  async detectFaces(imageBytes: Buffer): Promise<DetectedFace[]> {
    const res = await this.client.send(
      new DetectFacesCommand({ Image: { Bytes: imageBytes }, Attributes: ['ALL'] }),
    );
    return (res.FaceDetails ?? []).map((f, index) => ({
      index,
      boundingBox: {
        left: f.BoundingBox?.Left ?? 0,
        top: f.BoundingBox?.Top ?? 0,
        width: f.BoundingBox?.Width ?? 0,
        height: f.BoundingBox?.Height ?? 0,
      },
    }));
  }

  async compareFace(imageBytes: Buffer, targetImageRef: string): Promise<MatchResult> {
    // targetImageRef apunta a la foto de referencia cifrada en S3; se resuelve a
    // una URL firmada o se descarga/descifra antes de comparar.
    const res = await this.client.send(
      new CompareFacesCommand({
        SourceImage: { Bytes: imageBytes },
        TargetImage: { S3Object: { Bucket: process.env.AWS_S3_BUCKET, Name: targetImageRef } },
        SimilarityThreshold: this.threshold * 100,
      }),
    );
    const best = (res.FaceMatches ?? [])[0];
    const score = best?.Similarity ?? 0;
    return { matchScore: score / 100, matched: score / 100 >= this.threshold };
  }

  async verifyLiveness(sessionId: string): Promise<LivenessResult> {
    const res = await this.client.send(
      new GetFaceLivenessSessionResultsCommand({ SessionId: sessionId }),
    );
    const confidence = res.Confidence ?? 0;
    return { isLive: (res.Status ?? '') === 'SUCCEEDED' && confidence >= 0.9, confidence };
  }
}
