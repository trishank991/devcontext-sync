import { pgTable, text, timestamp, jsonb, boolean, integer } from 'drizzle-orm/pg-core';

// Users table - linked to license keys
export const users = pgTable('users', {
  id: text('id').primaryKey(), // UUID
  email: text('email').unique(),
  licenseKey: text('license_key').unique(),
  plan: text('plan').default('free'), // 'free', 'pro', 'team'
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  expiresAt: timestamp('expires_at'),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id')
});

// Sync sessions - tracks device syncs
export const syncSessions = pgTable('sync_sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id),
  deviceId: text('device_id'),
  lastSyncAt: timestamp('last_sync_at').defaultNow(),
  syncVersion: integer('sync_version').default(0)
});

// Projects - synced from extension
export const projects = pgTable('projects', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  syncVersion: integer('sync_version').default(0),
  isDeleted: boolean('is_deleted').default(false)
});

// Snippets - code snippets from AI chats
export const snippets = pgTable('snippets', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id),
  projectId: text('project_id').references(() => projects.id),
  code: text('code').notNull(),
  language: text('language').default('text'),
  description: text('description'),
  source: text('source'), // 'chatgpt', 'claude', etc.
  contentHash: text('content_hash'), // For duplicate detection
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  syncVersion: integer('sync_version').default(0),
  isDeleted: boolean('is_deleted').default(false)
});

// Knowledge - Q&A from AI chats
export const knowledge = pgTable('knowledge', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id),
  projectId: text('project_id').references(() => projects.id),
  question: text('question').notNull(),
  answer: text('answer').notNull(),
  source: text('source'),
  tags: jsonb('tags').$type<string[]>(),
  contentHash: text('content_hash'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  syncVersion: integer('sync_version').default(0),
  isDeleted: boolean('is_deleted').default(false)
});

// Activity log for analytics
export const activityLog = pgTable('activity_log', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id),
  action: text('action').notNull(), // 'save', 'delete', 'sync', 'export'
  itemType: text('item_type'), // 'snippet', 'knowledge', 'project'
  itemId: text('item_id'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow()
});
