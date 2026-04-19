import './loadEnv.js';

import fs from 'fs/promises';
import path from 'path';
import bcrypt from 'bcryptjs';
import mysql from 'mysql2/promise';
import { v4 as uuidv4 } from 'uuid';
import { appDataDir, configDir, logsDir, projectRootDir, runtimeEnvFile } from './loadEnv.js';

function quoteIdentifier(value) {
  return `\`${String(value ?? '').replace(/`/g, '``')}\``;
}

function getBootstrapConnectionConfig() {
  return {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    waitForConnections: true,
    multipleStatements: true,
    charset: 'utf8mb4',
    connectTimeout: 5000,
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectWithRetry(maxAttempts = 15, delayMs = 2000) {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const conn = await mysql.createConnection(getBootstrapConnectionConfig());
      await setConnectionCollation(conn);
      return conn;
    } catch (error) {
      lastError = error;
      console.warn(`[runtimeSetup] Database connection attempt ${attempt}/${maxAttempts} failed: ${error.message}`);
      if (attempt < maxAttempts) {
        await delay(delayMs);
      }
    }
  }

  throw lastError;
}

async function setConnectionCollation(conn) {
  await conn.query("SET NAMES 'utf8mb4' COLLATE 'utf8mb4_unicode_ci'");
}

async function ensureRuntimeDirectories() {
  await Promise.all([
    fs.mkdir(appDataDir, { recursive: true }),
    fs.mkdir(configDir, { recursive: true }),
    fs.mkdir(logsDir, { recursive: true }),
  ]);
}

async function databaseHasBaseSchema(conn, dbName) {
  const [rows] = await conn.query(
    `SELECT 1
       FROM information_schema.tables
      WHERE table_schema = ?
        AND table_name = 'profiles'
      LIMIT 1`,
    [dbName]
  );
  return rows.length > 0;
}

function normalizeSchemaSqlForCompatibility(schemaSql) {
  return schemaSql.replace(
    /CHARSET=utf8mb4(?!\s+COLLATE=utf8mb4_unicode_ci)/g,
    'CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
  );
}

async function ensureSchema(conn, dbName) {
  await conn.query(`CREATE DATABASE IF NOT EXISTS ${quoteIdentifier(dbName)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.query(`USE ${quoteIdentifier(dbName)}`);

  if (await databaseHasBaseSchema(conn, dbName)) {
    return { schemaCreated: false };
  }

  const schemaSql = normalizeSchemaSqlForCompatibility(
    await fs.readFile(path.join(projectRootDir, 'server', 'schema.sql'), 'utf8')
  );
  await conn.query(schemaSql);
  return { schemaCreated: true };
}

async function ensureAdminUser(conn) {
  const adminName = process.env.ADMIN_NAME || 'Administrator';
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

  const [admins] = await conn.query(
    `SELECT id, email
       FROM profiles
      WHERE role = 'admin'
      LIMIT 1`
  );

  if (admins.length > 0) {
    return {
      created: false,
      email: String(admins[0].email ?? adminEmail),
      password: adminPassword,
    };
  }

  const hash = await bcrypt.hash(adminPassword, 12);
  await conn.query(
    `INSERT INTO profiles (id, name, email, password_hash, role, status)
     VALUES (?, ?, ?, ?, 'admin', 'active')`,
    [uuidv4(), adminName, adminEmail, hash]
  );

  return {
    created: true,
    email: adminEmail,
    password: adminPassword,
  };
}

export async function ensureRuntimeReady() {
  await ensureRuntimeDirectories();

  const dbName = process.env.DB_NAME || 'gcash_pos';
  const conn = await connectWithRetry();

  try {
    const schemaState = await ensureSchema(conn, dbName);
    const adminState = await ensureAdminUser(conn);

    return {
      dbName,
      schemaCreated: schemaState.schemaCreated,
      adminCreated: adminState.created,
      adminEmail: adminState.email,
      adminPassword: adminState.password,
      runtimeEnvFile,
    };
  } finally {
    await conn.end();
  }
}
