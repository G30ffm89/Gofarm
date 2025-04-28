package mqtt

import (
	"log"
	"os"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"
)

var client mqtt.Client

// MQTTConfig holds the configuration for the MQTT client.
type MQTTConfig struct {
	BrokerURL     string
	ClientID      string
	Username      string
	Password      string
	QoS           byte
	Retained      bool
	AutoReconnect bool
	MaxRetries    int
	RetryInterval time.Duration
}

// NewClient creates a new MQTT client.
func NewClient(config MQTTConfig) mqtt.Client {
	opts := mqtt.NewClientOptions().AddBroker(config.BrokerURL)
	opts.SetClientID(config.ClientID)
	if config.Username != "" {
		opts.SetUsername(config.Username)
		opts.SetPassword(config.Password)
	}
	opts.SetAutoReconnect(config.AutoReconnect)

	retries := 0
	for {
		client = mqtt.NewClient(opts)
		token := client.Connect()
		if token.WaitTimeout(config.RetryInterval) && token.Error() == nil {
			log.Println("Connected to MQTT broker:", config.BrokerURL)
			return client
		} else {
			log.Printf("Failed to connect to MQTT broker (attempt %d/%d): %v. Retrying in %s...",
				retries+1, config.MaxRetries, token.Error(), config.RetryInterval)
			retries++
			if retries >= config.MaxRetries {
				log.Fatalf("Failed to connect to MQTT broker after %d retries. Exiting.", config.MaxRetries)
				os.Exit(1)
			}
			time.Sleep(config.RetryInterval)
		}
	}
}

// Publish publishes a message to a specific MQTT topic.
func Publish(topic string, payload string) {
	if client == nil || !client.IsConnected() {
		log.Println("MQTT client not connected. Cannot publish:", topic, payload)
		return
	}
	token := client.Publish(topic, 0, false, payload)
	go func() { // Non-blocking wait for publish to complete
		if token.Wait() && token.Error() != nil {
			log.Printf("Error publishing to topic %s: %v", topic, token.Error())
		}
	}()
	log.Printf("Published to topic %s: %s", topic, payload)
}

// Close disconnects the MQTT client.
func Close() {
	if client != nil && client.IsConnected() {
		log.Println("Disconnecting from MQTT broker.")
		client.Disconnect(250) // Wait up to 250 milliseconds for inflight messages to be delivered
	}
}

// GetClient returns the current MQTT client instance.
func GetClient() mqtt.Client {
	return client
}
