import { Request, Response, NextFunction } from 'express';
import { RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible';

const rateLimiter = new RateLimiterMemory({
  points: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  duration: Math.floor(parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10) / 1000)
});

export async function rateLimiterMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    // Use IP or user ID as key
    const key = req.ip || 'anonymous';
    await rateLimiter.consume(key);
    next();
  } catch (error) {
    // RateLimiterMemory throws RateLimiterRes when rate limit is exceeded
    const rateLimitError = error as RateLimiterRes;
    const retryAfter = rateLimitError.msBeforeNext
      ? Math.ceil(rateLimitError.msBeforeNext / 1000)
      : 60; // Default to 60 seconds if msBeforeNext is not available

    res.status(429).json({
      error: 'Too many requests',
      retryAfter
    });
  }
}

export { rateLimiterMiddleware as rateLimiter };
