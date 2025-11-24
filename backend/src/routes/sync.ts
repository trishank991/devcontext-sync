import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { db, projects, snippets, knowledge, syncSessions } from '../db';
import { eq, and, gt, inArray, sql } from 'drizzle-orm';
import { AuthRequest } from '../middleware/auth';
import { RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible';

const router = Router();

// ============================================
// Sync-specific rate limiting (stricter than global)
// ============================================
const syncPushLimiter = new RateLimiterMemory({
  points: 30,    // 30 pushes per minute
  duration: 60
});

const syncPullLimiter = new RateLimiterMemory({
  points: 60,    // 60 pulls per minute
  duration: 60
});

// Rate limit middleware for sync endpoints
async function syncRateLimit(
  limiter: RateLimiterMemory,
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const authReq = req as AuthRequest;
    // Require authenticated user ID - reject anonymous requests to sync endpoints
    const userId = authReq.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required for sync' });
    }
    await limiter.consume(userId);
    next();
  } catch (error) {
    const rateLimitError = error as RateLimiterRes;
    const retryAfter = rateLimitError.msBeforeNext
      ? Math.ceil(rateLimitError.msBeforeNext / 1000)
      : 60;
    res.status(429).json({
      error: 'Too many sync requests. Please wait before syncing again.',
      retryAfter
    });
  }
}

// ============================================
// Request size validation
// ============================================
const MAX_ITEMS_PER_SYNC = 500; // Maximum items per category per sync

// ============================================
// Sync data schema with stricter validation
// ============================================
const syncPushSchema = z.object({
  deviceId: z.string().min(1).max(100),
  lastSyncVersion: z.number().int().min(0),
  changes: z.object({
    projects: z.array(z.object({
      id: z.string().min(1).max(50),
      name: z.string().min(1).max(200),
      description: z.string().max(1000).optional(),
      createdAt: z.number().int().min(0),
      isDeleted: z.boolean().optional()
    })).max(MAX_ITEMS_PER_SYNC).optional(),
    snippets: z.array(z.object({
      id: z.string().min(1).max(50),
      projectId: z.string().min(1).max(50),
      code: z.string().max(100000), // 100KB max per snippet
      language: z.string().max(50),
      description: z.string().max(500).optional(),
      source: z.string().max(200).optional(),
      contentHash: z.string().max(100).optional(),
      createdAt: z.number().int().min(0),
      isDeleted: z.boolean().optional()
    })).max(MAX_ITEMS_PER_SYNC).optional(),
    knowledge: z.array(z.object({
      id: z.string().min(1).max(50),
      projectId: z.string().min(1).max(50),
      question: z.string().min(1).max(2000),
      answer: z.string().max(50000), // 50KB max per answer
      source: z.string().max(200).optional(),
      tags: z.array(z.string().max(50)).max(20).optional(),
      contentHash: z.string().max(100).optional(),
      createdAt: z.number().int().min(0),
      isDeleted: z.boolean().optional()
    })).max(MAX_ITEMS_PER_SYNC).optional()
  })
});

// Pull query schema
const syncPullSchema = z.object({
  since: z.string().optional().transform(val => {
    const num = parseInt(val || '0', 10);
    // Prevent negative values and NaN
    return Number.isNaN(num) || num < 0 ? 0 : num;
  }),
  projectId: z.string().max(50).optional(),
  deviceId: z.string().max(100).optional()
});

// ============================================
// Helper: Validate project ownership
// ============================================
async function validateProjectOwnership(
  userId: string,
  projectIds: string[]
): Promise<{ valid: boolean; invalidIds: string[] }> {
  if (projectIds.length === 0) return { valid: true, invalidIds: [] };

  const userProjects = await db.select({ id: projects.id })
    .from(projects)
    .where(and(
      eq(projects.userId, userId),
      inArray(projects.id, projectIds)
    ));

  const validProjectIds = new Set(userProjects.map(p => p.id));
  const invalidIds = projectIds.filter(id => !validProjectIds.has(id));

  return {
    valid: invalidIds.length === 0,
    invalidIds
  };
}

