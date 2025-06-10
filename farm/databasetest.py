import sqlite3
from datetime import datetime, timedelta
import random
import os

# --- Configuration ---
# IMPORTANT: Replace with the actual path to your sensor_data.db file
# Ensure this path matches the one used by your Go applications.
DB_PATH = '/home/mike/Documents/Gofarm/farm/sensor_data.db'

# Number of days of historical data to generate
# Set this to more than 35 (e.g., 40-50) to test the rolling window deletion
NUM_DAYS_TO_GENERATE = 40

# --- Helper function to generate plausible random seconds for a day ---
def generate_random_seconds(min_hours, max_hours):
    """Generates a random number of seconds between min_hours and max_hours."""
    min_seconds = min_hours * 3600
    max_seconds = max_hours * 3600
    return random.randint(min_seconds, max_seconds)

def main():
    if not os.path.exists(DB_PATH):
        print(f"Error: Database file not found at '{DB_PATH}'. Please check the path.")
        print("Ensure your Go 'farm_control' program has run at least once to create the database file and tables.")
        return

    conn = None
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()

        # Verify the table exists (optional, but good for debugging)
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='device_daily_times';")
        if cursor.fetchone() is None:
            print(f"Error: Table 'device_daily_times' not found in '{DB_PATH}'.")
            print("Ensure your Go 'farm_control' program has the correct table creation logic.")
            return

        # Prepare the SQL INSERT statement
        # Using INSERT OR REPLACE to handle re-running the script safely (updates existing dates)
        insert_sql = """
        INSERT OR REPLACE INTO device_daily_times
        (date, pump_time_on, mister_time_on, heater_time_on, lights_time_on, fan_time_on)
        VALUES (?, ?, ?, ?, ?, ?)
        """

        # Start generating data from NUM_DAYS_TO_GENERATE days ago up to yesterday
        # This aligns with the Go program saving "yesterday's" data at midnight
        end_date = datetime.utcnow().date() - timedelta(days=1) # Yesterday's date UTC
        current_date = end_date - timedelta(days=NUM_DAYS_TO_GENERATE - 1)

        print(f"Populating '{DB_PATH}' with {NUM_DAYS_TO_GENERATE} days of data...")

        for i in range(NUM_DAYS_TO_GENERATE):
            date_str = current_date.strftime('%Y-%m-%d')

            # Generate random "on" times in seconds
            # Adjust these ranges for more realistic testing if desired
            pump_seconds = generate_random_seconds(0, 4)    # 0 to 4 hours
            mister_seconds = generate_random_seconds(0, 3)  # 0 to 3 hours
            heater_seconds = generate_random_seconds(0, 10) # 0 to 10 hours
            lights_seconds = generate_random_seconds(8, 16) # 8 to 16 hours (e.g., lights are on for a fixed period)
            fan_seconds = generate_random_seconds(0, 2)     # 0 to 2 hours

            data_to_insert = (
                date_str,
                pump_seconds,
                mister_seconds,
                heater_seconds,
                lights_seconds,
                fan_seconds
            )

            cursor.execute(insert_sql, data_to_insert)
            print(f"  Inserted/Updated data for {date_str}: {data_to_insert[1:]} seconds")

            current_date += timedelta(days=1) # Move to the next day

        conn.commit()
        print(f"\nSuccessfully populated {NUM_DAYS_TO_GENERATE} daily device time records.")

        # Optional: Verify the count
        cursor.execute("SELECT COUNT(*) FROM device_daily_times;")
        count = cursor.fetchone()[0]
        print(f"Current number of records in device_daily_times: {count}")


    except sqlite3.Error as e:
        print(f"SQLite error: {e}")
        if conn:
            conn.rollback() # Rollback changes if an error occurs
    except Exception as e:
        print(f"An unexpected error occurred: {e}")
    finally:
        if conn:
            conn.close()
            print("Database connection closed.")

if __name__ == "__main__":
    main()