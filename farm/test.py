import RPi.GPIO as GPIO
import time

# Pin Definitions
RELAY_PIN = 26  # BCM pin numbering

def setup_gpio():
    """Sets up the GPIO mode and initial state of the relay pin."""
    GPIO.setmode(GPIO.BCM)  # Use BCM pin numbering
    GPIO.setup(RELAY_PIN, GPIO.OUT)
    GPIO.output(RELAY_PIN, GPIO.LOW)  # Ensure relay is off initially (or desired default)
    print(f"GPIO pin {RELAY_PIN} set up as OUTPUT.")

def turn_on_relay():
    """Turns the relay ON."""
    GPIO.output(RELAY_PIN, GPIO.HIGH)
    print(f"Relay ON (GPIO {RELAY_PIN} HIGH)")

def turn_off_relay():
    """Turns the relay OFF."""
    GPIO.output(RELAY_PIN, GPIO.LOW)
    print(f"Relay OFF (GPIO {RELAY_PIN} LOW)")

def cleanup_gpio():
    """Cleans up GPIO settings."""
    GPIO.cleanup()
    print("GPIO cleanup complete.")

if __name__ == "__main__":
    try:
        setup_gpio()

        print("\n--- Testing Relay ---")

        # Turn relay ON
        turn_on_relay()
        time.sleep(5)  # Keep relay on for 2 seconds

        # Turn relay OFF
        turn_off_relay()
        time.sleep(5)  # Keep relay off for 1 second

        # You can add more logic here, e.g., a loop for user input or a more complex sequence
        print("\n--- Relay Test Complete ---")

    except KeyboardInterrupt:
        print("\nScript interrupted by user.")
    except Exception as e:
        print(f"An error occurred: {e}")
    finally:
        cleanup_gpio()