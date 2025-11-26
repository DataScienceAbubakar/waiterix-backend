# Waiterix Backend AWS Migration Guide

This document outlines the complete migration of the Waiterix backend from external services to AWS-native services for serverless deployment.

## Overview

The backend has been refactored to use AWS services exclusively, enabling a fully serverless architecture with improved scalability, reliability, and cost-effectiveness.

## Architecture Changes

### Before Migration
- **Database**: Neon PostgreSQL (serverless)
- **Object Storage**: Replit Object Storage + Google Cloud Storage
- **Email Service**: Resend
- **Session Management**: PostgreSQL sessions
- **WebSocket**: Custom WebSocket server
- **Deployment**: Traditional server hosting

### After Migration
- **Database**: AWS RDS PostgreSQL with connection pooling
- **Object Storage**: AWS S3 with presigned URLs
- **Email Service**: AWS SES (Simple Email Service)
- **Session Management**: Redis (AWS ElastiCache)
- **WebSocket**: AWS API Gateway WebSocket API + DynamoDB
- **Deployment**: AWS Lambda serverless functions

## New AWS Services Integration

### 1. Database Migration (AWS RDS PostgreSQL)

**File**: `src/db.ts`

**Changes**:
- Migrated from `@neondatabase/serverless` to standard PostgreSQL with `pg` driver
- Added connection pooling for Lambda cold start optimization
- Support for both connection string and individual RDS parameters
- Graceful connection handling for serverless environment

**Configuration**:
```env
DATABASE_URL=postgresql://username:password@rds-endpoint:5432/database
DB_HOST=your-rds-endpoint.region.rds.amazonaws.com
DB_PORT=5432
DB_NAME=waiterix
DB_USER=waiterix_user
DB_PASSWORD=your-secure-password
DB_SSL=true
```

### 2. Object Storage Migration (AWS S3)

**File**: `src/s3Storage.ts`

**Features**:
- Complete S3 integration with presigned URLs for secure uploads
- Support for both public and private buckets
- Automatic content type detection
- URL normalization for different S3 URL formats
- Error handling and retry logic

**Configuration**:
```env
AWS_S3_BUCKET=waiterix-storage
AWS_S3_TRANSCRIBE_BUCKET=waiterix-transcribe-temp
AWS_S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
```

### 3. Email Service Migration (AWS SES)

**File**: `src/sesEmailService.ts`

**Features**:
- AWS SES integration for transactional emails
- Receipt email generation with order details
- Support email functionality
- Template-based email sending
- Proper error handling and logging

**Configuration**:
```env
SES_FROM_EMAIL=noreply@waiterix.com
SUPPORT_EMAIL=support@waiterix.com
AWS_REGION=us-east-1
```

### 4. Session Management Migration (Redis/ElastiCache)

**File**: `src/redisSessionManager.ts`

**Features**:
- Redis-based session storage for scalability
- Session lifecycle management (create, read, update, delete)
- Multi-session support per user
- Temporary data storage (verification codes, etc.)
- Automatic session cleanup and TTL management

**Configuration**:
```env
REDIS_HOST=your-elasticache-endpoint.cache.amazonaws.com
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password
REDIS_DB=0
```

### 5. WebSocket Migration (API Gateway + DynamoDB)

**File**: `src/apiGatewayWebSocket.ts`

**Features**:
- AWS API Gateway WebSocket API integration
- DynamoDB for connection state management
- Real-time notifications for orders, questions, and assistance
- Connection lifecycle management (connect, disconnect, message)
- Automatic stale connection cleanup

**Configuration**:
```env
WEBSOCKET_CONNECTIONS_TABLE=waiterix-websocket-connections
```

## Infrastructure Requirements

### AWS Services Needed

1. **AWS RDS PostgreSQL**
   - Instance class: db.t3.micro (for development) / db.t3.small+ (for production)
   - Multi-AZ deployment recommended for production
   - Automated backups enabled
   - Security groups configured for Lambda access

