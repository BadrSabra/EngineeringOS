import { pool } from "./index.js";

// Keep the normal application role on SELECT/INSERT only. The trigger is a
// second boundary for ordinary DML; the table/function owner and superusers
// remain trusted schema administrators who can alter or disable the trigger.
const client = await pool.connect();

try {
  await client.query("BEGIN");
  await client.query(`
    CREATE OR REPLACE FUNCTION public.reject_ai_mission_decision_outcome_snapshot_mutation()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY INVOKER
    SET search_path = pg_catalog
    AS $function$
    BEGIN
      IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
        RETURN OLD;
      END IF;

      RAISE EXCEPTION 'mission decision outcome snapshots are immutable'
        USING ERRCODE = '55000';
    END;
    $function$
  `);
  await client.query(`
    DROP TRIGGER IF EXISTS trg_ai_mission_decision_outcome_snapshots_immutable
      ON public.ai_mission_decision_outcome_snapshots
  `);
  await client.query(`
    CREATE TRIGGER trg_ai_mission_decision_outcome_snapshots_immutable
      BEFORE UPDATE OR DELETE ON public.ai_mission_decision_outcome_snapshots
      FOR EACH ROW
      EXECUTE FUNCTION public.reject_ai_mission_decision_outcome_snapshot_mutation()
  `);
  await client.query("COMMIT");
  console.log("Mission outcome snapshots are protected from direct updates and deletes.");
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  console.error("Could not install Mission outcome snapshot immutability protection.", error);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
