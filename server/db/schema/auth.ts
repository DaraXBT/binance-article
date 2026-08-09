import {
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

const authTimestamp = (name: string) => timestamp(name, {
  mode: 'date',
  precision: 3,
  withTimezone: true,
});

export const userStatus = pgEnum('UserStatus', ['pending', 'active', 'suspended', 'revoked']);
export const userRole = pgEnum('UserRole', ['owner', 'user']);

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  emailVerified: boolean('emailVerified').default(false).notNull(),
  image: text('image'),
  status: userStatus('status').default('pending').notNull(),
  role: userRole('role').default('user').notNull(),
  createdAt: authTimestamp('createdAt').defaultNow().notNull(),
  updatedAt: authTimestamp('updatedAt').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('user_email_key').on(table.email),
  index('user_status_role_idx').on(table.status, table.role),
]);

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull().references(() => user.id, {
    onDelete: 'cascade',
    onUpdate: 'cascade',
  }),
  token: text('token').notNull(),
  expiresAt: authTimestamp('expiresAt').notNull(),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  createdAt: authTimestamp('createdAt').defaultNow().notNull(),
  updatedAt: authTimestamp('updatedAt').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('session_token_key').on(table.token),
  index('session_userId_idx').on(table.userId),
  index('session_expiresAt_idx').on(table.expiresAt),
]);

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull().references(() => user.id, {
    onDelete: 'cascade',
    onUpdate: 'cascade',
  }),
  accountId: text('accountId').notNull(),
  providerId: text('providerId').notNull(),
  accessToken: text('accessToken'),
  refreshToken: text('refreshToken'),
  idToken: text('idToken'),
  accessTokenExpiresAt: authTimestamp('accessTokenExpiresAt'),
  refreshTokenExpiresAt: authTimestamp('refreshTokenExpiresAt'),
  scope: text('scope'),
  password: text('password'),
  createdAt: authTimestamp('createdAt').defaultNow().notNull(),
  updatedAt: authTimestamp('updatedAt').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('account_providerId_accountId_key').on(table.providerId, table.accountId),
  index('account_userId_idx').on(table.userId),
]);

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: authTimestamp('expiresAt').notNull(),
  createdAt: authTimestamp('createdAt').defaultNow().notNull(),
  updatedAt: authTimestamp('updatedAt').defaultNow().notNull(),
}, (table) => [
  index('verification_identifier_idx').on(table.identifier),
  index('verification_expiresAt_idx').on(table.expiresAt),
]);
