import { Router } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { db, users } from '../db';
import { eq } from 'drizzle-orm';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();

// License key format: DCS-XXXX-XXXX-XXXX
// Uses cryptographically secure random generation with rejection sampling
// to eliminate modulo bias
function generateLicenseKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const charsLength = chars.length; // 36
  // Largest multiple of 36 that fits in a byte (252 = 36 * 7)
  const maxValidByte = 256 - (256 % charsLength);

  const getUnbiasedRandomChar = (): string => {
    let byte: number;
    // Rejection sampling: reject bytes >= 252 to eliminate bias
    do {
      byte = crypto.randomBytes(1)[0];
    } while (byte >= maxValidByte);
    return chars[byte % charsLength];
  };

  const segment = () =>
    Array.from({ length: 4 }, getUnbiasedRandomChar).join('');

  return `DCS-${segment()}-${segment()}-${segment()}`;
}

const verifySchema = z.object({
  licenseKey: z.string().regex(/^DCS-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/)
});

// Verify license and return JWT
router.post('/verify', async (req, res) => {
  try {
    const { licenseKey } = verifySchema.parse(req.body);

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.licenseKey, licenseKey))
      .limit(1);

    if (!user) {
      return res.status(404).json({ valid: false, error: 'License key not found' });
    }

    if (!user.isActive) {
      return res.status(403).json({ valid: false, error: 'License deactivated' });
    }

    if (user.expiresAt && new Date(user.expiresAt) < new Date()) {
      return res.status(403).json({ valid: false, error: 'License expired' });
    }

    // Generate JWT for API access
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const token = jwt.sign(
      { userId: user.id, licenseKey },
      jwtSecret,
      { expiresIn: '30d' }
    );

    res.json({
      valid: true,
      plan: user.plan,
      expiresAt: user.expiresAt?.toISOString(),
      token
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ valid: false, error: 'Invalid license key format' });
    }
    console.error('License verification error:', error);
    res.status(500).json({ valid: false, error: 'Verification failed' });
  }
});

// Generate new license (admin/stripe webhook)
router.post('/generate', async (req, res) => {
  try {
    // This should be protected by admin auth or Stripe webhook verification
    const adminKey = req.headers['x-admin-secret'];
    if (adminKey !== process.env.ADMIN_SECRET) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const { email, plan = 'pro', expiresAt } = req.body;

    const licenseKey = generateLicenseKey();
    const userId = nanoid();

    await db.insert(users).values({
      id: userId,
      email,
      licenseKey,
      plan,
      isActive: true,
      expiresAt: expiresAt ? new Date(expiresAt) : null
    });

    res.json({ licenseKey, userId });
  } catch (error) {
    console.error('License generation error:', error);
    res.status(500).json({ error: 'Failed to generate license' });
  }
});

// Deactivate license (requires authentication)
router.post('/deactivate', authMiddleware, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Get the user's license key from their profile
    const [user] = await db
      .select({ licenseKey: users.licenseKey })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Only allow users to deactivate their own license
    await db
      .update(users)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(users.id, userId));

    res.json({ success: true });
  } catch (error) {
    console.error('License deactivation error:', error);
    res.status(500).json({ error: 'Failed to deactivate license' });
  }
});

export { router as licenseRoutes };
