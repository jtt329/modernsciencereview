import {pool} from '@workspace/db';
let ready:Promise<unknown>|undefined;
export async function ensureJobSchema(){
  if(!ready)ready=pool.query(`CREATE TABLE IF NOT EXISTS formal_lab_jobs(id uuid PRIMARY KEY,owner_id text NOT NULL,kind text NOT NULL,status text NOT NULL,metadata jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()); CREATE INDEX IF NOT EXISTS formal_lab_job_owner_idx ON formal_lab_jobs(owner_id,created_at);`).catch(e=>{ready=undefined;throw e;});await ready;
}