2. **AWS ElastiCache Redis**
   - Node type: cache.t3.micro (for development) / cache.t3.small+ (for production)
   - Cluster mode disabled for simplicity
   - Security groups configured for Lambda access

3. **AWS S3 Buckets**
   - Main storage bucket: `waiterix-storage`
   - Transcribe temporary bucket: `waiterix-transcribe-temp`
   - Proper IAM policies for Lambda access
   - CORS configuration for frontend uploads

4. **AWS SES**
   - Domain verification for sending emails
   - Production access (move out of sandbox)
   - Proper sending limits configured

5. **AWS DynamoDB**
   - Table: `waiterix-websocket-connections`
   - Pay-per-request billing mode
   - TTL enabled for automatic cleanup
   - Global secondary index on `restaurantId`

6. **AWS Lambda**
   - Runtime: Node.js 20.x
   - Memory: 1024 MB (adjustable based on usage)
   - Timeout: 30 seconds (60 seconds for AI functions)
   - VPC configuration for RDS/ElastiCache access

7. **AWS API Gateway**
   - REST API for HTTP endpoints
   - WebSocket API for real-time features
   - CORS configuration
   - Custom domain (optional)

## Deployment Configuration

### Serverless Framework Configuration

**File**: `serverless.yml`

Key updates:
- Comprehensive environment variables for all AWS services
- IAM permissions for all required AWS services
- Lambda function definitions for different service areas
- WebSocket API configuration
- DynamoDB table resource definition

### Environment Variables

```env
# Database Configuration
DATABASE_URL=postgresql://username:password@rds-endpoint:5432/database
DB_HOST=your-rds-endpoint.region.rds.amazonaws.com
DB_PORT=5432
DB_NAME=waiterix
DB_USER=waiterix_user
DB_PASSWORD=your-secure-password
DB_SSL=true

# Redis Configuration
REDIS_HOST=your-elasticache-endpoint.cache.amazonaws.com
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password
REDIS_DB=0

# AWS Services Configuration
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key

# S3 Storage Configuration
AWS_S3_BUCKET=waiterix-storage
AWS_S3_TRANSCRIBE_BUCKET=waiterix-transcribe-temp
AWS_S3_REGION=us-east-1

# SES Email Configuration
SES_FROM_EMAIL=noreply@waiterix.com
SUPPORT_EMAIL=support@waiterix.com

# DynamoDB Configuration
WEBSOCKET_CONNECTIONS_TABLE=waiterix-websocket-connections

# Application Configuration
FRONTEND_URL=https://your-amplify-app.amplifyapp.com
API_BASE_URL=https://your-api-gateway-url.execute-api.region.amazonaws.com/dev
```

## Package Dependencies

### Added Dependencies

```json
{
  "@aws-sdk/client-s3": "^3.x.x",
  "@aws-sdk/client-ses": "^3.x.x",
  "@aws-sdk/client-dynamodb": "^3.x.x",
  "@aws-sdk/client-apigatewaymanagementapi": "^3.x.x",
  "pg": "^8.x.x",
  "ioredis": "^5.x.x",
  "serverless-http": "^3.x.x"
}
```

### Removed Dependencies

```json
{
  "@neondatabase/serverless": "removed",
  "@google-cloud/storage": "removed",
  "@replit/object-storage": "removed",
  "resend": "removed"
}
```

## Migration Steps

### 1. Infrastructure Setup

1. **Create AWS RDS PostgreSQL instance**
   ```bash
   # Use AWS Console or CLI to create RDS instance
   # Configure security groups for Lambda access
   # Note the endpoint and credentials
   ```

2. **Create AWS ElastiCache Redis cluster**
   ```bash
   # Use AWS Console or CLI to create ElastiCache cluster
   # Configure security groups for Lambda access
   # Note the endpoint
   ```

3. **Create S3 buckets**
   ```bash
   aws s3 mb s3://waiterix-storage
   aws s3 mb s3://waiterix-transcribe-temp
   ```

4. **Configure SES**
   ```bash
   # Verify domain in SES console
   # Request production access
   # Configure sending limits
   ```

### 2. Database Migration

