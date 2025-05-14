package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"strconv"
	"sync"
	"time"

	_ "github.com/mattn/go-sqlite3"

	"gobot.io/x/gobot/v2"
	"gobot.io/x/gobot/v2/drivers/gpio"
	"gobot.io/x/gobot/v2/drivers/i2c"
	"gobot.io/x/gobot/v2/platforms/mqtt"
	"gobot.io/x/gobot/v2/platforms/raspi"
)

const (
	mqttBrokerURL   = "tcp://mos1:1883"
	mqttClientID    = "farm-controller"
	mqttTopicPrefix = "farm/sensors"
	maxRetries      = 3
	retryInterval   = 2 * time.Second
)

type DeviceState struct {
	Pump       int    `json:"pump"`
	Heater     int    `json:"heater"`
	Fan        int    `json:"fan"`
	Mister     int    `json:"mister"`
	Lights     int    `json:"lights"`
	LastFanRun string `json:"last_fan_run"`
	PumpOver   string `json:"pump_over"`
	HeaterOver string `json:"heater_over"`
	FanOver    string `json:"fan_over"`
	MisterOver string `json:"mister_over"`
	LightsOver string `json:"lights_over"`
	ModeOver   string `json:"mode_over"`
	Error      string `json:"error"`
}

type Override struct {
	Pump_over   string `json:"pump_over"`
	Heater_over string `json:"heater_over"`
	Fan_over    string `json:"fan_over"`
	Mister_over string `json:"mister_over"`
	Lights_over string `json:"lights_over"`
	Mode_over   string `json:"mode_over"`
}

type SensorData struct {
	Temperature float32 `json:"temperature"`
	Humidity    float32 `json:"humidity"`
	Timestamp   string  `json:"timestamp"`
}

var overrides = map[string]string{
	"pump":   "no override",
	"heater": "no override",
	"fan":    "no override",
	"mister": "no override",
	"lights": "no override",
	"mode":   "fruiting",
	"error":  "no error",
}

var dbMutex sync.Mutex // Used for database to stop the program from spazzing if the bot tries to write while the db is open

type ConfigStatus struct {
	MinTemperature float32 `json:"target_temperature_min"`
	MaxTemperature float32 `json:"target_temperature_max"`
	MinHumidity    float32 `json:"target_humidity_min"`
	MaxHumidity    float32 `json:"target_humidity_max"`
	FanDuration    float64 `json:"fan_run_duration_minutes"`
	FanInterval    float64 `json:"fan_interval_minutes"`
	LightsOnHour   int     `json:"lights_on_hour_UTC"`
	LightsOffHour  int     `json:"lights_off_hour_UTC"`
}

