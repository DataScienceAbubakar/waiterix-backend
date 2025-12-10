import fs from 'fs';
import path from 'path';

const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
    console.log('Loading .env from', envPath);
    const content = fs.readFileSync(envPath, 'utf8');
    content.split('\n').forEach(line => {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) {
            const key = match[1].trim();
            let value = match[2].trim();
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }
            if (!process.env[key]) {
                process.env[key] = value;
            }
        }
    });
} else {
    console.log('.env not found at', envPath);
}

// Fallback defaults from serverless.yml
const defaults: Record<string, string> = {
    DATABASE_URL: "postgresql://waiterix_user:Mypassword407%21@waiterix.cejyqycwo39y.us-east-1.rds.amazonaws.com:5432/waiterix",
    STRIPE_SECRET_KEY: "sk_test_51SXnfY2VZXX1nihiLJ78hL5DVPaOqoXhU2TwGCldGBJzrAgGNJ6lTxYsNW6bE1bMFJ7KIBH9Gdz7NJdOUyCYz2AE00Ux84umtM",
    FIREBASE_PROJECT_ID: "waiterix-65cc6",
    FIREBASE_PRIVATE_KEY: "AIzaSyA_AgNCd2jC65G4W8420ZJEDVh8jHPCSA8",
    FIREBASE_CLIENT_EMAIL: "umarkabir@harmoniallc.com",
    REDIS_HOST: "master.waiterix-redis.ufx4zx.use1.cache.amazonaws.com",
    REDIS_PORT: "6379",
    REDIS_PASSWORD: "AllahummasallialaMuhammad1!",
    FRONTEND_URL: "http://localhost:5173"
};

Object.entries(defaults).forEach(([key, value]) => {
    if (!process.env[key]) {
        console.log(`Setting default for ${key}`);
        process.env[key] = value;
    }
});
