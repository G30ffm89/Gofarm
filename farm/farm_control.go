package main

import (
	"encoding/json"
	"fmt"
	"log"
	"time"

	"furitingoasis/temp_humid/mqtt"

	"gobot.io/x/gobot/v2"
	"gobot.io/x/gobot/v2/drivers/gpio"
	"gobot.io/x/gobot/v2/drivers/i2c"
	"gobot.io/x/gobot/v2/platforms/raspi"
)

const (
	target_temperature_min = 15.0
	target_temperature_max = 20.0
	target_humidity_min    = 70.0
	target_humidity_max    = 90.0
	fan_run_duration       = 5 * time.Second
	fan_interval           = 1 * time.Hour
	lights_on_hour_UTC     = 8
	lights_off_hour_UTC    = 20
	mqttBrokerURL          = "tcp://mos1:1883"
	mqttClientID           = "farm-controller"
	mqttTopicPrefix        = "farm/sensors"
)

type DeviceState struct {
	Pump       int    `json:"pump"`
	Heater     int    `json:"heater"`
	Fan        int    `json:"fan"`
	Mister     int    `json:"mister"`
	Lights     int    `json:"lights"`
	LastFanRun string `json:"last_fan_run"`
}

type SensorData struct {
	Temperature float32 `json:"temperature"`
	Humidity    float32 `json:"humidity"`
	Timestamp   string  `json:"timestamp"`
}

func main() {

	mqttConfig := mqtt.MQTTConfig{
		BrokerURL:     mqttBrokerURL,
		ClientID:      mqttClientID,
		AutoReconnect: false,           // You can set this to false since we have our own retry
		MaxRetries:    10,              // Number of times to retry the connection
		RetryInterval: 5 * time.Second, // Time to wait between retries
	}
	mqtt.NewClient(mqttConfig)
	defer mqtt.Close()

	r := raspi.NewAdaptor()

	sht2x := i2c.NewSHT2xDriver(r)

	pump_relay := gpio.NewRelayDriver(r, "32")
	heater_relay := gpio.NewRelayDriver(r, "36")
	fan_relay := gpio.NewRelayDriver(r, "16")
	mister_relay := gpio.NewRelayDriver(r, "18")
	led_light := gpio.NewRelayDriver(r, "22")

	var last_fan_run time.Time = time.Now()
	var fan_state int = 0
	var light_state int = 0
	var heater_state int = 0
	var pump_state int = 0
	var mister_state int = 0

	work := func() {
		gobot.Every(5*time.Second, func() {
			now_UTC := time.Now().UTC()
			hour_UTC := now_UTC.Hour()
			temp, err := sht2x.Temperature()
			if err != nil {
				log.Println("Error reading temperature:", err)
				return
			}

			humidity, err := sht2x.Humidity()
			if err != nil {
				log.Println("Error reading humidity:", err)
				return
			}

			if hour_UTC >= lights_on_hour_UTC && hour_UTC < lights_off_hour_UTC {
				fmt.Println("Turning LED lights ON (UTC).")
				led_light.Off()
				light_state = 1
			} else {
				fmt.Println("Turning LED lights OFF (UTC).")
				led_light.On()
				light_state = 0
			}

			fmt.Printf("Last Air Cycle Time: %s Temperature: %.2f°C, Humidity: %.2f%%\n", last_fan_run, temp, humidity)

			if temp < target_temperature_min {
				fmt.Println("Temperature too low, turning on heater.")
				heater_relay.Off()
				heater_state = 1
				pump_relay.On()
				pump_state = 0
			} else if temp > target_temperature_max {
				fmt.Println("Temperature too high, turning on pump.")
				pump_relay.Off()
				pump_state = 1
				heater_relay.On()
				heater_state = 0
			} else {
				fmt.Println("Temperature within range.")
				heater_relay.On()
				heater_state = 1
				pump_relay.On()
				pump_state = 0
			}

			if humidity < target_humidity_min {
				fmt.Println("Humidity too low, turning on humidifier")
				mister_relay.Off()
				mister_state = 1
			} else if humidity > target_humidity_max {
				fmt.Println("Humidity too high, turning on dehumidifier")
				mister_relay.On()
				mister_state = 0
			} else {
				fmt.Println("Humidity within range.")
			}

			// Publish device states
			deviceState := DeviceState{
				Pump:       pump_state,
				Heater:     heater_state,
				Fan:        fan_state,
				Mister:     mister_state,
				Lights:     light_state,
				LastFanRun: last_fan_run.Format(time.RFC3339),
			}
			deviceStateJSON, err := json.Marshal(deviceState)
			if err != nil {
				log.Println("Error marshaling device state:", err)
			} else {
				mqtt.Publish(mqttTopicPrefix+"/devices", string(deviceStateJSON))
			}

			// Publish temperature and humidity
			sensorData := SensorData{
				Temperature: temp,
				Humidity:    humidity,
				Timestamp:   time.Now().Format(time.RFC3339),
			}
			sensorDataJSON, err := json.Marshal(sensorData)
			if err != nil {
				log.Println("Error marshaling sensor data:", err)
			} else {
				mqtt.Publish(mqttTopicPrefix+"/sensors", string(sensorDataJSON))
			}

			if time.Since(last_fan_run) >= fan_interval {
				fmt.Println("Starting hourly fan run.")
				fan_relay.Off()
				fan_state = 1
				time.AfterFunc(fan_run_duration, func() {
					fmt.Println("Stopping hourly fan run.")
					fan_relay.On()
					fan_state = 0
					last_fan_run = time.Now()
				})
			}
		})
	}

	farmBot := gobot.NewRobot("FarmController",
		[]gobot.Connection{r},
		[]gobot.Device{sht2x, fan_relay, heater_relay, pump_relay, led_light, mister_relay},
		work,
	)

	if err := farmBot.Start(); err != nil {
		log.Fatal("Error starting robot:", err)
	}

	select {}

}
