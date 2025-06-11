package main

import (
	"database/sql"
	"fmt"
	"net/http"
	"sort"
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

type DailySensorReadings struct {
	Date         string    `json:"date"`
	Temperatures []float64 `json:"temperatures"`
	Humidities   []float64 `json:"humidities"`
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

	router.GET("/api/climate_history", func(c *gin.Context) {
		sevenDaysAgo := time.Now().UTC().AddDate(0, 0, -7)
		rows, err := db.Query(`
			SELECT
				strftime('%Y-%m-%d %H:%M', timestamp) as interval_start,
				AVG(temperature) as avg_temp,
				AVG(humidity) as avg_hum
			FROM
				sensors
			WHERE
				timestamp >= ?
			GROUP BY
				-- Group by a calculated value representing the start of each 15-minute interval
				strftime('%Y-%m-%d %H', timestamp), CAST(strftime('%M', timestamp) / 15 AS INTEGER)
			ORDER BY
				interval_start ASC;
		`, sevenDaysAgo)

		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Error querying aggregated sensor data: " + err.Error()})
			return
		}
		defer rows.Close()

		dailyReadingsMap := make(map[string]*DailySensorReadings)

		for rows.Next() {
			var intervalStart string
			var temp, hum float64
			if err := rows.Scan(&intervalStart, &temp, &hum); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Error scanning aggregated sensor row: " + err.Error()})
				return
			}

			// Extract just the date part (YYYY-MM-DD) to use as the map key
			dateKey := intervalStart[0:10]

			if _, ok := dailyReadingsMap[dateKey]; !ok {
				dailyReadingsMap[dateKey] = &DailySensorReadings{
					Date:         dateKey,
					Temperatures: []float64{},
					Humidities:   []float64{},
				}
			}

			dailyReadingsMap[dateKey].Temperatures = append(dailyReadingsMap[dateKey].Temperatures, temp)
			dailyReadingsMap[dateKey].Humidities = append(dailyReadingsMap[dateKey].Humidities, hum)
		}

		if err := rows.Err(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Error iterating aggregated sensor rows: " + err.Error()})
			return
		}

		var responseData []DailySensorReadings
		for _, data := range dailyReadingsMap {
			responseData = append(responseData, *data)
		}
		sort.Slice(responseData, func(i, j int) bool {
			return responseData[i].Date > responseData[j].Date
		})

		c.JSON(http.StatusOK, responseData)
	})

	router.GET("/api/device_daily_times", func(c *gin.Context) {
		daysStr := c.DefaultQuery("days", "7")
		days, err := strconv.Atoi(daysStr)
		if err != nil || days <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid 'days' parameter. Must be a positive integer."})
			return
		}
		if days > 35 { // Cap to prevent excessive data retrieval
			days = 35
		}

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
