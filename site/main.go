package main

import (
	"database/sql"
	"fmt"
	"math"
	"net/http"
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
	db, err := sql.Open("sqlite3", "/home/mike/Documents/Gofarm/farm/sensor_data.db")
	if err != nil {
		fmt.Println("Error opening database:", err)
		return
	}
	defer db.Close()

	router.GET("/", func(c *gin.Context) {
		c.HTML(http.StatusOK, "home.html", gin.H{})
	})

	// New API endpoint to get a maximum of 30 sensor data points
	router.GET("/api/sensor_data", func(c *gin.Context) {
		var totalRows int
		err := db.QueryRow("SELECT COUNT(*) FROM sensors").Scan(&totalRows)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Error counting rows: " + err.Error()})
			return
		}

		var step int
		if totalRows <= 200 {
			step = 1 // Show all if there are 30 or fewer rows
		} else {
			step = int(math.Ceil(float64(totalRows) / 200.0)) // Calculate the interval
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

			// Scan the timestamp as a string first.
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

	router.Run(":8080")
}
