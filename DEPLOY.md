# DevContext Sync - Deployment Guide

## Option 1: Vercel (Recommended)

1. Install Vercel CLI:
   ```bash
   npm install -g vercel
   ```

2. Deploy:
   ```bash
   cd /home/trishank/Projects/devcontext-sync/landing
   vercel
   ```

3. Follow prompts to link to your Vercel account

## Option 2: Netlify

1. Go to https://app.netlify.com
2. Click "Add new site" > "Deploy manually"
3. Drag and drop the `landing` folder

Or use CLI:
```bash
npm install -g netlify-cli
cd /home/trishank/Projects/devcontext-sync/landing
netlify deploy --prod
```

## Option 3: GitHub Pages

1. Create a GitHub repo
2. Push the landing folder contents
3. Go to Settings > Pages > Deploy from main branch

## Chrome Web Store Submission

1. Go to https://chrome.google.com/webstore/devconsole
2. Pay $5 one-time developer fee
3. Click "New Item"
4. Upload a ZIP of the extension folder:
   ```bash
   cd /home/trishank/Projects/devcontext-sync
   zip -r devcontext-sync-v1.0.0.zip manifest.json popup.* content.* background.js payments.js icons/
   ```
5. Fill in store listing using files in `/store/` folder
6. Submit for review

## Stripe Setup

1. Create account at https://dashboard.stripe.com
2. Go to Products > Create product:
   - Name: DevContext Sync Pro
   - Price: $12/month (recurring)
3. Go to Payment Links > Create payment link
4. Copy the link and update `payments.js`:
   ```javascript
   const PAYMENT_LINKS = {
     pro: 'https://buy.stripe.com/YOUR_ACTUAL_LINK',
     team: 'https://buy.stripe.com/YOUR_TEAM_LINK'
   };
   ```

## Post-Payment License Generation

For MVP, manually generate license keys:
- Format: DCS-XXXX-XXXX-XXXX
- Example: DCS-A1B2-C3D4-E5F6

Send to customers after Stripe payment confirmation.

For automation later:
- Use Stripe webhooks to trigger license generation
- Store licenses in a database
- Build a license validation API
