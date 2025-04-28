package main

import (
	"encoding/json"
	"errors"
	"furitingoasis/temp_humid/website/internal/models"
	"furitingoasis/temp_humid/website/internal/validator"
	"net/http"
)

func ping(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8") // Correct MIME type
	w.Write([]byte("OK"))
}

func (app *application) home(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8") // Correct MIME type
	// snippets, err := app.snippets.Latest()
	// if err != nil {
	// 	app.serverError(w, r, err)
	// 	return
	// }

	data := app.newTemplateData(r)
	// data.Snippets = snippets
	app.render(w, r, http.StatusOK, "home.html", data)
}

func (app *application) apiDataHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json") // Correct MIME type for API
	data := map[string]interface{}{"message": "Hello from API!"}
	json.NewEncoder(w).Encode(data)
}

type userLoginForm struct {
	Email               string `form:"email"`
	Password            string `form:"password"`
	validator.Validator `form:"-"`
}

func (app *application) userLogin(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	data := app.newTemplateData(r)
	data.Form = userLoginForm{}
	app.render(w, r, http.StatusOK, "login.html", data)
}

func (app *application) userLoginPost(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")

	var form userLoginForm
	err := app.decodePostForm(r, &form)
	if err != nil {
		app.clientError(w, http.StatusBadRequest)
		return
	}

	form.CheckField(validator.NotBlank(form.Email), "email", "This field cannot be blank")
	form.CheckField(validator.Matches(form.Email, validator.EmailRX), "email", "This field must be a valid email address")
	form.CheckField(validator.NotBlank(form.Password), "password", "This field cannot be blank")
	if !form.Valid() {
		data := app.newTemplateData(r)
		data.Form = form
		app.render(w, r, http.StatusUnprocessableEntity, "login.html", data)
		return
	}

	id, err := app.users.Authenticate(form.Email, form.Password)
	if err != nil {
		if errors.Is(err, models.ErrInvalidCredentials) {
			form.AddNonFieldError("Email or password is incorrect")
			data := app.newTemplateData(r)
			data.Form = form
			app.render(w, r, http.StatusUnprocessableEntity, "login.html", data)
		} else {
			app.serverError(w, r, err)
		}
		return
	}
	err = app.sessionManager.RenewToken(r.Context())
	if err != nil {
		app.serverError(w, r, err)
		return
	}
	app.sessionManager.Put(r.Context(), "authenticatedUserID", id)
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

func (app *application) userLogoutPost(w http.ResponseWriter, r *http.Request) {
	err := app.sessionManager.RenewToken(r.Context())
	if err != nil {
		app.serverError(w, r, err)
		return
	}
	app.sessionManager.Remove(r.Context(), "authenticatedUserID")
	app.sessionManager.Put(r.Context(), "flash", "You've been logged out successfully!")
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

// type userSignupForm struct {
// 	Name                string `form:"name"`
// 	Email               string `form:"email"`
// 	Password            string `form:"password"`
// 	validator.Validator `form:"-"`
// }

// func (app *application) userSignup(w http.ResponseWriter, r *http.Request) {
// 	w.Header().Set("Content-Type", "text/html; charset=utf-8") // Correct MIME type
// 	data := app.newTemplateData(r)
// 	data.Form = userSignupForm{}
// 	app.render(w, r, http.StatusOK, "signup.tmpl.html", data)
// }

// func (app *application) userSignupPost(w http.ResponseWriter, r *http.Request) {
// 	w.Header().Set("Content-Type", "text/html; charset=utf-8") // Correct MIME type
// 	var form userSignupForm
// 	err := app.decodePostForm(r, &form)
// 	if err != nil {
// 		app.clientError(w, http.StatusBadRequest)
// 		return
// 	}
// 	form.CheckField(validator.NotBlank(form.Name), "name", "This field cannot be blank")
// 	form.CheckField(validator.NotBlank(form.Email), "email", "This field cannot be blank")
// 	form.CheckField(validator.Matches(form.Email, validator.EmailRX), "email", "This field must be a valid email address")
// 	form.CheckField(validator.NotBlank(form.Password), "password", "This field cannot be blank")
// 	form.CheckField(validator.MinChars(form.Password, 8), "password", "This field must be at least 8 characters long")
// 	if !form.Valid() {
// 		data := app.newTemplateData(r)
// 		data.Form = form
// 		app.render(w, r, http.StatusUnprocessableEntity, "signup.tmpl.html", data)
// 		return
// 	}
// 	// Try to create a new user record in the database. If the email already
// 	// exists then add an error message to the form and re-display it.
// 	err = app.users.Insert(form.Name, form.Email, form.Password)
// 	if err != nil {
// 		if errors.Is(err, models.ErrDuplicateEmail) {
// 			form.AddFieldError("email", "Email address is already in use")
// 			data := app.newTemplateData(r)
// 			data.Form = form
// 			app.render(w, r, http.StatusUnprocessableEntity, "signup.tmpl.html", data)
// 		} else {
// 			app.serverError(w, r, err)
// 		}
// 		return
// 	}
// 	// Otherwise add a confirmation flash message to the session confirming that
// 	// their signup worked.
// 	app.sessionManager.Put(r.Context(), "flash", "Your signup was successful. Please log in.")
// 	// And redirect the user to the login page.
// 	http.Redirect(w, r, "/user/login", http.StatusSeeOther)
// }
