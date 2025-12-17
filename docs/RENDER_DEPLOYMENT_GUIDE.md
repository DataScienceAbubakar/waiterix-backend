# Render Deployment for Waiterix Realtime WebSocket Server

This guide walks you through deploying the OpenAI Realtime WebSocket server on Render for ~300-800ms voice latency.

## Why Render?

| Feature | Render | AWS Lambda |
|---------|--------|------------|
| **WebSocket Support** | ✅ Persistent | ❌ Short-lived |
| **Latency** | ~300-800ms | ~1-3 seconds |
| **Setup Complexity** | Easy | Complex |
| **Cold Starts** | None | 1-3 seconds |
| **Cost** | ~$7/month (Starter) | Pay per request |

## Quick Deploy (5 minutes)

### Step 1: Prepare the Code

The server file is already created at `render-realtime-server.ts`. We need to add it to package.json:

Add these to your `package.json`:

```json
{
  "scripts": {
    "start:render": "npx tsx render-realtime-server.ts",
    "build:render": "tsc render-realtime-server.ts --outDir dist-render --esModuleInterop --module commonjs --target ES2020"
  }
}
```

### Step 2: Create Render Account

1. Go to [render.com](https://render.com)
2. Sign up with GitHub (recommended for easy deployments)

### Step 3: Create New Web Service

1. Click **"New +"** → **"Web Service"**
2. Connect your GitHub repository (`waiterix-backend`)
3. Configure the service:

| Setting | Value |
|---------|-------|
| **Name** | `waiterix-realtime` |
| **Environment** | `Node` |
| **Region** | Choose closest to your users |
| **Branch** | `main` |
| **Build Command** | `npm install` |
| **Start Command** | `npx tsx render-realtime-server.ts` |
| **Instance Type** | `Starter` ($7/month) or `Free` |

### Step 4: Add Environment Variables

Click **"Environment"** and add:

| Key | Value |
|-----|-------|
| `OPENAI_API_KEY` | `sk-proj-your-key-here` |
| `FRONTEND_URL` | `https://main.d182r8qb7g7hdy.amplifyapp.com` |
| `PORT` | `10000` |

### Step 5: Deploy

Click **"Create Web Service"** and wait for deployment (~2-3 minutes).

Once deployed, you'll get a URL like:
```
https://waiterix-realtime.onrender.com
```

### Step 6: Update Frontend

In your Amplify environment variables, add:

```
VITE_REALTIME_WEBSOCKET_URL=wss://waiterix-realtime.onrender.com/ws/realtime
```

Then update `CustomerMenu.tsx`:

```tsx
// Uncomment this import:
import { RealtimeAIWaiter, RealtimeAIWaiterRef } from "@/components/RealtimeAIWaiter";

// And use RealtimeAIWaiter instead of FloatingAIWaiter
```

## render.yaml (Optional - Infrastructure as Code)

Create `render.yaml` in your repo root for automatic configuration:

```yaml
services:
  - type: web
    name: waiterix-realtime
    env: node
    plan: starter
    buildCommand: npm install
    startCommand: npx tsx render-realtime-server.ts
    healthCheckPath: /health
    envVars:
      - key: OPENAI_API_KEY
        sync: false
      - key: FRONTEND_URL
        value: https://main.d182r8qb7g7hdy.amplifyapp.com
      - key: PORT
        value: 10000
```

## Testing

### 1. Test Health Check
```bash
curl https://waiterix-realtime.onrender.com/health
```

Should return:
```json
{"status":"healthy","timestamp":"2024-12-17T16:30:00.000Z"}
```

### 2. Test WebSocket Connection

In browser console:
```javascript
const ws = new WebSocket('wss://waiterix-realtime.onrender.com/ws/realtime?restaurantId=test');
ws.onopen = () => console.log('Connected!');
ws.onmessage = (e) => console.log('Message:', e.data);
ws.onerror = (e) => console.error('Error:', e);
```

## Cost Breakdown

| Plan | Cost | RAM | Notes |
|------|------|-----|-------|
| Free | $0 | 512 MB | Spins down after 15 min inactivity |
| Starter | $7/mo | 512 MB | Always on |
| Standard | $25/mo | 2 GB | Production recommended |

Plus OpenAI costs:
- Audio input: $0.06/minute
- Audio output: $0.24/minute
- **~$0.30 per 1-minute conversation**

## Troubleshooting

### "Connection Failed" on Frontend

1. Check Render logs for errors
2. Verify OPENAI_API_KEY is set correctly
3. Ensure VITE_REALTIME_WEBSOCKET_URL uses `wss://` (not `ws://`)

### High Latency

1. Choose Render region closest to users
2. Consider upgrading to Standard plan for more resources

### "OpenAI API key not configured"

1. Go to Render Dashboard → Your Service → Environment
2. Add OPENAI_API_KEY with your key
3. Click "Save Changes" (service will redeploy)

### Service Spinning Down (Free Plan)

Free tier spins down after 15 minutes of inactivity. First request takes ~30 seconds.
- **Solution**: Upgrade to Starter ($7/month) for always-on service

## Monitoring

### Render Dashboard
- View logs in real-time
- Monitor CPU/memory usage
- Set up alerts for outages

### Adding Custom Logging

The server already logs key events. View them in Render → Logs.

## Scaling

If you need to handle more concurrent users:

1. **Upgrade Plan**: Standard ($25/month) handles more connections
2. **Add Instances**: Render Pro supports multiple instances
3. **Use Redis**: For session sharing across instances (future upgrade)

## Security Best Practices

1. ✅ API keys in Render environment variables (not in code)
2. ✅ FRONTEND_URL restricts CORS to your domain
3. ✅ HTTPS/WSS only (Render provides free SSL)
4. ⚠️ Don't commit API keys to Git

## Next Steps

1. Deploy to Render
2. Update frontend environment variable
3. Switch to RealtimeAIWaiter component
4. Rebuild and deploy frontend
5. Test the real-time voice experience!
