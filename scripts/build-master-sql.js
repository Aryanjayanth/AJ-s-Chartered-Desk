import fs from 'node:fs';
import path from 'node:path';

const migDir = path.resolve('supabase', 'migrations');
const files = fs.readdirSync(migDir).filter(f => f.endsWith('.sql')).sort();

const masterContent = [];

masterContent.push(`-- ==============================================================================`);
masterContent.push(`-- AJ's Chartered Desk: Master Database Schema & Complete Migrations`);
masterContent.push(`-- ==============================================================================`);
masterContent.push(`-- Consolidated Master SQL script containing all 25 migration steps in sequence.`);
masterContent.push(`-- Can be executed in the Supabase SQL Editor on a fresh project to establish the`);
masterContent.push(`-- entire schema, functions, triggers, RLS policies, permissions, and automation.`);
masterContent.push(`-- ==============================================================================\n`);

masterContent.push(`-- TABLE OF CONTENTS / MIGRATIONS INCLUDED:`);
files.forEach((file, idx) => {
  masterContent.push(`--   ${String(idx + 1).padStart(2, ' ')}. ${file}`);
});
masterContent.push(`-- ==============================================================================\n`);

files.forEach((file, idx) => {
  const filePath = path.join(migDir, file);
  const sql = fs.readFileSync(filePath, 'utf8').trim();

  masterContent.push(`\n-- ==============================================================================`);
  masterContent.push(`-- Migration ${idx + 1} of ${files.length}: ${file}`);
  masterContent.push(`-- ==============================================================================\n`);
  masterContent.push(sql);
  masterContent.push(`\n`);
});

const fullSql = masterContent.join('\n');
fs.writeFileSync(path.resolve('supabase', 'full_schema_setup.sql'), fullSql, 'utf8');
fs.writeFileSync(path.resolve('docs', 'backend.sql'), fullSql, 'utf8');

console.log(`[build:sql] Master schema successfully generated from ${files.length} migrations.`);
console.log(`[build:sql] Output files updated:`);
console.log(`  - supabase/full_schema_setup.sql (${fullSql.length} bytes, ${fullSql.split('\n').length} lines)`);
console.log(`  - docs/backend.sql (${fullSql.length} bytes, ${fullSql.split('\n').length} lines)`);
