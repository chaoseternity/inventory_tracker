-- Migration 0007: R2 object storage key for SOP original files

ALTER TABLE sop_documents ADD COLUMN r2_key TEXT;

