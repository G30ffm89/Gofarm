package main

import (
	"database/sql"
	"encoding/json"
	"flag"
	"fmt"
	"html/template"
	"io"
	"log"
	"log/slog"
	"net/http"
	"os"
	"path/filepath" // Import for path manipulation
	"time"

	"furitingoasis/temp_humid/website/internal/models"

	"github.com/alexedwards/scs/sqlite3store"
	"github.com/alexedwards/scs/v2"
	"golang.org/x/crypto/bcrypt"

	"github.com/go-playground/form/v4"
	_ "github.com/mattn/go-sqlite3"
)

type application struct {
	logger *slog.Logger
	// snippets       models.SnippetModelInterface // Use our new interface type.
	users          models.UserModelInterface
	templateCache  map[string]*template.Template
	formDecoder    *form.Decoder
	sessionManager *scs.SessionManager
}

type AdminConfig struct {
	AdminUser struct {
		Email    string `json:"email"`
		Password string `json:"password"`
		Username string
	} `json:"adminUser"`
}

type User struct {
	ID         int
	Email      string
	Password   string
	Authorised int
	Admin      int
}

func main() {
	addr := flag.String("addr", ":4000", "HTTP network address")
	dsn := flag.String("dsn", "instance/snippets.db", "SQLite database file path") // Modified DSN
	flag.Parse()

	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))

	// Ensure the "instance" directory exists
	instanceDir := filepath.Dir(*dsn)
	if _, err := os.Stat(instanceDir); os.IsNotExist(err) {
		err := os.MkdirAll(instanceDir, 0755) // Create the directory
		if err != nil {
			logger.Error("failed to create instance directory", "error", err)
			os.Exit(1)
		}
	}

	db, err := openDB(*dsn)
	if err != nil {
		logger.Error(err.Error())
		os.Exit(1)
	}
	defer db.Close()

	// createSnippetsTable(db, logger)
	createSessionTable(db, logger)
	creatUserTable(db, logger)

	err = seedAdminUser(db, "config.json") // Replace with your config file path
	if err != nil {
		logger.Error("Error seeding admin user:", "error", err)
	}

	templateCache, err := newTemplateCache()
	if err != nil {
		logger.Error(err.Error())
		os.Exit(1)
	}

	// Initialize a decoder instance...
	formDecoder := form.NewDecoder()
	// And add it to the application dependencies.

	sessionManager := scs.New()
	sessionManager.Store = sqlite3store.New(db)
	sessionManager.Lifetime = 12 * time.Hour
	sessionManager.Cookie.Secure = true

	app := &application{
		logger: logger,
		// snippets:       &models.SnippetModel{DB: db},
		users:          &models.UserModel{DB: db},
		templateCache:  templateCache,
		formDecoder:    formDecoder,
		sessionManager: sessionManager,
	}

	// tlsConfig := &tls.Config{
	// 	CurvePreferences: []tls.CurveID{tls.X25519, tls.CurveP256},
	// 	MinVersion:       tls.VersionTLS12,
	// 	MaxVersion:       tls.VersionTLS13,
	// }

	srv := &http.Server{
		Addr:     *addr,
		Handler:  app.routes(),
		ErrorLog: slog.NewLogLogger(logger.Handler(), slog.LevelError),
		//TLSConfig:    tlsConfig,
		IdleTimeout:  time.Minute,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 10 * time.Second,
	}

	logger.Info("starting server", "addr", *addr)
	//err = srv.ListenAndServeTLS("./tls/cert.pem", "./tls/key.pem")
	err = srv.ListenAndServe()
	logger.Error(err.Error())
	os.Exit(1)
}

func openDB(dsn string) (*sql.DB, error) {
	db, err := sql.Open("sqlite3", dsn)
	if err != nil {
		return nil, err
	}

	err = db.Ping()
	if err != nil {
		db.Close()
		return nil, err
	}

	return db, nil
}

func seedAdminUser(db *sql.DB, configPath string) error {
	currentTime := time.Now().UTC()
	configFile, err := os.Open(configPath)
	if err != nil {
		return err
	}
	defer configFile.Close()

	byteValue, _ := io.ReadAll(configFile)

	var config AdminConfig
	err = json.Unmarshal(byteValue, &config)
	if err != nil {
		return err
	}

	// Check if an admin user already exists
	var existingAdmin User
	err = db.QueryRow("SELECT id FROM users WHERE admin = 1 LIMIT 1").Scan(&existingAdmin.ID)
	if err == nil {
		log.Println("Admin user already exists, skipping seeding.")
		return nil
	}
	if err != sql.ErrNoRows {
		return fmt.Errorf("error checking for existing admin: %w", err)
	}

	password, err := bcrypt.GenerateFromPassword([]byte(config.AdminUser.Password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	_, err = db.Exec("INSERT INTO users (username, email, password, authorised, admin, created) VALUES (?, ?, ?, ?, ?, ?)",
		config.AdminUser.Username, config.AdminUser.Email, string(password), 1, 1, currentTime)
	if err != nil {
		return fmt.Errorf("error inserting admin user: %w", err)
	}

	log.Println("Admin user created successfully.")
	return nil
}

// func createSnippetsTable(db *sql.DB, logger *slog.Logger) {
// 	stmt := `
// 			CREATE TABLE IF NOT EXISTS snippets (
// 					id INTEGER PRIMARY KEY AUTOINCREMENT,
// 					title VARCHAR(100) NOT NULL,
// 					content TEXT NOT NULL,
// 					created DATETIME NOT NULL,
// 					expires DATETIME NOT NULL
// 			);
// 	`
// 	_, err := db.Exec(stmt)
// 	if err != nil {
// 		logger.Error("failed to create snippets table", "error", err)
// 		return // Return, don't exit
// 	}
// 	logger.Info("Snippets table created or already existed")
// }

func createSessionTable(db *sql.DB, logger *slog.Logger) {
	stmt := `
			CREATE TABLE IF NOT EXISTS sessions (
					token CHAR(43) PRIMARY KEY,
					data BLOB NOT NULL,
					expiry TIMESTAMP(6) NOT NULL
			);
			CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions (expiry);
	`
	_, err := db.Exec(stmt)
	if err != nil {
		logger.Error("failed to create sessions table", "error", err)
		return // Return, don't exit
	}
	logger.Info("Sessions table created or already existed")
}

func creatUserTable(db *sql.DB, logger *slog.Logger) {
	stmt := `
			CREATE TABLE IF NOT EXISTS users (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				username VARCHAR(255) NOT NULL,
				email VARCHAR(255) NOT NULL UNIQUE,
				password CHAR(60) NOT NULL,
				authorised INTERGER DEFAULT 0,
				admin INTERGER DEFAULT 0,
				created DATETIME NOT NULL
			);
	`
	_, err := db.Exec(stmt)
	if err != nil {
		logger.Error("failed to create user table", "error", err)
		return // Return, don't exit
	}
	logger.Info("User table created or already existed")
}
