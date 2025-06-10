package main

import (
	"database/sql"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	_ "github.com/mattn/go-sqlite3" // Import SQLite driver
)

// SensorData struct to hold data from the database
type SensorData struct {
	Value       string  `json:"timestamp"`
	Temperature float64 `json:"temperature"`
	Humidity    float64 `json:"humidity"`
}

type DailyDeviceTime struct {
	Date         string `json:"date"`
	PumpTimeOn   int    `json:"pump_time_on"`
	MisterTimeOn int    `json:"mister_time_on"`
	HeaterTimeOn int    `json:"heater_time_on"`
	LightsTimeOn int    `json:"lights_time_on"`
	FanTimeOn    int    `json:"fan_time_on"`
}

func main() {
	router := gin.New()
	router.LoadHTMLGlob("static/html/*")
	router.Static("/static", "./static")
	router.StaticFile("/favicon.ico", "./static/img/favicon.ico")
	router.Use(gin.LoggerWithFormatter(func(param gin.LogFormatterParams) string {
		return fmt.Sprintf("%s - [%s] \"%s %s %s %d %s \"%s\" %s\"\n",
			param.ClientIP,
			param.TimeStamp.Format(time.RFC1123),
			param.Method,
			param.Path,
			param.Request.Proto,
			param.StatusCode,
			param.Latency,
			param.Request.UserAgent(),
			param.ErrorMessage,
		)
	}))
	router.Use(gin.Recovery())

	// Database connection
	// db, err := sql.Open("sqlite3", "/app/sensor_data.db")
	db, err := sql.Open("sqlite3", "/home/mike/Documents/Gofarm/farm/sensor_data.db")
	if err != nil {
		fmt.Println("Error opening database:", err)
		return
	}
	defer db.Close()

	router.GET("/", func(c *gin.Context) {
		c.HTML(http.StatusOK, "home.html", gin.H{})
	})

	router.GET("/api/sensor_data", func(c *gin.Context) {
		var totalRows int
		err := db.QueryRow("SELECT COUNT(*) FROM sensors").Scan(&totalRows)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Error counting rows: " + err.Error()})
			return
		}

		var step int
		if totalRows <= 200 {
			step = 1
		} else {
			step = int(math.Ceil(float64(totalRows) / 200.0))
		}

		rows, err := db.Query(`
		SELECT COALESCE(strftime('%d:%m:%Y %H:%M:%S', SUBSTR(TRIM(timestamp), 1, 19)), ''), temperature, humidity FROM sensors ORDER BY id ASC`)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Error querying data: " + err.Error()})
			return
		}
		defer rows.Close()

		var filteredReadings []SensorData
		count := 0
		for rows.Next() {
			var reading SensorData

			err = rows.Scan(&reading.Value, &reading.Temperature, &reading.Humidity)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Error scanning row: " + err.Error()})
				return
			}

			if count%step == 0 {
				filteredReadings = append(filteredReadings, reading)
			}
			count++
		}

		if err := rows.Err(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Error iterating rows: " + err.Error()})
			return
		}

		c.JSON(http.StatusOK, filteredReadings)
	})

	router.GET("/api/device_daily_times", func(c *gin.Context) {
		daysStr := c.DefaultQuery("days", "30") // Default to 7 days
		days, err := strconv.Atoi(daysStr)
		if err != nil || days <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid 'days' parameter. Must be a positive integer."})
			return
		}
		if days > 35 { // Cap to prevent excessive data retrieval
			days = 35
		}

		// Calculate the date N days ago (inclusive)
		// Use UTC to match how data is stored by farm_control
		nDaysAgo := time.Now().UTC().AddDate(0, 0, -days).Format("2006-01-02")

		rows, err := db.Query(`
			SELECT date, pump_time_on, mister_time_on, heater_time_on, lights_time_on, fan_time_on
			FROM device_daily_times
			WHERE date >= ?
			ORDER BY date ASC`, nDaysAgo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Error querying daily device times: " + err.Error()})
			return
		}
		defer rows.Close()

		var dailyTimes []DailyDeviceTime
		for rows.Next() {
			var ddt DailyDeviceTime
			err := rows.Scan(&ddt.Date, &ddt.PumpTimeOn, &ddt.MisterTimeOn, &ddt.HeaterTimeOn, &ddt.LightsTimeOn, &ddt.FanTimeOn)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Error scanning daily device times row: " + err.Error()})
				return
			}
			dailyTimes = append(dailyTimes, ddt)
		}

		if err := rows.Err(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Error iterating daily device times rows: " + err.Error()})
			return
		}

		c.JSON(http.StatusOK, dailyTimes)
	})

	router.Run(":8080")
}
