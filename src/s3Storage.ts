import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectAclCommand,
  GetObjectAclCommand
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Response } from "express";
import { randomUUID } from "crypto";

// AWS S3 client configuration
export const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  // Let AWS SDK auto-resolve credentials (handles AWS_SESSION_TOKEN automatically)
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

import { ObjectAclPolicy, ObjectPermission } from "./objectAcl";

// AWS S3-based object storage service
export class S3StorageService {
  private publicBucket: string;
  private privateBucket: string;

  constructor() {
    // Use AWS_S3_BUCKET from serverless.yml, or fall back to specific bucket env vars
    this.publicBucket = process.env.S3_PUBLIC_BUCKET || process.env.AWS_S3_BUCKET || 'waiterix-storage';
    this.privateBucket = process.env.S3_PRIVATE_BUCKET || process.env.AWS_S3_BUCKET || 'waiterix-storage';
  }

  // Get public object search paths (S3 buckets)
  getPublicObjectSearchPaths(): Array<string> {
    return [this.publicBucket];
  }

  // Get private object directory (S3 bucket)
  getPrivateObjectDir(): string {
    return this.privateBucket;
  }

  // Search for a public object
  async searchPublicObject(filePath: string): Promise<{ bucket: string; key: string } | null> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.publicBucket,
        Key: filePath,
      });

      await s3Client.send(command);
      return { bucket: this.publicBucket, key: filePath };
    } catch (error: any) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  // Download an object to the response
  async downloadObject(
    objectInfo: { bucket: string; key: string },
    res: Response,
    cacheTtlSec: number = 3600
  ) {
    try {
      const command = new GetObjectCommand({
        Bucket: objectInfo.bucket,
        Key: objectInfo.key,
      });

      const response = await s3Client.send(command);

      if (!response.Body) {
        throw new Error("No response body from S3");
      }

      // Set appropriate headers
      res.set({
        "Content-Type": response.ContentType || "application/octet-stream",
        "Content-Length": response.ContentLength?.toString() || "0",
        "Cache-Control": `${objectInfo.bucket === this.publicBucket ? "public" : "private"}, max-age=${cacheTtlSec}`,
        "ETag": response.ETag,
        "Last-Modified": response.LastModified?.toUTCString(),
      });

      // Stream the file to the response
      if (response.Body instanceof ReadableStream) {
        const reader = response.Body.getReader();

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(Buffer.from(value));
          }
          res.end();
        } finally {
          reader.releaseLock();
        }
      } else {
        // Handle other body types
        const chunks: Uint8Array[] = [];
        const stream = response.Body as any;

        stream.on('data', (chunk: Uint8Array) => chunks.push(chunk));
        stream.on('end', () => {
          const buffer = Buffer.concat(chunks);
          res.write(buffer);
          res.end();
        });
        stream.on('error', (err: Error) => {
          console.error("S3 stream error:", err);
          if (!res.headersSent) {
            res.status(500).json({ error: "Error streaming file" });
          }
        });
      }
    } catch (error) {
      console.error("Error downloading file from S3:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Error downloading file" });
      }
    }
  }

  // Get upload URL for an object entity (presigned URL)
  async getObjectEntityUploadURL(contentType?: string): Promise<string> {
    const objectId = randomUUID();
    const key = `public/uploads/${objectId}`;

    const command = new PutObjectCommand({
      Bucket: this.privateBucket,
      Key: key,
      ContentType: contentType, // Include Content-Type in the signature
    });

    // Generate presigned URL for PUT operation (15 minutes expiry)
    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 900 });
    return signedUrl;
  }

  // Get object entity file from object path
  async getObjectEntityFile(objectPath: string): Promise<{ bucket: string; key: string }> {
    // Support both legacy /objects/ and new /api/objects/ paths
    const normalizedPrefix = objectPath.startsWith("/api/objects/") ? "/api/objects/" : "/objects/";

    if (!objectPath.startsWith(normalizedPrefix)) {
      throw new ObjectNotFoundError();
    }

    const entityId = objectPath.substring(normalizedPrefix.length);
    if (!entityId) {
      throw new ObjectNotFoundError();
    }

    const key = entityId;

    try {
      // Check if the object exists in the bucket
      const command = new HeadObjectCommand({
        Bucket: this.privateBucket, // Both are usually the same
        Key: key,
      });

      await s3Client.send(command);
      return { bucket: this.privateBucket, key };
    } catch (error: any) {
      // If not found in private bucket, try public bucket (if different)
      if (this.publicBucket !== this.privateBucket) {
        try {
          const command = new HeadObjectCommand({
            Bucket: this.publicBucket,
            Key: key,
          });
          await s3Client.send(command);
          return { bucket: this.publicBucket, key };
        } catch (innerError) {
          throw new ObjectNotFoundError();
        }
      }
      throw new ObjectNotFoundError();
    }

  }

  // Normalize object entity path
  normalizeObjectEntityPath(rawPath: string): string {
    // Handle S3 URLs
    if (rawPath.startsWith("https://") && rawPath.includes(".s3.")) {
      try {
        const url = new URL(rawPath);
        const pathParts = url.pathname.split('/').filter(Boolean);

        if (pathParts.length > 0) {
          const key = pathParts.join('/');
          return `/api/objects/${key}`;
        }
      } catch (error) {
        console.warn("Failed to parse S3 URL:", rawPath);
      }
    }

    return rawPath;
  }

  // Set ACL policy for object entity
  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);

    if (!normalizedPath.startsWith("/objects/") && !normalizedPath.startsWith("/api/objects/")) {
      return normalizedPath;
    }

    try {
      const objectInfo = await this.getObjectEntityFile(normalizedPath);

      // Set S3 object ACL based on visibility
      const aclCommand = new PutObjectAclCommand({
        Bucket: objectInfo.bucket,
        Key: objectInfo.key,
        ACL: aclPolicy.visibility === "public" ? "public-read" : "private",
      });

      await s3Client.send(aclCommand);

      // Add metadata for owner tracking
      if (aclPolicy.owner) {
        // Note: S3 doesn't support custom metadata updates without copying the object
        // For now, we'll track ownership in the database or use S3 tags
        console.log(`Object ${objectInfo.key} ownership set to ${aclPolicy.owner}`);
      }

      return normalizedPath;
    } catch (error) {
      console.error("Error setting S3 object ACL:", error);
      return normalizedPath;
    }
  }

  // Check if user can access object entity
  async canAccessObjectEntity({
    userId,
    objectInfo,
    requestedPermission = ObjectPermission.READ,
  }: {
    userId?: string;
    objectInfo: { bucket: string; key: string };
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    try {
      // Public bucket objects are always readable
      if (objectInfo.bucket === this.publicBucket && requestedPermission === ObjectPermission.READ) {
        return true;
      }

      // For private objects, check ownership or permissions
      // This is a simplified implementation - in production, you'd want to
      // store ownership metadata in DynamoDB or use S3 object tags

      if (!userId) {
        return false; // No user, no access to private objects
      }

      // For now, allow access if user is authenticated
      // TODO: Implement proper ownership checking via DynamoDB or S3 tags
      return true;
    } catch (error) {
      console.error("Error checking S3 object access:", error);
      return false;
    }
  }

  // Delete an object
  async deleteObject(objectInfo: { bucket: string; key: string }): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: objectInfo.bucket,
      Key: objectInfo.key,
    });

    await s3Client.send(command);
  }

  // Upload object directly (for server-side uploads)
  async uploadObject(
    bucket: string,
    key: string,
    body: Buffer | Uint8Array | string,
    contentType?: string,
    acl: "public-read" | "private" = "private"
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      ACL: acl,
    });

    await s3Client.send(command);

    // Return the S3 URL
    if (acl === "public-read") {
      return `https://${bucket}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${key}`;
    } else {
      return `/api/objects/${key}`;
    }
  }
}

// Export singleton instance
export const s3StorageService = new S3StorageService();