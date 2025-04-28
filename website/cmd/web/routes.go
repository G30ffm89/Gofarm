package main

import (
	"net/http"

	"furitingoasis/temp_humid/website/ui"

	"github.com/justinas/alice"
)

func (app *application) routes() http.Handler {
	mux := http.NewServeMux()
	mux.Handle("GET /static/", http.FileServerFS(ui.Files))
	// Add a new GET /ping route.
	mux.HandleFunc("GET /ping", ping)
	dynamic := alice.New(app.sessionManager.LoadAndSave, noSurf, app.authenticate)
	mux.Handle("GET /{$}", dynamic.ThenFunc(app.home))

	// mux.Handle("GET /user/signup", dynamic.ThenFunc(app.userSignup))
	// mux.Handle("POST /user/signup", dynamic.ThenFunc(app.userSignupPost))
	mux.Handle("GET /user/login", dynamic.ThenFunc(app.userLogin))
	mux.Handle("POST /user/login", dynamic.ThenFunc(app.userLoginPost))
	protected := dynamic.Append(app.requireAuthentication)
	mux.Handle("POST /user/logout", protected.ThenFunc(app.userLogoutPost))

	standard := alice.New(app.recoverPanic, app.logRequest, app.securityHeaders, app.enableCORS) // Keep security headers and CORS
	return standard.Then(mux)
}