// ============================================
// Helper: Batch upsert operations using ON CONFLICT
// Uses PostgreSQL upsert for true batch operations (no N+1)
// ============================================
async function batchUpsertProjects(
  userId: string,
  projectChanges: z.infer<typeof syncPushSchema>['changes']['projects'],
  syncVersion: number
) {
  if (!projectChanges?.length) return;

  // Use PostgreSQL ON CONFLICT for true batch upsert (single query)
  await db.insert(projects)
    .values(
      projectChanges.map(proj => ({
        id: proj.id,
        userId,
        name: proj.name,
        description: proj.description,
        createdAt: new Date(proj.createdAt),
        updatedAt: new Date(),
        syncVersion,
        isDeleted: proj.isDeleted || false
      }))
    )
    .onConflictDoUpdate({
      target: projects.id,
      set: {
        name: sql`EXCLUDED.name`,
        description: sql`EXCLUDED.description`,
        updatedAt: sql`EXCLUDED.updated_at`,
        syncVersion: sql`EXCLUDED.sync_version`,
        isDeleted: sql`EXCLUDED.is_deleted`
      },
      // Only update if user owns the project
      where: eq(projects.userId, userId)
    });
}

async function batchUpsertSnippets(
  userId: string,
  snippetChanges: z.infer<typeof syncPushSchema>['changes']['snippets'],
  syncVersion: number,
  validProjectIds: Set<string>
) {
  if (!snippetChanges?.length) return;

  // Filter to only snippets with valid project IDs
  const validSnippets = snippetChanges.filter(s => validProjectIds.has(s.projectId));
  if (validSnippets.length === 0) return;

  // Use PostgreSQL ON CONFLICT for true batch upsert (single query)
  await db.insert(snippets)
    .values(
      validSnippets.map(snip => ({
        id: snip.id,
        userId,
        projectId: snip.projectId,
        code: snip.code,
        language: snip.language,
        description: snip.description,
        source: snip.source,
        contentHash: snip.contentHash,
        createdAt: new Date(snip.createdAt),
        updatedAt: new Date(),
        syncVersion,
        isDeleted: snip.isDeleted || false
      }))
    )
    .onConflictDoUpdate({
      target: snippets.id,
      set: {
        code: sql`EXCLUDED.code`,
        language: sql`EXCLUDED.language`,
        description: sql`EXCLUDED.description`,
        source: sql`EXCLUDED.source`,
        contentHash: sql`EXCLUDED.content_hash`,
        updatedAt: sql`EXCLUDED.updated_at`,
        syncVersion: sql`EXCLUDED.sync_version`,
        isDeleted: sql`EXCLUDED.is_deleted`
      },
      // Only update if user owns the snippet
      where: eq(snippets.userId, userId)
    });
}

async function batchUpsertKnowledge(
  userId: string,
  knowledgeChanges: z.infer<typeof syncPushSchema>['changes']['knowledge'],
  syncVersion: number,
  validProjectIds: Set<string>
) {
  if (!knowledgeChanges?.length) return;

  // Filter to only knowledge with valid project IDs
  const validKnowledge = knowledgeChanges.filter(k => validProjectIds.has(k.projectId));
  if (validKnowledge.length === 0) return;

  // Use PostgreSQL ON CONFLICT for true batch upsert (single query)
  await db.insert(knowledge)
    .values(
      validKnowledge.map(know => ({
        id: know.id,
        userId,
        projectId: know.projectId,
        question: know.question,
        answer: know.answer,
        source: know.source,
        tags: know.tags,
        contentHash: know.contentHash,
        createdAt: new Date(know.createdAt),
        updatedAt: new Date(),
        syncVersion,
        isDeleted: know.isDeleted || false
      }))
    )
    .onConflictDoUpdate({
      target: knowledge.id,
      set: {
        question: sql`EXCLUDED.question`,
        answer: sql`EXCLUDED.answer`,
        source: sql`EXCLUDED.source`,
        tags: sql`EXCLUDED.tags`,
        contentHash: sql`EXCLUDED.content_hash`,
        updatedAt: sql`EXCLUDED.updated_at`,
        syncVersion: sql`EXCLUDED.sync_version`,
        isDeleted: sql`EXCLUDED.is_deleted`
      },
      // Only update if user owns the knowledge
      where: eq(knowledge.userId, userId)
    });
}

