export interface EtlSyncRun {
  id: number;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  status: string;
  total_tables: number | null;
  tables_ok: number | null;
  tables_failed: number | null;
  total_rows_synced: number | null;
  trigger: string;
}
