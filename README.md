# Waiterix Backend

AI-powered restaurant ordering platform backend with serverless AWS architecture.

## Overview

Waiterix Backend is a fully serverless Node.js application built for AWS Lambda that powers the Waiterix restaurant management platform. It provides APIs for restaurant management, menu handling, order processing, AI-powered customer assistance, and real-time communication.

## Architecture

### AWS Services Used

- **AWS Lambda** - Serverless compute for API endpoints
- **AWS API Gateway** - REST API and WebSocket API management
- **AWS RDS PostgreSQL** - Primary database with connection pooling
- **AWS ElastiCache Redis** - Session management and caching
- **AWS S3** - Object storage for images and files
- **AWS SES** - Email service for receipts and notifications
- **AWS DynamoDB** - WebSocket connection state management
- **AWS Bedrock** - AI services for customer assistance
- **AWS Polly** - Text-to-speech conversion
- **AWS Transcribe** - Speech-to-text conversion

### Key Features

- 🤖 **AI-Powered Customer Service** - Multilingual AI waiter using AWS Bedrock
- 🎯 **Multi-Gateway Payment Processing** - Stripe, Paystack, Adyen, Telr support
- 🌐 **Real-time Communication** - WebSocket API for live updates
- 📱 **QR Code Menu System** - Dynamic QR codes for table ordering
- 🔊 **Voice Interaction** - Speech-to-text and text-to-speech capabilities
- 📊 **Analytics & Reporting** - Order tracking and restaurant insights
- 🌍 **Multi-language Support** - Automatic translation services
- 📧 **Email Integration** - Receipt generation and support emails

## Project Structure

```
waiterix-backend/
├── src/
│   ├── handlers/           # Lambda function handlers
│   │   └── api.ts         # Main API handler
│   ├── shared/            # Shared utilities and schema
│   │   ├── schema.ts      # Database schema definitions
│   │   ├── currencyMapping.ts
│   │   └── paymentGatewayUtils.ts
│   ├── utils/             # Utility functions
│   ├── db.ts              # Database connection (RDS PostgreSQL)
│   ├── s3Storage.ts       # S3 object storage service
│   ├── sesEmailService.ts # SES email service
│   ├── redisSessionManager.ts # Redis session management
│   ├── apiGatewayWebSocket.ts # WebSocket API management
│   ├── routes.ts          # API route definitions
│   ├── firebaseAuth.ts    # Firebase authentication
│   ├── paymentGateway.ts  # Payment processing
│   ├── bedrock.ts         # AWS Bedrock AI services
│   ├── polly.ts           # Text-to-speech service
│   ├── transcribe.ts      # Speech-to-text service
│   └── translationService.ts # Multi-language support
├── scripts/               # Utility scripts
│   ├── create-stripe-prices.ts
│   ├── setup-stripe-meters.ts
│   └── populate-harmonia-kitchen-simple.ts
├── migrations/            # Database migrations
├── serverless.yml         # Serverless Framework configuration
├── drizzle.config.ts      # Database ORM configuration
├── package.json           # Dependencies and scripts
├── tsconfig.json          # TypeScript configuration
├── webpack.config.js      # Webpack bundling configuration
└── AWS_MIGRATION_GUIDE.md # Comprehensive migration documentation
```

## Getting Started

### Prerequisites

