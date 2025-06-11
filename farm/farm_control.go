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
	maxRetries      = 3 //used by the read sensor function
	retryInterval   = 2 * time.Second
	humidAdjustment = 17
	tempAdjustment  = 0
)

type DeviceState struct {
	Pump         int    `json:"pump"`
	Heater       int    `json:"heater"`
	Fan          int    `json:"fan"`
	Mister       int    `json:"mister"`
	Lights       int    `json:"lights"`
	LastFanRun   string `json:"last_fan_run"`
	PumpOver     string `json:"pump_over"`
	HeaterOver   string `json:"heater_over"`
	FanOver      string `json:"fan_over"`
	MisterOver   string `json:"mister_over"`
	LightsOver   string `json:"lights_over"`
	ModeOver     string `json:"mode_over"`
	PumpTimeOn   string `json:"pump_time_on"`
	MisterTimeOn string `json:"mister_time_on"`
	HeaterTimeOn string `json:"heater_time_on"`
	LightsTimeOn string `json:"lights_time_on"`
	FanTimeOn    string `json:"fan_time_on"`
	Error        string `json:"error"`
}

type Override struct {
	Pump_over   string `json:"pump_over"`
	Heater_over string `json:"heater_over"`
	Fan_over    string `json:"fan_over"`
	Mister_over string `json:"mister_over"`
	Lights_over string `json:"lights_over"`
	Mode_over   string `json:"mode_over"`
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

type SensorData struct {
	Temperature       float32 `json:"temperature"`
	Humidity          float32 `json:"humidity"`
	Timestamp         string  `json:"timestamp"`
	DailyHighTemp     float32 `json:"daily_high_temp"`
	DailyLowTemp      float32 `json:"daily_low_temp"`
	DailyHighHumidity float32 `json:"daily_high_humidity"`
	DailyLowHumidity  float32 `json:"daily_low_humidity"`
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
		last_fan_run  time.Time     = time.Now()
		fan_state     int           = 0
		fanCancelChan chan struct{} //prevents race condition if fan is turned off when fan is already in go routine
		light_state   int           = 0
		heater_state  int           = 0
		pump_state    int           = 0
		mister_state  int           = 0

		target_temperature_min float32 = 15.0
		target_temperature_max float32 = 20.0
		target_humidity_min    float32 = 75.0
		target_humidity_max    float32 = 90.0
		fan_run_duration               = 5 * time.Minute
		fan_interval                   = 60 * time.Minute
		lights_on_hour_UTC     int     = 8
		lights_off_hour_UTC    int     = 20
		gobotRefresh           int     = 10 //how often does this device run

		pumpOnTime   time.Time
		misterOnTime time.Time
		heaterOnTime time.Time
		lightsOnTime time.Time
		fanOnTime    time.Time

		pumpDailyDuration   time.Duration
		misterDailyDuration time.Duration
		heaterDailyDuration time.Duration
		lightsDailyDuration time.Duration
		fanDailyDuration    time.Duration

		pumpDurationMutex   sync.Mutex
		misterDurationMutex sync.Mutex
		heaterDurationMutex sync.Mutex
		lightsDurationMutex sync.Mutex
		fanDurationMutex    sync.Mutex

		dailyHighTemp     float32 = 0.0
		dailyLowTemp      float32 = 100.0
		dailyHighHumidity float32 = 0.0
		dailyLowHumidity  float32 = 99.0

		dailyTempHumidityMutex sync.Mutex
	)

	db, err := sql.Open("sqlite3", "/app/sensor_data.db")
	if err != nil {
		log.Fatalf("Error opening database: %v", err)
	}
	defer db.Close()
	// SENSOR DATA TABLE
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
	// DEVICE TIME TABLE
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS device_daily_times (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			date TEXT NOT NULL UNIQUE, -- Store date as YYYY-MM-DD
			pump_time_on INTEGER NOT NULL,    -- Store as seconds
			mister_time_on INTEGER NOT NULL,  -- Store as seconds
			heater_time_on INTEGER NOT NULL,  -- Store as seconds
			lights_time_on INTEGER NOT NULL,  -- Store as seconds
			fan_time_on INTEGER NOT NULL      -- Store as seconds
		);
	`)
	if err != nil {
		log.Fatalf("Error creating device_daily_times table: %v", err)
	}
	//////////////////////////////////////////
	//GPIO PINS
	r := raspi.NewAdaptor()
	sht2x := i2c.NewSHT2xDriver(r)
	pump_relay := gpio.NewRelayDriver(r, "37")
	heater_relay := gpio.NewRelayDriver(r, "36")
	fan_relay := gpio.NewRelayDriver(r, "16")
	mister_relay := gpio.NewRelayDriver(r, "18")
	led_light := gpio.NewRelayDriver(r, "22")

	mqttAdaptor := mqtt.NewAdaptor(mqttBrokerURL, mqttClientID)

	//used to send any errors or warnings to the frontend
	sendMQTTAlert := func(message string) {
		if mqttAdaptor != nil {
			mqttAdaptor.Publish(mqttTopicPrefix+"/alerts", []byte(message))
			log.Println("MQTT alert sent:", message)
		} else {
			log.Println("MQTT not connected, cannot send alert:", message)
		}
	}
	trimSensorDatabase := func() {
		dbMutex.Lock()
		defer dbMutex.Unlock()

		// cutoff time  is 7 days ago from the current time.
		cutoffTime := time.Now().UTC().AddDate(0, 0, -7)

		log.Printf("Trimming database: deleting sensor records older than %v", cutoffTime)

		// Execute the DELETE statement for records
		result, err := db.Exec("DELETE FROM sensors WHERE timestamp < ?", cutoffTime)
		if err != nil {
			log.Println("Error deleting old data from sensors table:", err)
			sendMQTTAlert("Error trimming database: " + err.Error())
			overrides["error"] = "database trim failed"
			return // Exit the function on error
		}

		// Log how many rows were deleted.
		rowsAffected, err := result.RowsAffected()
		if err != nil {
			log.Println("Error getting rows affected after delete:", err)
			sendMQTTAlert("DB Trim Warning: Could not get affected rows count.")
		} else {
			log.Printf("Database trim successful. Deleted %d old records.", rowsAffected)
		}

		// Successfully completed, ensure error state is cleared.
		overrides["error"] = "none"
	}

	go func() { // reset counter
		dbTrimTicker := time.NewTicker(24 * time.Hour) // Ticker for daily database trim
		defer dbTrimTicker.Stop()
		now := time.Now().UTC()

		nextMidnight := now.Truncate(24 * time.Hour).Add(24 * time.Hour)
		dailyTimerResetTicker := time.NewTicker(nextMidnight.Sub(now))
		defer dailyTimerResetTicker.Stop()

		for {
			select {
			case <-dbTrimTicker.C: // This case now runs the daily trim operation
				log.Println("Running daily check to remove sensor data older than 7 days...")
				trimSensorDatabase() // Call the new function here

			case <-dailyTimerResetTicker.C: // This part remains unchanged
				log.Println("Resetting daily device on-time counters (00:00 UTC)...")

				/*this section just locks the values and sets them to extreams that will be over written on the first sensor read
				unlocks the the 4 values*/
				dailyTempHumidityMutex.Lock()
				dailyHighTemp = 0.0
				dailyLowTemp = 99.0
				dailyHighHumidity = 0.0
				dailyLowHumidity = 99.0
				dailyTempHumidityMutex.Unlock()

				log.Println("Daily sensor max and mins reset.")

				//this just writes the daily on durations to values to be written to the database
				pumpDurationMutex.Lock()
				currentPumpDuration := pumpDailyDuration
				pumpDurationMutex.Unlock()

				misterDurationMutex.Lock()
				currentMisterDuration := misterDailyDuration
				misterDurationMutex.Unlock()

				heaterDurationMutex.Lock()
				currentHeaterDuration := heaterDailyDuration
				heaterDurationMutex.Unlock()

				lightsDurationMutex.Lock()
				currentLightsDuration := lightsDailyDuration
				lightsDurationMutex.Unlock()

				fanDurationMutex.Lock()
				currentFanDuration := fanDailyDuration
				fanDurationMutex.Unlock()

				//saves the date for the device times of the previous day hence why the time isnt being saved
				dateToSave := time.Now().UTC().Add(-24 * time.Hour).Format("2006-01-02")

				dbMutex.Lock() //preps the query to be written to database INSERT OR REPLACE just in case there the same day in there
				stmt, err := db.Prepare(`
					INSERT OR REPLACE INTO device_daily_times (date, pump_time_on, mister_time_on, heater_time_on, lights_time_on, fan_time_on)
					VALUES (?, ?, ?, ?, ?, ?)
				`)
				if err != nil {
					log.Printf("Error preparing daily_times insert statement: %v", err)
					sendMQTTAlert("DB Prep Error (Daily Times): " + err.Error()) //sends alert to front end in event of an error
				} else {
					_, err := stmt.Exec( //executes the query by converting the times into seconds and using the dataetosave
						dateToSave,
						int(currentPumpDuration.Seconds()),
						int(currentMisterDuration.Seconds()),
						int(currentHeaterDuration.Seconds()),
						int(currentLightsDuration.Seconds()),
						int(currentFanDuration.Seconds()),
					)
					if err != nil {
						log.Printf("Error inserting daily device times for %s: %v", dateToSave, err)
						sendMQTTAlert("DB Insert Error (Daily Times): " + err.Error())
					} else {
						log.Printf("Daily device times for %s saved to DB.", dateToSave)

						var currentCount int
						err = db.QueryRow("SELECT COUNT(*) FROM device_daily_times").Scan(&currentCount)
						if err != nil {
							log.Printf("Error counting records in device_daily_times: %v", err)
							sendMQTTAlert("DB Count Error (Daily Times): " + err.Error())
						} else {
							maxDailes := 35               //how many days are saved in table
							if currentCount > maxDailes { // find the ID of the oldest record at max of 35
								var oldestID int //used to find the oldest ID to delete
								err = db.QueryRow("SELECT id FROM device_daily_times ORDER BY date ASC LIMIT 1").Scan(&oldestID)
								if err != nil {
									log.Printf("Error finding oldest record in device_daily_times: %v", err)
									sendMQTTAlert("DB Oldest Record Error: " + err.Error())
								} else {
									// Delete the oldest record
									_, err = db.Exec("DELETE FROM device_daily_times WHERE id = ?", oldestID)
									if err != nil {
										log.Printf("Error deleting oldest record from device_daily_times (ID: %d): %v", oldestID, err)
										sendMQTTAlert("DB Delete Error (Daily Times): " + err.Error())
									} else {
										log.Printf("Deleted oldest record from device_daily_times (ID: %d) as max amount %d limit. Current count: %d", oldestID, maxDailes, currentCount-1)
									}
								}
							}
						}
					}
					stmt.Close() //closes the statement
				}
				// resets the times for the next day
				dbMutex.Unlock()
				pumpDurationMutex.Lock()
				pumpDailyDuration = 0
				pumpDurationMutex.Unlock()

				misterDurationMutex.Lock()
				misterDailyDuration = 0
				misterDurationMutex.Unlock()

				heaterDurationMutex.Lock()
				heaterDailyDuration = 0
				heaterDurationMutex.Unlock()

				lightsDurationMutex.Lock()
				lightsDailyDuration = 0
				lightsDurationMutex.Unlock()

				fanDurationMutex.Lock()
				fanDailyDuration = 0
				fanDurationMutex.Unlock()

				dailyTimerResetTicker.Stop()
				dailyTimerResetTicker = time.NewTicker(24 * time.Hour) //new ticker for the day
			}
		}
	}()

	readSensorData := func() (float32, float32, error) { //returns 3 values the temp humid and error
		var temp float32
		var humidity float32
		var err error
		for i := 0; i < maxRetries; i++ { // if theres a error it will try at maxretries times
			temp, err = sht2x.Temperature()
			if err == nil {
				humidity, err = sht2x.Humidity()
				if err == nil {
					return temp - tempAdjustment, humidity - humidAdjustment, nil
				}
			}
			log.Printf("Error reading sensor data (attempt %d): %v\n", i+1, err)
			time.Sleep(retryInterval)
		}
		sendMQTTAlert("Failed to read sensor data after " + strconv.Itoa(maxRetries) + " attempts: " + err.Error())
		overrides["error"] = "sensor read failed"
		return 0, 0, err //return zeros for temp, humid
	}

	work := func() {

		mqttAdaptor.On(mqttTopicPrefix+"/config", func(msg mqtt.Message) { //listener for the config topic, allows options to change without restarting the program
			fmt.Printf("Received config change: %s\n", string(msg.Payload()))
			var configData map[string]interface{}             //map to parse JSON msgs
			err := json.Unmarshal(msg.Payload(), &configData) //decodes json message to configdata
			if err != nil {
				log.Println("Error unmarshaling config JSON:", err)
				return
			}

			// for each option check if the float exists and then add to configdata map
			// if option is okay then change the value
			if tempMin, ok := configData["target_temperature_min"].(float64); ok {
				target_temperature_min = float32(tempMin)
				fmt.Println("Updated target_temperature_min to:", target_temperature_min)
			}
			if tempMax, ok := configData["target_temperature_max"].(float64); ok {
				target_temperature_max = float32(tempMax)
				fmt.Println("Updated target_temperature_max to:", target_temperature_max)
			}
			if humidMin, ok := configData["target_humidity_min"].(float64); ok {
				target_humidity_min = float32(humidMin)
				fmt.Println("Updated target_humidity_min to:", target_humidity_min)
			}
			if humidMax, ok := configData["target_humidity_max"].(float64); ok {
				target_humidity_max = float32(humidMax)
				fmt.Println("Updated target_humidity_max to:", target_humidity_max)
			}
			if fanDuration, ok := configData["fan_run_duration_minutes"].(float64); ok {
				fan_run_duration = time.Duration(fanDuration) * time.Minute
				fmt.Println("Updated fan_run_duration to:", fan_run_duration)
			}
			if fanInterval, ok := configData["fan_interval_minutes"].(float64); ok {
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

		//parses the override data into the Override struct
		mqttAdaptor.On(mqttTopicPrefix+"/override", func(msg mqtt.Message) {
			fmt.Printf("Received override command: %s\n", string(msg.Payload()))
			var overrideData Override
			err := json.Unmarshal(msg.Payload(), &overrideData) //decodes json message to overrideData to fill the blueprint
			if err != nil {
				log.Println("Error unmarshaling override JSON:", err)
				return
			}
			//recives on, off, any string for auto and colonisation/fruiting for mode
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

		//function for defining how long the fan should run for
		// need to change on off options as its wrong
		// it prevents the whole program stopping when the fan is running
		runFanForDuration := func(duration time.Duration, cancel <-chan struct{}) {
			fmt.Println("Starting fan run.")
			fanDurationMutex.Lock()
			fanOnTime = time.Now() //records when the fan is turned on
			fanDurationMutex.Unlock()
			fan_relay.Off()
			fan_state = 1

			timer := time.NewTimer(duration) //timer that will send a signal on its channel when the duration is up

			select {
			case <-timer.C:
				// Case happens if theres no override
				fmt.Println("Fan run completed normally.")
			case <-cancel:
				//case when override off happens
				fmt.Println("Fan run cancelled by override.")
				timer.Stop() //clean timer
				return       //quits - the override manages the time off
			}

			fmt.Println("Stopping fan run.")
			fan_relay.On()
			fan_state = 0
			last_fan_run = time.Now() //records when fan is turned off

			fanDurationMutex.Lock()
			fanDailyDuration += time.Since(fanOnTime) //adds ellaspsed time to daily duration
			fanOnTime = time.Time{}                   // start time reset to a zero value so its not on time cycle no more
			fanDurationMutex.Unlock()
		}

		refreshInterval := time.Duration(gobotRefresh) * time.Second //changes the int into to seconds
		gobot.Every(refreshInterval, func() {
			now_UTC := time.Now().UTC()
			hour_UTC := now_UTC.Hour()
			temp, humidity, err := readSensorData()
			if err != nil {
				log.Println("Error reading sensor data:", err)
				return
			}

			//records daily max and mins
			//
			dailyTempHumidityMutex.Lock()
			if temp > dailyHighTemp {
				dailyHighTemp = temp
			}
			if temp < dailyLowTemp {
				dailyLowTemp = temp
			}
			if humidity > dailyHighHumidity {
				dailyHighHumidity = humidity
			}
			if humidity < dailyLowHumidity {
				dailyLowHumidity = humidity
			}
			dailyTempHumidityMutex.Unlock()
			// fucked up the on/off need to change the wiring in the future
			//colonisation mode does not require humidity or light so this is turned off
			if overrides["mode"] == "colonisation" {
				fmt.Println("Fruiting Mode - STATE: colonisation")
				if light_state == 1 {
					lightsDurationMutex.Lock()
					lightsDailyDuration += time.Since(lightsOnTime)
					lightsDurationMutex.Unlock()
				}
				led_light.On()
				light_state = 0
			} else if overrides["lights"] == "on" {
				fmt.Println("Light override - STATE: ON")
				if light_state == 0 {
					lightsOnTime = time.Now()
				}
				led_light.Off()
				light_state = 1
			} else if overrides["lights"] == "off" {
				fmt.Println("Light override - STATE: OFF")
				if light_state == 1 {
					lightsDurationMutex.Lock()
					lightsDailyDuration += time.Since(lightsOnTime)
					lightsDurationMutex.Unlock()
				}
				led_light.On()
				light_state = 0
			} else {
				if hour_UTC >= lights_on_hour_UTC && hour_UTC < lights_off_hour_UTC {
					fmt.Println("Turning LED lights ON (UTC).")
					if light_state == 0 {
						lightsOnTime = time.Now()
					}
					led_light.Off()
					light_state = 1
				} else {
					fmt.Println("Turning LED lights OFF (UTC).")
					if light_state == 1 { // If it was on, calculate duration
						lightsDurationMutex.Lock()
						lightsDailyDuration += time.Since(lightsOnTime)
						lightsDurationMutex.Unlock()
					}
					led_light.On()
					light_state = 0
				}
			}

			// Capture current durations safely
			pumpDurationMutex.Lock()
			currentPumpDuration := pumpDailyDuration
			pumpDurationMutex.Unlock()

			misterDurationMutex.Lock()
			currentMisterDuration := misterDailyDuration
			misterDurationMutex.Unlock()

			heaterDurationMutex.Lock()
			currentHeaterDuration := heaterDailyDuration
			heaterDurationMutex.Unlock()

			lightsDurationMutex.Lock()
			currentLightsDuration := lightsDailyDuration
			lightsDurationMutex.Unlock()

			fanDurationMutex.Lock()
			currentFanDuration := fanDailyDuration
			fanDurationMutex.Unlock()

			// If devices are currently on, add the time since they last turned on to their respective durations
			if pump_state == 1 && !pumpOnTime.IsZero() {
				currentPumpDuration += time.Since(pumpOnTime)
			}
			if mister_state == 1 && !misterOnTime.IsZero() {
				currentMisterDuration += time.Since(misterOnTime)
			}
			if heater_state == 1 && !heaterOnTime.IsZero() {
				currentHeaterDuration += time.Since(heaterOnTime)
			}
			if light_state == 1 && !lightsOnTime.IsZero() {
				currentLightsDuration += time.Since(lightsOnTime)
			}
			if fan_state == 1 && !fanOnTime.IsZero() {
				currentFanDuration += time.Since(fanOnTime)
			}

			//prints current state
			fmt.Printf("Last Air Cycle Time: %s Temperature: %.2f°C, Humidity: %.2f%%\n", last_fan_run, temp, humidity)

			if overrides["heater"] == "on" {
				fmt.Println("Heater override - STATE: ON")
				if heater_state == 0 {
					heaterOnTime = time.Now()
				}
				heater_relay.Off()
				heater_state = 1
			} else if overrides["heater"] == "off" {
				fmt.Println("Heater override - STATE: OFF")
				if heater_state == 1 {
					heaterDurationMutex.Lock()
					heaterDailyDuration += time.Since(heaterOnTime)
					heaterDurationMutex.Unlock()
				}
				heater_relay.On()
				heater_state = 0
			} else {
				if temp < target_temperature_min {
					fmt.Println("Temperature too low, turning on heater.")
					if heater_state == 0 {
						heaterOnTime = time.Now()
					}
					heater_relay.Off()
					heater_state = 1
				} else if temp > target_temperature_max {
					fmt.Println("Temperature too high, turning off heater.")
					if heater_state == 1 {
						heaterDurationMutex.Lock()
						heaterDailyDuration += time.Since(heaterOnTime)
						heaterDurationMutex.Unlock()
					}
					heater_relay.On()
					heater_state = 0
				} else {
					fmt.Println("Temperature within range - Heater off.")
					if heater_state == 1 {
						heaterDurationMutex.Lock()
						heaterDailyDuration += time.Since(heaterOnTime)
						heaterDurationMutex.Unlock()
					}
					heater_relay.On()
					heater_state = 0
				}
			}

			if overrides["pump"] == "on" {
				fmt.Println("Pump override - STATE: ON")
				if pump_state == 0 {
					pumpOnTime = time.Now()
				}
				pump_relay.Off()
				pump_state = 1
			} else if overrides["pump"] == "off" {
				fmt.Println("Pump override - STATE: OFF")
				if pump_state == 1 {
					pumpDurationMutex.Lock()
					pumpDailyDuration += time.Since(pumpOnTime)
					pumpDurationMutex.Unlock()
				}
				pump_relay.On()
				pump_state = 0
			} else {
				if temp > target_temperature_max {
					fmt.Println("Temperature too high, turning on pump.")
					if pump_state == 0 {
						pumpOnTime = time.Now()
					}
					pump_relay.Off()
					pump_state = 1
				} else if temp < target_temperature_min {
					fmt.Println("Temperature too low, turning off pump.")
					if pump_state == 1 {
						pumpDurationMutex.Lock()
						pumpDailyDuration += time.Since(pumpOnTime)
						pumpDurationMutex.Unlock()
					}
					pump_relay.On()
					pump_state = 0
				} else {
					fmt.Println("Temperature within range - Pump off.")
					if pump_state == 1 {
						pumpDurationMutex.Lock()
						pumpDailyDuration += time.Since(pumpOnTime)
						pumpDurationMutex.Unlock()
					}
					pump_relay.On()
					pump_state = 0
				}
			}

			if overrides["mode"] == "colonisation" {
				fmt.Println("Fruiting Mode - STATE: colonisation")
				mister_relay.On()
				mister_state = 0
			} else if overrides["mister"] == "on" {
				fmt.Println("Mister override - STATE: ON")
				if mister_state == 0 {
					misterOnTime = time.Now()
				}
				mister_relay.Off()
				mister_state = 1
			} else if overrides["mister"] == "off" {
				fmt.Println("Mister override - STATE: OFF")
				if mister_state == 1 {
					misterDurationMutex.Lock()
					misterDailyDuration += time.Since(misterOnTime)
					misterDurationMutex.Unlock()
				}
				mister_relay.On()
				mister_state = 0
			} else {
				if humidity < target_humidity_min {
					fmt.Println("Humidity too low, turning on humidifier")
					if mister_state == 0 {
						misterOnTime = time.Now()
					}
					mister_relay.Off()
					mister_state = 1
				} else if humidity > target_humidity_max {
					fmt.Println("Humidity too high, turning off humidifier")
					if mister_state == 1 {
						misterDurationMutex.Lock()
						misterDailyDuration += time.Since(misterOnTime)
						misterDurationMutex.Unlock()
					}
					mister_relay.On()
					mister_state = 0
				} else {
					fmt.Println("Humidity within range - Mister off.")
					if mister_state == 1 {
						misterDurationMutex.Lock()
						misterDailyDuration += time.Since(misterOnTime)
						misterDurationMutex.Unlock()
					}
					mister_relay.On()
					mister_state = 0
				}
			}

			if overrides["fan"] == "on" {
				fmt.Println("Fan override - STATE: ON")
				if fan_state == 0 { // If it was off, record start time
					fanDurationMutex.Lock()
					fanOnTime = time.Now()
					fanDurationMutex.Unlock()
				}
				fan_relay.Off()
				fan_state = 1
			} else if overrides["fan"] == "off" {
				fmt.Println("Fan override - STATE: OFF")
				if fan_state == 1 {
					// Signal the running goroutine to stop, if it exists.
					if fanCancelChan != nil {
						close(fanCancelChan)
						fanCancelChan = nil // Set it back to nil
					}
					fanDurationMutex.Lock()
					fanDailyDuration += time.Since(fanOnTime)
					fanOnTime = time.Time{}
					fanDurationMutex.Unlock()
				}
				fan_relay.On()
				fan_state = 0
			} else {
				if time.Since(last_fan_run) >= fan_interval && fan_state == 0 {
					fmt.Println("Initiating hourly fan run in the background.")
					//create a new channel for this specific fan cycle.
					fanCancelChan = make(chan struct{})
					// pass the channel to the goroutine.
					go runFanForDuration(fan_run_duration, fanCancelChan)
				}
			}

			// makes the date more redable
			formatDuration := func(d time.Duration) string {
				hours := int(d.Hours())
				minutes := int(d.Minutes()) % 60
				return fmt.Sprintf("%02d:%02d", hours, minutes)
			}

			device_state := DeviceState{
				//1 or 0
				Pump:       pump_state,
				Heater:     heater_state,
				Fan:        fan_state,
				Mister:     mister_state,
				Lights:     light_state,
				LastFanRun: last_fan_run.Format(time.RFC3339),

				//"on", "off" "no override" / "colonisation" or "fruiting"
				PumpOver:   overrides["pump"],
				HeaterOver: overrides["heater"],
				FanOver:    overrides["fan"],
				MisterOver: overrides["mister"],
				LightsOver: overrides["lights"],
				ModeOver:   overrides["mode"],
				Error:      overrides["error"],

				//turns time in HH:MM
				PumpTimeOn:   formatDuration(currentPumpDuration),
				MisterTimeOn: formatDuration(currentMisterDuration),
				HeaterTimeOn: formatDuration(currentHeaterDuration),
				LightsTimeOn: formatDuration(currentLightsDuration),
				FanTimeOn:    formatDuration(currentFanDuration),
			}
			device_state_json, err := json.Marshal(device_state)
			if err != nil {
				log.Println("Error converting device state to json:", err)
			} else { //PUBLISH
				mqttAdaptor.Publish(mqttTopicPrefix+"/devices", device_state_json)
				fmt.Printf("Published device status: %s\n", string(device_state_json))
			}

			//populates struct with current climate, time and highs/lows
			sensor_data := SensorData{
				Temperature:       temp,
				Humidity:          humidity,
				Timestamp:         time.Now().Format(time.RFC3339),
				DailyHighTemp:     dailyHighTemp,
				DailyLowTemp:      dailyLowTemp,
				DailyHighHumidity: dailyHighHumidity,
				DailyLowHumidity:  dailyLowHumidity,
			}
			sensor_data_jSON, err := json.Marshal(sensor_data)
			if err != nil {
				log.Println("Error converting sensor data from go to json:", err)
			} else { //PUBLISH
				mqttAdaptor.Publish(mqttTopicPrefix+"/sensors", sensor_data_jSON)
				fmt.Printf("Published device status: %s\n", string(sensor_data_jSON))

				// Format temperature and humidity to two decimal places
				formattedTemp := fmt.Sprintf("%.2f", temp)
				formattedHumidity := fmt.Sprintf("%.2f", humidity)

				dbMutex.Lock() //lock before writing
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

			//gatheres the currect configuration options to be published
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