// ============================================
// Push changes to server
// ============================================
router.post('/push',
  (req, res, next) => syncRateLimit(syncPushLimiter, req, res, next),
  async (req, res) => {
    try {
      const authReq = req as AuthRequest;
      const userId = authReq.user?.id;

      if (!userId) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const parseResult = syncPushSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          error: 'Invalid sync data',
          details: parseResult.error.errors.slice(0, 5) // Limit error details
        });
      }

      const { deviceId, changes } = parseResult.data;

      // Collect all project IDs from incoming changes that need validation
      const projectIdsFromSnippets = changes.snippets?.map(s => s.projectId) || [];
      const projectIdsFromKnowledge = changes.knowledge?.map(k => k.projectId) || [];
      const projectIdsFromProjects = changes.projects?.map(p => p.id) || [];

      // All referenced project IDs
      const allReferencedProjectIds = [
        ...new Set([...projectIdsFromSnippets, ...projectIdsFromKnowledge])
      ];

      // Validate that snippets/knowledge reference valid projects
      // Either the project exists and belongs to user, OR it's being created in this sync
      const newProjectIds = new Set(projectIdsFromProjects);
      const existingProjectCheck = allReferencedProjectIds.filter(id => !newProjectIds.has(id));

      if (existingProjectCheck.length > 0) {
        const validation = await validateProjectOwnership(userId, existingProjectCheck);
        if (!validation.valid) {
          return res.status(400).json({
            error: 'Invalid project references',
            invalidProjectIds: validation.invalidIds
          });
        }
      }

      // Build set of valid project IDs (existing + new)
      const validProjectIds = new Set([
        ...projectIdsFromProjects,
        ...existingProjectCheck
      ]);

      // Wrap all sync operations in a transaction for atomicity
      const result = await db.transaction(async (tx) => {
        // Get or create sync session for this user AND device
        let [session] = await tx
          .select()
          .from(syncSessions)
          .where(and(
            eq(syncSessions.userId, userId),
            eq(syncSessions.deviceId, deviceId)
          ))
          .limit(1);

        if (!session) {
          const sessionId = nanoid();
          await tx.insert(syncSessions).values({
            id: sessionId,
            userId,
            deviceId,
            syncVersion: 0
          });
          session = { id: sessionId, userId, deviceId, syncVersion: 0, lastSyncAt: new Date() };
        }

        const newSyncVersion = (session.syncVersion || 0) + 1;

        // Process all changes with batch operations using transaction
        if (changes.projects?.length) {
          await tx.insert(projects)
            .values(
              changes.projects.map(proj => ({
                id: proj.id,
                userId,
                name: proj.name,
                description: proj.description,
                createdAt: new Date(proj.createdAt),
                updatedAt: new Date(),
                syncVersion: newSyncVersion,
                isDeleted: proj.isDeleted || false
              }))
            )
            .onConflictDoUpdate({
              target: projects.id,
              set: {
                name: sql`EXCLUDED.name`,
                description: sql`EXCLUDED.description`,
                updatedAt: sql`EXCLUDED.updated_at`,
                syncVersion: sql`EXCLUDED.sync_version`,
                isDeleted: sql`EXCLUDED.is_deleted`
              },
              where: eq(projects.userId, userId)
            });
        }

        const validSnippets = changes.snippets?.filter(s => validProjectIds.has(s.projectId)) || [];
        if (validSnippets.length > 0) {
          await tx.insert(snippets)
            .values(
              validSnippets.map(snip => ({
                id: snip.id,
                userId,
                projectId: snip.projectId,
                code: snip.code,
                language: snip.language,
                description: snip.description,
                source: snip.source,
                contentHash: snip.contentHash,
                createdAt: new Date(snip.createdAt),
                updatedAt: new Date(),
                syncVersion: newSyncVersion,
                isDeleted: snip.isDeleted || false
              }))
            )
            .onConflictDoUpdate({
              target: snippets.id,
              set: {
                code: sql`EXCLUDED.code`,
                language: sql`EXCLUDED.language`,
                description: sql`EXCLUDED.description`,
                source: sql`EXCLUDED.source`,
                contentHash: sql`EXCLUDED.content_hash`,
                updatedAt: sql`EXCLUDED.updated_at`,
                syncVersion: sql`EXCLUDED.sync_version`,
                isDeleted: sql`EXCLUDED.is_deleted`
              },
              where: eq(snippets.userId, userId)
            });
        }

        const validKnowledge = changes.knowledge?.filter(k => validProjectIds.has(k.projectId)) || [];
        if (validKnowledge.length > 0) {
          await tx.insert(knowledge)
            .values(
              validKnowledge.map(know => ({
                id: know.id,
                userId,
                projectId: know.projectId,
                question: know.question,
                answer: know.answer,
                source: know.source,
                tags: know.tags,
                contentHash: know.contentHash,
                createdAt: new Date(know.createdAt),
                updatedAt: new Date(),
                syncVersion: newSyncVersion,
                isDeleted: know.isDeleted || false
              }))
            )
            .onConflictDoUpdate({
              target: knowledge.id,
              set: {
                question: sql`EXCLUDED.question`,
                answer: sql`EXCLUDED.answer`,
                source: sql`EXCLUDED.source`,
                tags: sql`EXCLUDED.tags`,
                contentHash: sql`EXCLUDED.content_hash`,
                updatedAt: sql`EXCLUDED.updated_at`,
                syncVersion: sql`EXCLUDED.sync_version`,
                isDeleted: sql`EXCLUDED.is_deleted`
              },
              where: eq(knowledge.userId, userId)
            });
        }

        // Update sync session
        await tx.update(syncSessions)
          .set({
            syncVersion: newSyncVersion,
            lastSyncAt: new Date()
          })
          .where(eq(syncSessions.id, session.id));

        return { syncVersion: newSyncVersion };
      });

      res.json({
        success: true,
        syncVersion: result.syncVersion
      });
    } catch (error) {
      // Sanitize error logging - don't log potentially sensitive user data
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Sync push error:', { message: errorMessage, timestamp: new Date().toISOString() });
      res.status(500).json({ error: 'Sync failed' });
    }
  }
);

