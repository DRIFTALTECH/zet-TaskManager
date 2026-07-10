import argparse
import sys
import logging

import importer_config
import db
import sync

def main():
    parser = argparse.ArgumentParser(description="Standalone Clockify Importer for ZET")
    parser.add_argument(
        "--days",
        type=int,
        default=365,
        help="Number of historical days to fetch and reconcile (default: 365)"
    )
    args = parser.parse_args()

    # Configure logging to console
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s | %(message)s",
        handlers=[logging.StreamHandler(sys.stdout)]
    )
    
    logger = logging.getLogger("clockify_importer")
    logger.info("Starting Clockify sync (days: %d)", args.days)

    if not importer_config.clockify_configured():
        logger.error("Clockify is not configured. Please set CLOCKIFY_API_KEY and CLOCKIFY_WORKSPACE_ID in the .env file.")
        sys.exit(1)

    database = db.get_db()
    
    # Enter request scope to keep DB connection checked out for the import process,
    # similar to how FastAPI manages requests.
    database.enter_request_scope()
    
    try:
        results = sync.run_reconciliation_sync(
            database,
            importer_config.CLOCKIFY_API_KEY,
            importer_config.CLOCKIFY_WORKSPACE_ID,
            days=args.days
        )
        
        # Print Sync Summary
        print("\n" + "=" * 50)
        print("CLOCKIFY SYNC SUMMARY")
        print("=" * 50)
        print(f"Status:            {results.get('status', 'N/A').upper()}")
        print(f"Historical Days:   {results.get('days', args.days)}")
        print(f"Imported Entries:  {results.get('imported', 0)}")
        print(f"Updated Entries:   {results.get('updated', 0)}")
        print(f"Unchanged Entries: {results.get('unchanged', 0)}")
        print(f"Skipped Entries:   {results.get('skipped', 0)}")
        print(f"Failed Entries:    {results.get('failed', 0)}")
        print(f"Users Created:     {results.get('usersCreated', 0)}")
        print(f"Projects Created:  {results.get('projectsCreated', 0)}")
        print(f"Tasks Imported:    {results.get('tasksImported', 0)}")
        if results.get("skipSummary"):
            print("\nSkip reasons:")
            for reason, count in results["skipSummary"].items():
                print(f"  - {reason}: {count}")
        print("=" * 50 + "\n")
        
        sys.exit(0)
        
    except Exception as e:
        logger.exception("Synchronization failed with an error: %s", e)
        sys.exit(1)
        
    finally:
        database.close()

if __name__ == "__main__":
    main()