- Node.js 20.x or later
- AWS CLI configured with appropriate credentials
- Serverless Framework CLI
- PostgreSQL database (AWS RDS)
- Redis instance (AWS ElastiCache)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd waiterix-backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your AWS and service configurations
   ```

4. **Set up AWS infrastructure**
   - Create RDS PostgreSQL instance
   - Create ElastiCache Redis cluster
   - Create S3 buckets
   - Configure SES for email sending
   - Set up DynamoDB table for WebSocket connections

5. **Run database migrations**
   ```bash
   npm run db:migrate
   ```

6. **Deploy to AWS**
   ```bash
   npm run deploy
   # or for production
   npm run deploy:prod
   ```

## Environment Variables

### Database Configuration
```env
DATABASE_URL=postgresql://username:password@rds-endpoint:5432/database
DB_HOST=your-rds-endpoint.region.rds.amazonaws.com
DB_PORT=5432
DB_NAME=waiterix
DB_USER=waiterix_user
DB_PASSWORD=your-secure-password
DB_SSL=true
```

### Redis Configuration
```env
REDIS_HOST=your-elasticache-endpoint.cache.amazonaws.com
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password
REDIS_DB=0
```

### AWS Services Configuration
```env
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_S3_BUCKET=waiterix-storage
AWS_S3_TRANSCRIBE_BUCKET=waiterix-transcribe-temp
SES_FROM_EMAIL=noreply@waiterix.com
SUPPORT_EMAIL=support@waiterix.com
WEBSOCKET_CONNECTIONS_TABLE=waiterix-websocket-connections
```

### Payment Gateway Configuration
```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_BASE_PRICE_ID=price_...
STRIPE_USAGE_PRICE_ID=price_...
PAYSTACK_SECRET_KEY=sk_test_...
ADYEN_API_KEY=your-adyen-key
TELR_STORE_ID=your-telr-store-id
```

### Firebase Configuration
```env
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY=your-private-key
FIREBASE_CLIENT_EMAIL=your-service-account-email
```

## API Endpoints

### Authentication
- `POST /api/auth/login` - User login
- `POST /api/auth/logout` - User logout
- `GET /api/auth/me` - Get current user

### Restaurant Management
- `GET /api/restaurant` - Get restaurant details
- `PUT /api/restaurant` - Update restaurant details
- `POST /api/restaurant/tables` - Create table
- `GET /api/restaurant/tables` - List tables

### Menu Management
- `GET /api/menu-items` - List menu items
- `POST /api/menu-items` - Create menu item
- `PUT /api/menu-items/:id` - Update menu item
- `DELETE /api/menu-items/:id` - Delete menu item

### Order Processing
- `POST /api/orders` - Create order
- `GET /api/orders` - List orders
- `PUT /api/orders/:id/status` - Update order status
- `GET /api/orders/:id/receipt` - Get order receipt

### Payment Processing
- `POST /api/payments/create-intent` - Create payment intent
- `POST /api/payments/confirm` - Confirm payment
- `POST /api/webhooks/stripe` - Stripe webhook
- `POST /api/webhooks/paystack` - Paystack webhook

### AI Services
- `POST /api/ai/chat` - AI chat completion
- `POST /api/ai/speech-to-text` - Convert speech to text
- `POST /api/ai/text-to-speech` - Convert text to speech

## WebSocket API

The WebSocket API provides real-time communication for:

- **Order Updates** - Real-time order status changes
- **Chef Notifications** - New orders and customer questions
- **Customer Assistance** - Live chat with AI waiter
- **Table Management** - Real-time table status updates

### Connection
```javascript
const ws = new WebSocket('wss://your-api-gateway-url/dev');
```

### Message Types
- `new-question` - Customer question for chef
- `chef-answer` - Chef response to customer
- `order-status-changed` - Order status update
- `new-assistance-request` - Customer assistance request

## Database Schema

The application uses PostgreSQL with Drizzle ORM. Key tables include:

- **users** - User accounts and profiles
- **restaurants** - Restaurant information and settings
- **menu_items** - Menu items with pricing and descriptions
- **orders** - Customer orders and payment information
- **order_items** - Individual items within orders
- **restaurant_tables** - QR code enabled tables
- **faq_knowledge_base** - AI knowledge base for customer service
- **pending_questions** - Customer questions awaiting chef response
- **ratings** - Customer ratings and reviews

## Scripts

### Stripe Setup
```bash
# Create Stripe prices and products
npm run script:stripe-prices

# Set up Stripe meters for usage billing
npm run script:stripe-meters
```

### Database Population
```bash
# Populate sample restaurant data
npm run script:populate-demo
```

## Development

### Local Development
```bash
# Start local development server
npm run dev

# Run with serverless offline
npm run offline
```

### Database Operations
```bash
# Generate migration
npm run db:generate

# Run migrations
npm run db:migrate

# View database studio
npm run db:studio
```

### Testing
```bash
# Run tests
npm test

# Run tests with coverage
npm run test:coverage
```

## Deployment

### Development Deployment
```bash
npm run deploy
```

### Production Deployment
```bash
npm run deploy:prod
```

### Environment-specific Deployment
```bash
serverless deploy --stage staging
serverless deploy --stage production
```

## Monitoring and Logging

### CloudWatch Integration
- All Lambda functions automatically log to CloudWatch
- Custom metrics for API usage and performance
- Error tracking and alerting

### Performance Monitoring
- Lambda cold start optimization
- Database connection pooling
- Redis caching for session management
- S3 presigned URLs for efficient file uploads

## Security

### Authentication & Authorization
- Firebase Authentication integration
- JWT token validation
- Role-based access control
- Session management with Redis

### Data Protection
- Database encryption at rest
- S3 bucket encryption
- Secure environment variable handling
- CORS configuration for API security

### Payment Security
- PCI DSS compliant payment processing
- Webhook signature verification
- Secure API key management

## Troubleshooting

### Common Issues

1. **Lambda Timeout**
   - Increase timeout in serverless.yml
   - Optimize database queries
   - Implement connection pooling

2. **Database Connection Issues**
   - Check VPC configuration
   - Verify security group settings
   - Ensure RDS is accessible from Lambda

3. **Redis Connection Issues**
   - Verify ElastiCache security groups
   - Check Redis AUTH configuration
   - Ensure proper VPC setup

4. **S3 Upload Issues**
   - Verify IAM permissions
   - Check bucket policies
   - Ensure CORS configuration

### Debugging
```bash
# View logs
serverless logs -f api

# Tail logs in real-time
serverless logs -f api --tail

# Invoke function locally
serverless invoke local -f api
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For support and questions:
- Email: support@waiterix.com
- Documentation: See AWS_MIGRATION_GUIDE.md for detailed setup instructions
- Issues: Create an issue in the repository

---

**Built with ❤️ for restaurants worldwide**