-- Migration 049: Update compliance KB last_verified_date to 2026-03-16
UPDATE compliance_knowledge_base SET last_verified_date = '2026-03-16' WHERE last_verified_date < '2026-03-16';