// ============================================
// Pull changes from server
// ============================================
router.get('/pull',
  (req, res, next) => syncRateLimit(syncPullLimiter, req, res, next),
  async (req, res) => {
    try {
      const authReq = req as AuthRequest;
      const userId = authReq.user?.id;

      if (!userId) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      // Validate query parameters
      const parseResult = syncPullSchema.safeParse(req.query);
      if (!parseResult.success) {
        return res.status(400).json({
          error: 'Invalid query parameters',
          details: parseResult.error.errors
        });
      }

      const { since: sinceVersion, projectId, deviceId } = parseResult.data;

      // Build base conditions
      const projectConditions = [
        eq(projects.userId, userId),
        gt(projects.syncVersion, sinceVersion)
      ];

      const snippetConditions = [
        eq(snippets.userId, userId),
        gt(snippets.syncVersion, sinceVersion)
      ];

      const knowledgeConditions = [
        eq(knowledge.userId, userId),
        gt(knowledge.syncVersion, sinceVersion)
      ];

      // Optional: filter by specific project
      if (projectId) {
        // Validate project ownership
        const [userProject] = await db.select({ id: projects.id })
          .from(projects)
          .where(and(
            eq(projects.id, projectId),
            eq(projects.userId, userId)
          ))
          .limit(1);

        if (!userProject) {
          return res.status(404).json({ error: 'Project not found' });
        }

        snippetConditions.push(eq(snippets.projectId, projectId));
        knowledgeConditions.push(eq(knowledge.projectId, projectId));
      }

      // Execute queries in parallel for better performance
      const [changedProjects, changedSnippets, changedKnowledge, sessionResult] = await Promise.all([
        db.select()
          .from(projects)
          .where(and(...projectConditions)),
        db.select()
          .from(snippets)
          .where(and(...snippetConditions)),
        db.select()
          .from(knowledge)
          .where(and(...knowledgeConditions)),
        // Get sync version for this user's device (if specified) or highest version
        deviceId
          ? db.select()
              .from(syncSessions)
              .where(and(
                eq(syncSessions.userId, userId),
                eq(syncSessions.deviceId, deviceId)
              ))
              .limit(1)
          : db.select({ maxVersion: sql<number>`MAX(${syncSessions.syncVersion})` })
              .from(syncSessions)
              .where(eq(syncSessions.userId, userId))
      ]);

      // Determine sync version from result
      let currentSyncVersion = 0;
      if (deviceId && sessionResult.length > 0) {
        currentSyncVersion = (sessionResult[0] as { syncVersion: number | null }).syncVersion || 0;
      } else if (!deviceId && sessionResult.length > 0) {
        currentSyncVersion = (sessionResult[0] as { maxVersion: number | null }).maxVersion || 0;
      }

      res.json({
        syncVersion: currentSyncVersion,
        changes: {
          projects: changedProjects,
          snippets: changedSnippets,
          knowledge: changedKnowledge
        }
      });
    } catch (error) {
      // Sanitize error logging - don't log potentially sensitive user data
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Sync pull error:', { message: errorMessage, timestamp: new Date().toISOString() });
      res.status(500).json({ error: 'Failed to pull changes' });
    }
  }
);

export { router as syncRoutes };