1. **Export data from Neon PostgreSQL**
2. **Import data to AWS RDS PostgreSQL**
3. **Update connection strings and test connectivity**

### 3. Code Deployment

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure environment variables**
   ```bash
   # Copy .env.example to .env
   # Fill in all AWS service configurations
   ```

3. **Deploy with Serverless Framework**
   ```bash
   npm run deploy
   # or
   serverless deploy --stage production
   ```

### 4. Testing and Validation

1. **Test API endpoints**
2. **Verify WebSocket functionality**
3. **Test file uploads to S3**
4. **Verify email sending through SES**
5. **Test session management with Redis**

## Performance Optimizations

### Lambda Cold Start Optimization

1. **Connection Pooling**: Database connections are pooled and reused
2. **Lazy Loading**: Services are initialized only when needed
3. **Memory Allocation**: Optimized memory settings for each function
4. **VPC Configuration**: Proper VPC setup to minimize cold start times

### Cost Optimization

1. **Pay-per-request**: DynamoDB and Lambda scale to zero
2. **S3 Lifecycle Policies**: Automatic cleanup of temporary files
3. **Redis Memory Optimization**: Proper TTL settings for session data
4. **RDS Instance Sizing**: Right-sized instances based on usage

## Monitoring and Logging

### CloudWatch Integration

- **Lambda Logs**: Automatic logging to CloudWatch
- **API Gateway Logs**: Request/response logging
- **RDS Performance Insights**: Database performance monitoring
- **ElastiCache Metrics**: Redis performance monitoring

### Error Handling

- **Graceful Degradation**: Fallback mechanisms for service failures
- **Retry Logic**: Automatic retries for transient failures
- **Error Notifications**: Proper error logging and alerting

## Security Considerations

### IAM Policies

- **Least Privilege**: Minimal required permissions for each service
- **Resource-Specific**: Permissions scoped to specific resources
- **Environment Separation**: Different policies for dev/staging/production

### Network Security

- **VPC Configuration**: Lambda functions in private subnets
- **Security Groups**: Restrictive inbound/outbound rules
- **Encryption**: Data encryption at rest and in transit

### Data Protection

- **S3 Bucket Policies**: Proper access controls
- **RDS Encryption**: Database encryption enabled
- **Redis AUTH**: Password protection for Redis
- **SES Domain Verification**: Proper domain authentication

## Troubleshooting

### Common Issues

1. **Lambda Timeout**: Increase timeout for database-heavy operations
2. **VPC Cold Starts**: Optimize VPC configuration
3. **Connection Limits**: Monitor and adjust RDS connection limits
4. **Memory Issues**: Adjust Lambda memory allocation
5. **CORS Issues**: Verify API Gateway CORS configuration

### Debugging Tools

- **CloudWatch Logs**: Real-time log monitoring
- **X-Ray Tracing**: Request tracing across services
- **RDS Performance Insights**: Database query analysis
- **API Gateway Test Console**: Endpoint testing

## Future Enhancements

### Potential Improvements

1. **Auto Scaling**: Implement auto-scaling for RDS and ElastiCache
2. **Multi-Region**: Deploy across multiple AWS regions
3. **CDN Integration**: CloudFront for static asset delivery
4. **Backup Automation**: Automated backup strategies
5. **Disaster Recovery**: Cross-region backup and recovery

### Monitoring Enhancements

1. **Custom Metrics**: Application-specific CloudWatch metrics
2. **Alerting**: Comprehensive alerting strategy
3. **Dashboard**: Operational dashboard for monitoring
4. **Performance Optimization**: Continuous performance tuning

## Support and Maintenance

### Regular Tasks

1. **Security Updates**: Keep dependencies updated
2. **Performance Monitoring**: Regular performance reviews
3. **Cost Optimization**: Monthly cost analysis
4. **Backup Verification**: Regular backup testing

### Documentation Updates

This guide should be updated whenever:
- New AWS services are integrated
- Configuration changes are made
- Performance optimizations are implemented
- Security policies are updated

---

**Last Updated**: November 2024
**Version**: 1.0.0
**Contact**: Development Team