func main() {
	var (
		last_fan_run           time.Time = time.Now()
		fan_state              int       = 0
		light_state            int       = 0
		heater_state           int       = 0
		pump_state             int       = 0
		mister_state           int       = 0
		target_temperature_min float32   = 15.0
		target_temperature_max float32   = 20.0
		target_humidity_min    float32   = 75.0
		target_humidity_max    float32   = 90.0
		fan_run_duration                 = 5 * time.Minute
		fan_interval                     = 60 * time.Minute
		lights_on_hour_UTC     int       = 8
		lights_off_hour_UTC    int       = 20
	)

	db, err := sql.Open("sqlite3", "/app/sensor_data.db")
	if err != nil {
		log.Fatalf("Error opening database: %v", err)
	}
	defer db.Close()

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS sensors (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			temperature REAL,
			humidity REAL,
			timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
		)
	`)
	if err != nil {
		log.Fatalf("Error creating sensors table: %v", err)
	}

	r := raspi.NewAdaptor()
	sht2x := i2c.NewSHT2xDriver(r)
	pump_relay := gpio.NewRelayDriver(r, "32")
	heater_relay := gpio.NewRelayDriver(r, "36")
	fan_relay := gpio.NewRelayDriver(r, "16")
	mister_relay := gpio.NewRelayDriver(r, "18")
	led_light := gpio.NewRelayDriver(r, "22")

	mqttAdaptor := mqtt.NewAdaptor(mqttBrokerURL, mqttClientID)

	sendMQTTAlert := func(message string) {
		if mqttAdaptor != nil {
			mqttAdaptor.Publish(mqttTopicPrefix+"/alerts", []byte(message))
			log.Println("MQTT alert sent:", message)
		} else {
			log.Println("MQTT not connected, cannot send alert:", message)
		}
	}

	clearDatabase := func() {
		dbMutex.Lock()
		defer dbMutex.Unlock()

		_, err := db.Exec("DELETE FROM sensors")
		if err != nil {
			log.Println("Error clearing sensors table:", err)
			sendMQTTAlert("Error clearing database (DELETE): " + err.Error())
			overrides["error"] = "database clear failed (delete)"
		} else {
			log.Println("Sensors table cleared.")
		}

		_, seqErr := db.Exec("DELETE FROM sqlite_sequence WHERE name='sensors'")
		if seqErr != nil {
			log.Println("Error resetting sequence for sensors table:", seqErr)
			errMsg := "database clear failed (seq reset): " + seqErr.Error()
			if err != nil {
				errMsg = "database clear failed (delete & seq reset): " + err.Error() + "; " + seqErr.Error()
			}
			sendMQTTAlert(errMsg)
			overrides["error"] = errMsg
		} else {
			log.Println("Auto-increment sequence for sensors table reset.")
			if err == nil {
				overrides["error"] = "none"
			}
		}
	}
	ticker := time.NewTicker(24 * time.Hour)
	defer ticker.Stop()

	go func() {
		for range ticker.C {
			log.Println("Initiating daily database clear...")
			clearDatabase()
		}
	}()

	readSensorData := func() (float32, float32, error) {
		var temp float32
		var humidity float32
		var err error
		for i := 0; i < maxRetries; i++ {
			temp, err = sht2x.Temperature()
			if err == nil {
				humidity, err = sht2x.Humidity()
				if err == nil {
					return temp, humidity, nil
				}
			}
			log.Printf("Error reading sensor data (attempt %d): %v\n", i+1, err)
			time.Sleep(retryInterval)
		}
		sendMQTTAlert("Failed to read sensor data after " + strconv.Itoa(maxRetries) + " attempts: " + err.Error())
		overrides["error"] = "sensor read failed"
		return 0, 0, err
	}

	work := func() {

		mqttAdaptor.On(mqttTopicPrefix+"/config", func(msg mqtt.Message) {
			fmt.Printf("Received config change: %s\n", string(msg.Payload()))
			var configData map[string]interface{}
			err := json.Unmarshal(msg.Payload(), &configData)
			if err != nil {
				log.Println("Error unmarshaling config JSON:", err)
				return
			}

			if tempMin, ok := configData["target_temperature_min"].(float64); ok {
				target_temperature_min = float32(tempMin)
				fmt.Println("Updated target_temperature_min to:", target_temperature_min)
			}
			if tempMax, ok := configData["target_temperature_max"].(float64); ok {
				target_temperature_max = float32(tempMax)
				fmt.Println("Updated target_temperature_max to:", target_temperature_max)
			}

			if fanDuration, ok := configData["fan_run_duration"].(float64); ok {
				fan_run_duration = time.Duration(fanDuration) * time.Minute
				fmt.Println("Updated fan_run_duration to:", fan_run_duration)
			}
			if fanInterval, ok := configData["fan_interval"].(float64); ok {
				fan_interval = time.Duration(fanInterval) * time.Minute
				fmt.Println("Updated fan_interval to:", fan_interval)
			}

			if lightsOn, ok := configData["lights_on_hour_UTC"].(float64); ok {
				lights_on_hour_UTC = int(lightsOn)
				fmt.Println("Updated lights_on_hour_UTC to:", lights_on_hour_UTC)
			}

			if lightsOff, ok := configData["lights_off_hour_UTC"].(float64); ok {
				lights_off_hour_UTC = int(lightsOff)
				fmt.Println("Updated lights_off_hour_UTC to:", lights_off_hour_UTC)
			}

		})

		mqttAdaptor.On(mqttTopicPrefix+"/override", func(msg mqtt.Message) {
			fmt.Printf("Received override command: %s\n", string(msg.Payload()))
			var overrideData Override
			err := json.Unmarshal(msg.Payload(), &overrideData)
			if err != nil {
				log.Println("Error unmarshaling override JSON:", err)
				return
			}
			if overrideData.Pump_over != "" {
				overrides["pump"] = overrideData.Pump_over
			}
			if overrideData.Heater_over != "" {
				overrides["heater"] = overrideData.Heater_over
			}
			if overrideData.Fan_over != "" {
				overrides["fan"] = overrideData.Fan_over
			}
			if overrideData.Mister_over != "" {
				overrides["mister"] = overrideData.Mister_over
			}
			if overrideData.Lights_over != "" {
				overrides["lights"] = overrideData.Lights_over
			}
			if overrideData.Mode_over != "" {
				overrides["mode"] = overrideData.Mode_over
			}
			fmt.Printf("Current Overrides: %+v\n", overrides)
		})

		runFanForDuration := func(fan_run_duration time.Duration) {
			fmt.Println("Starting fan run.")
			fan_relay.Off()
			fan_state = 1

			time.Sleep(fan_run_duration)

			fmt.Println("Stopping fan run.")
			fan_relay.On()
			fan_state = 0
			last_fan_run = time.Now()
		}

		gobot.Every(10*time.Second, func() {
			now_UTC := time.Now().UTC()
			hour_UTC := now_UTC.Hour()
			temp, humidity, err := readSensorData()
			if err != nil {
				log.Println("Error reading sensor data:", err)
				return
			}
			// fucked up the on/off need to change the wiring in the future
			if overrides["mode"] == "colonisation" {
				fmt.Println("Fruiting Mode - STATE: colonisation")
				led_light.On()
				light_state = 0
			} else if overrides["lights"] == "on" {
				fmt.Println("Light override - STATE: ON")
				led_light.Off()
				light_state = 1
			} else if overrides["lights"] == "off" {
				fmt.Println("Light override - STATE: OFF")
				led_light.On()
				light_state = 0
			} else {
				if hour_UTC >= lights_on_hour_UTC && hour_UTC < lights_off_hour_UTC {
					fmt.Println("Turning LED lights ON (UTC).")
					led_light.Off()
					light_state = 1
				} else {
					fmt.Println("Turning LED lights OFF (UTC).")
					led_light.On()
					light_state = 0
				}
			}

			fmt.Printf("Last Air Cycle Time: %s Temperature: %.2f°C, Humidity: %.2f%%\n", last_fan_run, temp, humidity)

			if overrides["heater"] == "on" {
				fmt.Println("Heater override - STATE: ON")
				heater_relay.Off()
				heater_state = 1
			} else if overrides["heater"] == "off" {
				fmt.Println("Heater override - STATE: OFF")
				heater_relay.On()
				heater_state = 0
			} else {
				if temp < target_temperature_min {
					fmt.Println("Temperature too low, turning on heater.")
					heater_relay.Off()
					heater_state = 1
				} else if temp > target_temperature_max {
					fmt.Println("Temperature too high, turning off heater.")
					heater_relay.On()
					heater_state = 0
				} else {
					fmt.Println("Temperature within range - Heater off.")
					heater_relay.On()
					heater_state = 0
				}
			}

			if overrides["pump"] == "on" {
				fmt.Println("Pump override - STATE: ON")
				pump_relay.On()
				pump_state = 1
			} else if overrides["pump"] == "off" {
				fmt.Println("Pump override - STATE: OFF")
				pump_relay.Off()
				pump_state = 0
			} else {
				if temp > target_temperature_max {
					fmt.Println("Temperature too high, turning on pump.")
					pump_relay.On()
					pump_state = 1
				} else if temp < target_temperature_min {
					fmt.Println("Temperature too low, turning off pump.")
					pump_relay.Off()
					pump_state = 0
				} else {
					fmt.Println("Temperature within range - Pump off.")
					pump_relay.Off()
					pump_state = 0
				}
			}

			if overrides["mode"] == "colonisation" {
				fmt.Println("Fruiting Mode - STATE: colonisation")
				mister_relay.On()
				mister_state = 0
			} else if overrides["mister"] == "on" {
				fmt.Println("Mister override - STATE: ON")
				mister_relay.Off()
				mister_state = 1
			} else if overrides["mister"] == "off" {
				fmt.Println("Mister override - STATE: OFF")
				mister_relay.On()
				mister_state = 0
			} else {
				if humidity < target_humidity_min {
					fmt.Println("Humidity too low, turning on humidifier")
					mister_relay.Off()
					mister_state = 1
				} else if humidity > target_humidity_max {
					fmt.Println("Humidity too high, turning off humidifier")
					mister_relay.On()
					mister_state = 0
				} else {
					fmt.Println("Humidity within range - Mister off.")
					mister_relay.On()
					mister_state = 0
				}
			}
			if overrides["fan"] == "on" {
				fmt.Println("Fan override - STATE: ON")
				fan_relay.Off()
				fan_state = 1
			} else if overrides["fan"] == "off" {
				fmt.Println("Fan override - STATE: OFF")
				fan_relay.On()
				fan_state = 0
			} else {
				if time.Since(last_fan_run) >= fan_interval {
					fmt.Println("Initiating hourly fan run in the background.")
					go runFanForDuration(fan_run_duration)

				}

			}

			device_state := DeviceState{
				Pump:       pump_state,
				Heater:     heater_state,
				Fan:        fan_state,
				Mister:     mister_state,
				Lights:     light_state,
				LastFanRun: last_fan_run.Format(time.RFC3339),
				PumpOver:   overrides["pump"],
				HeaterOver: overrides["heater"],
				FanOver:    overrides["fan"],
				MisterOver: overrides["mister"],
				LightsOver: overrides["lights"],
				ModeOver:   overrides["mode"],
				Error:      overrides["error"],
			}
			device_state_json, err := json.Marshal(device_state)
			if err != nil {
				log.Println("Error marshaling device state:", err)
			} else {
				mqttAdaptor.Publish(mqttTopicPrefix+"/devices", device_state_json)
				fmt.Printf("Published device status: %s\n", string(device_state_json))
			}

			sensor_data := SensorData{
				Temperature: temp,
				Humidity:    humidity,
				Timestamp:   time.Now().Format(time.RFC3339),
			}
			sensor_data_jSON, err := json.Marshal(sensor_data)
			if err != nil {
				log.Println("Error marshaling sensor data:", err)
			} else {
				mqttAdaptor.Publish(mqttTopicPrefix+"/sensors", sensor_data_jSON)
				fmt.Printf("Published device status: %s\n", string(sensor_data_jSON))

				// Format temperature and humidity to two decimal places
				formattedTemp := fmt.Sprintf("%.2f", temp)
				formattedHumidity := fmt.Sprintf("%.2f", humidity)

				// Format the timestamp
				dbMutex.Lock() // Acquire the lock before writing
				defer dbMutex.Unlock()
				_, err = db.Exec(`
					INSERT INTO sensors (temperature, humidity, timestamp)
					VALUES (?, ?, ?)
				`, formattedTemp, formattedHumidity, time.Now())
				if err != nil {
					log.Println("Error inserting sensor data into database:", err)
					sendMQTTAlert("Database insert error: " + err.Error()) //send mqtt alert
					overrides["error"] = "db insert failed"
				} else {
					fmt.Printf("Temperature: %s°C, Humidity: %s%%, Time: %s - Data written to SQLite.\n", formattedTemp, formattedHumidity, time.Now())
					overrides["error"] = "none"
				}
			}

			currentConfig := ConfigStatus{
				MinTemperature: target_temperature_min,
				MaxTemperature: target_temperature_max,
				MinHumidity:    target_humidity_min,
				MaxHumidity:    target_humidity_max,
				FanDuration:    fan_run_duration.Minutes(),
				FanInterval:    fan_interval.Minutes(),
				LightsOnHour:   lights_on_hour_UTC,
				LightsOffHour:  lights_off_hour_UTC,
			}
			configJSON, err := json.Marshal(currentConfig)
			if err != nil {
				log.Println("Error marshaling config status:", err)
				return
			}
			mqttAdaptor.Publish(mqttTopicPrefix+"/status", configJSON)
			fmt.Printf("Published config status: %s\n", string(configJSON))

		})
	}

	farmBot := gobot.NewRobot("FarmController",
		[]gobot.Connection{r, mqttAdaptor},
		[]gobot.Device{sht2x, fan_relay, heater_relay, pump_relay, led_light, mister_relay},
		work,
	)

	if err := farmBot.Start(); err != nil {
		log.Fatal("Error starting robot:", err)
	}

	select {}

}
